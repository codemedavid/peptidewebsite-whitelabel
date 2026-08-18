/**
 * Self-contained gate for owner-managed customer testimonials.
 *
 * Before this, a store's reviews were the LAST storefront collection that never
 * reached the database: store.tsx hydrated them from the editing browser's
 * localStorage with the six hardcoded SEED_REVIEWS as the fallback, and there
 * was no save action at all. So an owner who wrote real testimonials saw them
 * only on that one device — every customer kept seeing the "Plateau breaker 🔥"
 * demo rows. This is the same cross-device bug already fixed for COA, FAQ,
 * protocols, promo codes and payment methods.
 *
 * It also adds what the owner actually asked for:
 *   - a per-review DESCRIPTION TYPOGRAPHY override (font / size / weight /
 *     italic / transform / tracking / color) layered over a tenant-wide default,
 *     reusing the hero's HeroFieldStyle + heroFieldCss primitives rather than
 *     inventing a second text-style shape;
 *   - MULTI-CONNECT to products (a testimonial can name several products), and
 *     the reverse read — the reviews that belong under one product's description
 *     in the quick-view detail modal.
 *
 * Runs the REAL pure core (no DB, no React runtime, no browser):
 *
 *   - src/lib/storefront/reviews.ts
 *       normalizeReviews(input)          — the trust boundary. Untrusted client
 *           JSON → closed Review[]: caps, stable ids, http(s)-only images,
 *           deduped/capped product links, and a style object validated against
 *           the font registry so a hostile blob can't inject CSS.
 *       reviewProductIds(review)         — legacy `productId` + `productIds`,
 *           unioned and deduped, so old single-linked rows keep working.
 *       reviewsForProduct(reviews, id)   — the reverse index the product detail
 *           modal renders under the description.
 *       resolveReviewDescStyle(r, brand) — tenant default MERGED with the
 *           per-review override (per-attribute, review wins).
 *       reviewFontFamilies(reviews, brand) — every family in play, so the tenant
 *           layout can request them. A font that renders but is never loaded
 *           silently falls back — the exact trap documented for config fonts.
 *
 * Plus structural checks that the wiring is real (a pure core that type-checks
 * is not proof any surface calls it):
 *
 *   - store.tsx no longer hydrates reviews from localStorage
 *   - (storefront)/page.tsx feeds branding.config.reviews into the brand prop
 *   - storefront-admin.ts exports saveReviewsAction behind the "reviews" staff
 *     permission
 *   - AdminReviewsManager persists through that action
 *   - ReviewsPage paints the resolved description style
 *   - Catalog.tsx renders connected reviews under the detail modal description
 *   - (storefront)/layout.tsx loads the review fonts
 *
 *   npm run test:review-content
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MAX_REVIEWS,
  MAX_REVIEW_TEXT,
  MAX_REVIEW_PRODUCTS,
  normalizeReviews,
  reviewProductIds,
  reviewsForProduct,
  resolveReviewDescStyle,
  reviewFontFamilies,
} from "../src/lib/storefront/reviews";
import type { Review, Brand } from "../src/storefront/types";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** A minimal review; every field the normalizer requires, nothing more. */
function review(over: Partial<Review> = {}): Review {
  return {
    headline: "Great",
    title: "Great result",
    subtitle: "Down 4kg in two months.",
    badge: "Testimonial",
    image: "",
    ...over,
  };
}

console.log("\nCustomer testimonials — owner-managed content, typography + product links\n");

// ─────────────────────────────── normalizeReviews ───────────────────────────
console.log("normalizeReviews (trust boundary)");

check("non-array input collapses to an empty list", () => {
  assert.deepEqual(normalizeReviews(undefined), []);
  assert.deepEqual(normalizeReviews(null), []);
  assert.deepEqual(normalizeReviews("nope"), []);
  assert.deepEqual(normalizeReviews({ 0: review() }), []);
});

check("garbage entries are dropped, not rendered as blank cards", () => {
  const out = normalizeReviews([null, "x", 42, [], review()]);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Great result");
});

check("a row with no title, subtitle or image is dropped", () => {
  // Mirrors the editor's own canSave rule — an all-blank row is not content.
  const out = normalizeReviews([
    { headline: "h", title: "  ", subtitle: "", badge: "Testimonial", image: "" },
  ]);
  assert.deepEqual(out, []);
});

check("an image-only row survives (a photo testimonial needs no text)", () => {
  const out = normalizeReviews([
    { headline: "", title: "", subtitle: "", badge: "", image: "https://ik.io/a.jpg" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].image, "https://ik.io/a.jpg");
});

check("ids are stable: a supplied id is kept, a missing one is generated", () => {
  const out = normalizeReviews([review({ id: "rv_kept" }), review()]);
  assert.equal(out[0].id, "rv_kept");
  assert.ok(out[1].id && out[1].id.length > 0, "generated an id");
  assert.notEqual(out[0].id, out[1].id, "ids are distinct");
});

check("the list is capped at MAX_REVIEWS", () => {
  const many = Array.from({ length: MAX_REVIEWS + 25 }, (_, i) => review({ title: `r${i}` }));
  assert.equal(normalizeReviews(many).length, MAX_REVIEWS);
});

check("long text is capped at MAX_REVIEW_TEXT", () => {
  const out = normalizeReviews([review({ subtitle: "x".repeat(MAX_REVIEW_TEXT + 500) })]);
  assert.equal(out[0].subtitle.length, MAX_REVIEW_TEXT);
});

check("a javascript: image URL is stripped before it can reach an <img src>", () => {
  const out = normalizeReviews([
    review({ image: "javascript:alert(1)" }),
    review({ image: "data:text/html,<script>" }),
    review({ image: "https://ik.io/ok.jpg" }),
  ]);
  assert.equal(out[0].image, "");
  assert.equal(out[1].image, "");
  assert.equal(out[2].image, "https://ik.io/ok.jpg");
});

// ─────────────────────── multi-connect: products on a review ────────────────
console.log("\nproduct links (multi-connect)");

check("productIds are trimmed, de-duplicated and non-strings dropped", () => {
  const out = normalizeReviews([
    review({ productIds: ["p1", " p2 ", "p1", "", 7 as unknown as string, null as unknown as string] }),
  ]);
  assert.deepEqual(out[0].productIds, ["p1", "p2"]);
});

check("productIds are capped at MAX_REVIEW_PRODUCTS", () => {
  const ids = Array.from({ length: MAX_REVIEW_PRODUCTS + 10 }, (_, i) => `p${i}`);
  const out = normalizeReviews([review({ productIds: ids })]);
  assert.equal(out[0].productIds!.length, MAX_REVIEW_PRODUCTS);
});

check("a legacy single productId is folded into productIds, first", () => {
  // Rows written before multi-connect must keep their link without a migration.
  const out = normalizeReviews([review({ productId: "legacy", productIds: ["p2"] })]);
  assert.deepEqual(out[0].productIds, ["legacy", "p2"]);
});

check("a legacy-only row is upgraded to the list shape", () => {
  const out = normalizeReviews([review({ productId: "solo" })]);
  assert.deepEqual(out[0].productIds, ["solo"]);
});

check("reviewProductIds unions both shapes and never returns duplicates", () => {
  assert.deepEqual(reviewProductIds(review({ productIds: ["a", "b"] })), ["a", "b"]);
  assert.deepEqual(reviewProductIds(review({ productId: "a" })), ["a"]);
  assert.deepEqual(reviewProductIds(review({ productId: "a", productIds: ["a", "b"] })), ["a", "b"]);
  assert.deepEqual(reviewProductIds(review()), []);
});

// ─────────────────── reverse index: reviews under a product ─────────────────
console.log("\nreviewsForProduct (renders under the product description)");

const linked: Review[] = [
  review({ id: "r1", title: "First", productIds: ["p1"] }),
  review({ id: "r2", title: "Second", productIds: ["p1", "p2"] }),
  review({ id: "r3", title: "Third", productIds: ["p3"] }),
  review({ id: "r4", title: "Unlinked" }),
  review({ id: "r5", title: "Legacy", productId: "p2" }),
];

check("returns only the reviews connected to that product, in list order", () => {
  assert.deepEqual(
    reviewsForProduct(linked, "p1").map((r) => r.id),
    ["r1", "r2"],
  );
});

check("a multi-connected review appears under EVERY product it names", () => {
  assert.ok(reviewsForProduct(linked, "p1").some((r) => r.id === "r2"), "under p1");
  assert.ok(reviewsForProduct(linked, "p2").some((r) => r.id === "r2"), "under p2");
});

check("a legacy single-linked review still shows under its product", () => {
  assert.ok(reviewsForProduct(linked, "p2").some((r) => r.id === "r5"));
});

check("an unlinked review shows on no product page", () => {
  const all = ["p1", "p2", "p3"].flatMap((p) => reviewsForProduct(linked, p));
  assert.ok(!all.some((r) => r.id === "r4"), "r4 never surfaces under a product");
});

check("a blank or unknown product id yields nothing (never the whole list)", () => {
  assert.deepEqual(reviewsForProduct(linked, ""), []);
  assert.deepEqual(reviewsForProduct(linked, "   "), []);
  assert.deepEqual(reviewsForProduct(linked, "nope"), []);
  assert.deepEqual(reviewsForProduct([], "p1"), []);
});

// ───────────────────────── description typography ───────────────────────────
console.log("\ndescription font style (per-review over tenant default)");

const brand = (over: Partial<Brand> = {}) => over as Brand;

check("an unregistered font is rejected — no arbitrary CSS reaches the page", () => {
  const out = normalizeReviews([
    review({ descStyle: { font: "Comic Sans'; background:url(evil)" } as Review["descStyle"] }),
  ]);
  assert.equal(out[0].descStyle?.font, undefined);
});

check("a registered font is kept", () => {
  const out = normalizeReviews([review({ descStyle: { font: "Lora" } })]);
  assert.equal(out[0].descStyle?.font, "Lora");
});

check("size is clamped to a readable range and non-numbers dropped", () => {
  const big = normalizeReviews([review({ descStyle: { size: 900 } })]);
  const small = normalizeReviews([review({ descStyle: { size: 1 } })]);
  const junk = normalizeReviews([review({ descStyle: { size: "20px" as unknown as number } })]);
  assert.ok((big[0].descStyle!.size ?? 0) <= 72, "capped");
  assert.ok((small[0].descStyle!.size ?? 0) >= 10, "floored");
  assert.equal(junk[0].descStyle?.size, undefined);
});

check("weight must be one of the registry weights", () => {
  assert.equal(normalizeReviews([review({ descStyle: { weight: 700 } })])[0].descStyle?.weight, 700);
  assert.equal(
    normalizeReviews([review({ descStyle: { weight: 999 as unknown as 700 } })])[0].descStyle?.weight,
    undefined,
  );
});

check("color must be a hex value — anything else is dropped", () => {
  assert.equal(
    normalizeReviews([review({ descStyle: { color: "#334455" } })])[0].descStyle?.color,
    "#334455",
  );
  assert.equal(
    normalizeReviews([review({ descStyle: { color: "red; background:url(x)" } })])[0].descStyle?.color,
    undefined,
  );
});

check("an empty style object is dropped rather than stored as noise", () => {
  const out = normalizeReviews([review({ descStyle: {} })]);
  assert.equal(out[0].descStyle, undefined);
});

check("the tenant default styles every review that has no override", () => {
  const css = resolveReviewDescStyle(review(), brand({ reviewDescStyle: { font: "Lora", size: 18 } }));
  assert.ok(String(css.fontFamily).includes("Lora"), "tenant font applied");
  assert.ok(css.fontSize, "tenant size applied");
});

check("a per-review override wins attribute-by-attribute, not wholesale", () => {
  const css = resolveReviewDescStyle(
    review({ descStyle: { weight: 700 } }),
    brand({ reviewDescStyle: { font: "Lora", weight: 400 } }),
  );
  assert.equal(css.fontWeight, 700, "review weight wins");
  assert.ok(String(css.fontFamily).includes("Lora"), "tenant font still inherited");
});

check("no styling anywhere resolves to an empty style (CSS keeps control)", () => {
  assert.deepEqual(resolveReviewDescStyle(review(), brand()), {});
});

check("reviewFontFamilies lists every family so the layout can load it", () => {
  const fams = reviewFontFamilies(
    [review({ descStyle: { font: "Lora" } }), review({ descStyle: { font: "Sora" } }), review()],
    brand({ reviewDescStyle: { font: "Lora" } }),
  );
  assert.ok(fams.includes("Lora"), "tenant/review font present");
  assert.ok(fams.includes("Sora"), "second review font present");
  assert.equal(new Set(fams).size, fams.length, "de-duplicated");
  assert.ok(!fams.some((f) => !f), "no blanks");
});

// ───────────────────────────── wiring (structural) ──────────────────────────
console.log("\nwiring — the surfaces actually use the core");

check("store.tsx no longer hydrates reviews from localStorage", () => {
  const s = src("src/storefront/store.tsx");
  assert.ok(
    !/load\(\s*NS\s*\+\s*"reviews"/.test(s),
    'store.tsx still calls load(NS + "reviews", …) — a stale local copy would mask the owner\'s saved reviews',
  );
  assert.ok(/reviews are intentionally NOT hydrated/i.test(s), "carries the same NOTE as the other DB-backed collections");
});

check("the storefront page feeds branding.config.reviews into the brand prop", () => {
  const p = src("src/app/(tenant)/(storefront)/page.tsx");
  assert.ok(/normalizeReviews\s*\(/.test(p), "page.tsx normalizes the stored reviews");
  assert.ok(/reviews/.test(p), "page.tsx reads reviews from config");
});

check("saveReviewsAction exists behind the 'reviews' staff permission", () => {
  const a = src("src/actions/storefront-admin.ts");
  assert.ok(/export async function saveReviewsAction/.test(a), "action exported");
  const body = a.slice(a.indexOf("export async function saveReviewsAction"));
  assert.ok(/requireStaffPermission\("reviews"\)/.test(body.slice(0, 600)), "gated on the reviews module");
  assert.ok(/normalizeReviews\(/.test(body.slice(0, 900)), "sanitizes at the boundary");
});

check("edits persist to the server, not just local state", () => {
  // Same contract as COA/protocols: the manager writes through the store setter
  // and store.tsx owns the save call, so nothing can edit reviews without
  // persisting them. Asserting the manager calls the action directly would
  // contradict that shape (AdminLabResults.tsx:322, AdminProtocolsManager.tsx:131).
  const m = src("src/storefront/admin/AdminReviewsManager.tsx");
  assert.ok(/setReviews\(/.test(m), "manager writes through the store setter");
  const store = src("src/storefront/store.tsx");
  assert.ok(/saveReviewsAction/.test(store), "store.tsx imports the save action");
  const setter = store.slice(store.indexOf("const setReviews = useCallback"));
  assert.ok(
    /saveReviewsAction\(value\)/.test(setter.slice(0, 900)),
    "setReviews persists the new value server-side",
  );
});

check("the Reviews manager offers multi-product connection", () => {
  const m = src("src/storefront/admin/AdminReviewsManager.tsx");
  assert.ok(/productIds/.test(m), "edits the productIds list, not just productId");
});

check("the Reviews manager offers description font controls", () => {
  const m = src("src/storefront/admin/AdminReviewsManager.tsx");
  assert.ok(/descStyle/.test(m), "edits descStyle");
});

check("ReviewsPage paints the resolved description style", () => {
  const p = src("src/storefront/pages/ReviewsPage.tsx");
  assert.ok(/resolveReviewDescStyle/.test(p), "uses the shared resolver");
});

check("the product detail modal renders its connected reviews under the description", () => {
  const c = src("src/storefront/components/Catalog.tsx");
  assert.ok(/reviewsForProduct/.test(c), "Catalog.tsx queries the reverse index");
  // Compare the rendered MARKUP positions — the import line naturally sits above
  // everything, so matching on the function name alone proves nothing.
  const descAt = c.indexOf('className="sf-detail__desc"');
  const revAt = c.indexOf('className="sf-detail__reviews"');
  assert.ok(descAt > 0, "the description paragraph is still rendered");
  assert.ok(revAt > descAt, "the reviews block sits AFTER the description paragraph");
});

check("the tenant layout loads the review fonts", () => {
  const l = src("src/app/(tenant)/(storefront)/layout.tsx");
  assert.ok(
    /reviewFontFamilies|reviewDescStyle/.test(l),
    "layout.tsx feeds review fonts into googleFontsUrl — otherwise a chosen face silently falls back",
  );
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
