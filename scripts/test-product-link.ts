/**
 * Self-contained gate for per-product SHARE LINKS.
 *
 * Before this, the storefront had exactly one customer-facing URL — the tenant
 * root — and a product could only be reached by scrolling the catalog. An owner
 * who wanted to send one product to one customer had nothing to paste. This
 * feature gives every product its own address:
 *
 *   https://<tenant-host>/p/<slug>     ← server route, emits per-product OG tags
 *   #p/<slug>                          ← the same target inside the hash SPA
 *
 * The server route is what makes the link WORTH sending: a URL fragment never
 * reaches the server, so a `#`-only link previews in Messenger/Viber as the
 * generic store name. Only a real route can answer a crawler with the product's
 * own photo, name and price.
 *
 * Runs the REAL pure helpers (no DB, no React runtime):
 *
 *   - src/lib/storefront/product-link.ts
 *       productLinkKey(product)      — the stable key a link addresses (slug,
 *           falling back to id, because `Product.slug` is nullable and is only
 *           generated on CREATE — imported/seeded rows have none).
 *       productPath / productHash / productShareUrl — the three renderings of
 *           that key, which must round-trip.
 *       parseProductHash(hash)       — "#p/<key>" → key. Must NOT hijack any
 *           existing flat route (#catalog, #admin, …).
 *       findProductByLinkKey(list, key) — link key back to a product, slug
 *           first then id, so old id-shaped links keep resolving after a
 *           backfill gives the product a real slug.
 *
 * Plus structural checks that the feature is actually wired (a pure helper
 * passing type-check is not proof any surface calls it):
 *
 *   - the slug survives the DB → storefront mapping layer
 *   - the SPA router understands #p/<slug>
 *   - the catalog opens a deep-linked product and renders the share control
 *   - the /p/[slug] route exists and emits openGraph metadata
 *   - the legacy /products/[slug] page redirects instead of serving a second,
 *     off-design product page
 *   - the storefront layout treats /p/ as SPA-shaped (no legacy chrome)
 *
 *   npm run test:product-link
 */

import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Product } from "../src/storefront/types";
import {
  findProductByLinkKey,
  parseProductHash,
  productHash,
  productLinkKey,
  productPath,
  productShareUrl,
} from "../src/lib/storefront/product-link";

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

// A minimal catalog product; only the fields under test are set per case.
const baseProduct = (over: Partial<Product> = {}): Product => ({
  id: "clx0000000000",
  name: "Tirzepatide 10mg",
  description: "Research use only.",
  price: 2500,
  currency: "₱",
  category: "peptides",
  featured: false,
  image: null,
  stock: 5,
  ...over,
});

console.log("\nPer-product share links\n");

// ───────────────────────────── productLinkKey ───────────────────────────────
console.log("productLinkKey");

check("uses the product's slug when it has one", () => {
  assert.equal(
    productLinkKey(baseProduct({ slug: "tirzepatide-10mg" })),
    "tirzepatide-10mg",
  );
});

check("falls back to the id when the slug is null (imported/seeded rows)", () => {
  // Product.slug is `String?` and is only generated on the CREATE path, so the
  // Dragon Peptides import and every bulk seed have none. Those products must
  // still be linkable or the feature is silently missing for whole catalogs.
  assert.equal(productLinkKey(baseProduct({ slug: null })), "clx0000000000");
});

check("falls back to the id when the slug is absent entirely", () => {
  assert.equal(productLinkKey(baseProduct()), "clx0000000000");
});

check("falls back to the id when the slug is blank or whitespace", () => {
  assert.equal(productLinkKey(baseProduct({ slug: "   " })), "clx0000000000");
  assert.equal(productLinkKey(baseProduct({ slug: "" })), "clx0000000000");
});

check("trims incidental whitespace off a real slug", () => {
  assert.equal(productLinkKey(baseProduct({ slug: " bpc-157 " })), "bpc-157");
});

check("never returns an empty key (that would render as the bare path /p/)", () => {
  assert.equal(productLinkKey(baseProduct({ id: "", slug: null })), "");
  // ...and the path builder must refuse it rather than emit "/p/".
  assert.equal(productPath(baseProduct({ id: "", slug: null })), "/");
});

// ──────────────────────── productPath / productHash ─────────────────────────
console.log("\nproductPath / productHash");

check("path is /p/<slug>", () => {
  assert.equal(productPath(baseProduct({ slug: "bpc-157" })), "/p/bpc-157");
});

check("hash is #p/<slug>", () => {
  assert.equal(productHash(baseProduct({ slug: "bpc-157" })), "#p/bpc-157");
});

check("URL-encodes a key with characters that would break the path", () => {
  // Legacy rows can carry a hand-typed slug. Encoding keeps the URL valid; the
  // parser decodes it back, so the round-trip below is what actually matters.
  const p = baseProduct({ slug: "nad+ 500mg" });
  assert.equal(productPath(p), "/p/nad%2B%20500mg");
  assert.equal(parseProductHash(productHash(p)), "nad+ 500mg");
});

// ──────────────────────────── productShareUrl ───────────────────────────────
console.log("\nproductShareUrl");

check("joins the tenant origin and the product path", () => {
  assert.equal(
    productShareUrl("https://hpglow.pepweb.store", baseProduct({ slug: "bpc-157" })),
    "https://hpglow.pepweb.store/p/bpc-157",
  );
});

check("does not double the slash when the origin has a trailing one", () => {
  assert.equal(
    productShareUrl("https://hpglow.pepweb.store/", baseProduct({ slug: "bpc-157" })),
    "https://hpglow.pepweb.store/p/bpc-157",
  );
});

check("works for a dev subdomain origin with a port", () => {
  assert.equal(
    productShareUrl("http://k-glow.lvh.me:3100", baseProduct({ slug: "bpc-157" })),
    "http://k-glow.lvh.me:3100/p/bpc-157",
  );
});

check("degrades to a relative path when there is no origin (SSR, no window)", () => {
  assert.equal(productShareUrl("", baseProduct({ slug: "bpc-157" })), "/p/bpc-157");
});

// ─────────────────────────── parseProductHash ───────────────────────────────
console.log("\nparseProductHash");

check("reads the key out of #p/<key>", () => {
  assert.equal(parseProductHash("#p/bpc-157"), "bpc-157");
});

check("tolerates a hash that arrives without its leading #", () => {
  assert.equal(parseProductHash("p/bpc-157"), "bpc-157");
});

check("does NOT claim the existing flat routes", () => {
  // The SPA router is exact-match over a flat ROUTES list. A product parser that
  // swallowed these would break the whole storefront's navigation.
  for (const h of ["#catalog", "#admin", "#track", "#groupbuy", "#order-confirmed", "#merchant"]) {
    assert.equal(parseProductHash(h), null, `${h} must not parse as a product`);
  }
});

check("returns null for an empty hash, a bare #p, and #p/ with no key", () => {
  assert.equal(parseProductHash(""), null);
  assert.equal(parseProductHash("#"), null);
  assert.equal(parseProductHash("#p"), null);
  assert.equal(parseProductHash("#p/"), null);
  assert.equal(parseProductHash(null), null);
  assert.equal(parseProductHash(undefined), null);
});

check("ignores a nested path under the product key", () => {
  // "#p/a/b" is not a shape we mint; take the first segment rather than 404.
  assert.equal(parseProductHash("#p/bpc-157/extra"), "bpc-157");
});

check("round-trips whatever productHash produced", () => {
  for (const slug of ["bpc-157", "nad-plus-500mg", "clx0000000000"]) {
    assert.equal(parseProductHash(productHash(baseProduct({ slug }))), slug);
  }
});

// ───────────────────────── findProductByLinkKey ─────────────────────────────
console.log("\nfindProductByLinkKey");

const catalog: Product[] = [
  baseProduct({ id: "id-a", slug: "bpc-157", name: "BPC-157" }),
  baseProduct({ id: "id-b", slug: null, name: "Imported, no slug" }),
  baseProduct({ id: "id-c", slug: "id-b", name: "Slug that looks like another id" }),
];

check("resolves a product by its slug", () => {
  assert.equal(findProductByLinkKey(catalog, "bpc-157")?.id, "id-a");
});

check("prefers a slug match over an id match on a different row", () => {
  // Slug wins over id — deliberate: the slug is the canonical, shareable key,
  // and an id collision must not shadow it.
  assert.equal(findProductByLinkKey(catalog, "id-b")?.id, "id-c");
});

check("resolves a slugless product by its id, so old links keep working", () => {
  assert.equal(findProductByLinkKey(catalog, "id-a")?.id, "id-a");
  assert.equal(findProductByLinkKey(catalog, "id-c")?.id, "id-c");
});

check("returns null for an unknown key", () => {
  assert.equal(findProductByLinkKey(catalog, "not-a-product"), null);
});

check("returns null for an empty key or an empty catalog", () => {
  assert.equal(findProductByLinkKey(catalog, ""), null);
  assert.equal(findProductByLinkKey([], "bpc-157"), null);
});

// ══════════════════════ structural wiring (grep-level) ══════════════════════

// ───────────────────── the slug survives the mapping layer ──────────────────
console.log("\nDB → storefront mapping carries the slug");

const mappingSrc = src("src/lib/storefront/product-mapping.ts");
const typesSrc = src("src/storefront/types.ts");

check("the storefront Product type declares a slug", () => {
  assert.ok(
    /^\s*slug\?:/m.test(typesSrc),
    "storefront Product has no `slug` field — the card can't build a link",
  );
});

check("dbProductToStorefront copies the slug through", () => {
  const fn = mappingSrc.slice(mappingSrc.indexOf("export function dbProductToStorefront"));
  assert.ok(
    /slug:\s*row\.slug/.test(fn),
    "dbProductToStorefront drops row.slug — every product would fall back to its id",
  );
});

// ─────────────────────────── SPA router understands #p/ ─────────────────────
console.log("\nSPA deep link");

const appSrc = src("src/storefront/StorefrontApp.tsx");

check("StorefrontApp imports the product-link parser", () => {
  assert.ok(
    /parseProductHash/.test(appSrc),
    "StorefrontApp never parses #p/<slug> — a pasted hash link would land on home",
  );
});

check("StorefrontApp threads the deep-linked product into the catalog", () => {
  assert.ok(
    /openProductSlug/.test(appSrc),
    "no openProductSlug passed down — the modal can't be opened from the URL",
  );
});

check("StorefrontApp accepts an initialProduct from the server route", () => {
  assert.ok(
    /initialProduct/.test(appSrc),
    "the /p/[slug] server route has no way to tell the SPA which product to open",
  );
});

// ──────────────────── catalog: deep link + share control ────────────────────
console.log("\nCatalog share control");

const catalogSrc = src("src/storefront/components/Catalog.tsx");

check("the catalog accepts an openProductSlug prop", () => {
  assert.ok(
    /openProductSlug/.test(catalogSrc),
    "Catalog cannot be told which product to open",
  );
});

check("the deep-linked product is seeded at first render, not in an effect", () => {
  // An effect does not run during SSR: resolving there ships HTML of the bare
  // catalog and pops the modal only after hydration — a visible flash of the
  // wrong thing on exactly the arrival this feature exists for. Verified live:
  // the lazy initializer puts sf-detail + the product name in the server HTML.
  assert.ok(
    /useState<Product \| null>\(\(\) =>/.test(catalogSrc),
    "selected-product state is not seeded with a lazy initializer — the shared link will flash the catalog first",
  );
});

check("the catalog resolves that link key to a product", () => {
  assert.ok(
    /findProductByLinkKey/.test(catalogSrc),
    "Catalog never resolves the link key to a product",
  );
});

check("the card renders a share control", () => {
  assert.ok(
    /ShareProductButton/.test(catalogSrc),
    "no ShareProductButton on the card — there is nothing for the owner to click",
  );
});

check("the share button component exists", () => {
  assert.ok(
    existsSync(join(process.cwd(), "src/storefront/components/ShareProductButton.tsx")),
    "src/storefront/components/ShareProductButton.tsx is missing",
  );
});

check("the share button copies to the clipboard with a fallback path", () => {
  // The routine lives in the shared lib, so follow the import rather than
  // grepping the component — and assert BOTH legs are actually in there.
  const shareSrc = src("src/storefront/components/ShareProductButton.tsx");
  assert.ok(
    /from "@\/lib\/storefront\/clipboard"/.test(shareSrc),
    "share button does not use the shared clipboard helper",
  );
  const clipSrc = src("src/lib/storefront/clipboard.ts");
  assert.ok(
    /navigator\.clipboard/.test(clipSrc) && /execCommand/.test(clipSrc),
    "clipboard helper has no execCommand fallback — navigator.clipboard is undefined on insecure origins and in some in-app webviews",
  );
});

check("the share button offers the native share sheet where available", () => {
  const shareSrc = src("src/storefront/components/ShareProductButton.tsx");
  assert.ok(
    /navigator\.share/.test(shareSrc),
    "no navigator.share — mobile owners lose the one-tap send-to-Messenger path",
  );
});

// ─────────────── card surfaces that never mount <Catalog> ───────────────────
console.log("\nNon-catalog card surfaces");

// These two layouts render their OWN product cards, so they inherit nothing
// from Catalog.tsx. That gap is exactly how the quick-view modal shipped
// classic-only; the share link must not repeat it.
for (const [label, file] of [
  ["the two-ways on-hand shelf", "src/storefront/components/TwoWaysHome.tsx"],
  ["the group-buy page", "src/storefront/pages/GroupBuyPage.tsx"],
] as const) {
  check(`${label} renders a share control`, () => {
    assert.ok(
      /<ShareProductButton/.test(src(file)),
      `${file} has no ShareProductButton — its products cannot be shared`,
    );
  });

  check(`${label} uses the in-flow row variant`, () => {
    // Both clip their overflow, so an absolutely-positioned corner icon (and
    // more importantly its copy-failed fallback panel) would be invisible.
    assert.ok(
      /variant="row"/.test(src(file)),
      `${file} uses a positioned share variant inside an overflow-clipped card`,
    );
  });
}

// ───────────────────────── the /p/[slug] server route ───────────────────────
console.log("\n/p/[slug] server route");

const routePath = "src/app/(tenant)/(storefront)/p/[slug]/page.tsx";

check("the route file exists", () => {
  assert.ok(existsSync(join(process.cwd(), routePath)), `${routePath} is missing`);
});

check("it emits per-product openGraph metadata (this is what previews in chat)", () => {
  const routeSrc = src(routePath);
  assert.ok(/generateMetadata/.test(routeSrc), "no generateMetadata export");
  assert.ok(
    /openGraph/.test(routeSrc),
    "no openGraph block — a pasted link previews as the bare store name",
  );
  assert.ok(
    /images/.test(routeSrc),
    "openGraph carries no image — the preview card has no product photo",
  );
});

check("it looks the product up tenant-scoped and 404s an unknown one", () => {
  const routeSrc = src(routePath);
  assert.ok(/withTenant/.test(routeSrc), "not tenant-scoped — a cross-tenant read");
  assert.ok(/notFound\(\)/.test(routeSrc), "no notFound() for an unknown product");
});

check("it renders the real storefront app, not a second product page design", () => {
  const routeSrc = src(routePath);
  // The route renders the storefront home (which itself renders StorefrontApp),
  // handing it the product key — that is what keeps a shared link on the
  // tenant's own design instead of a bespoke page that can drift from it.
  assert.ok(
    /<StorefrontHome[\s\S]{0,80}initialProduct/.test(routeSrc),
    "the route does not render the shared storefront home with the product key",
  );
  // And it must not hand-roll product markup the way the legacy page did.
  assert.ok(
    !/<h1|font-heading|text-accent/.test(routeSrc),
    "the route builds its own product markup — that is the off-design legacy page all over again",
  );
  // Both routes must render ONE component, or the share link grows its own page.
  const homeSrc = src("src/app/(tenant)/(storefront)/storefront-home.tsx");
  assert.ok(
    /<StorefrontApp/.test(homeSrc) && /initialProduct={initialProduct}/.test(homeSrc),
    "the shared storefront home does not forward initialProduct to StorefrontApp",
  );
  assert.ok(
    /<StorefrontHome/.test(src("src/app/(tenant)/(storefront)/page.tsx")),
    'the "/" route no longer renders the shared home — the two routes have forked',
  );
});

check("it is NOT gated behind the site.products entitlement", () => {
  // Strip comments first: the route explains in prose why it does NOT call this,
  // and a bare grep would read that explanation as the call itself.
  const routeSrc = src(routePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/requireFeaturePage/.test(routeSrc),
    "share links 404 for tenants without site.products — every storefront has a catalog",
  );
});

// ───────────────────── legacy /products/[slug] retired ──────────────────────
console.log("\nLegacy /products/[slug]");

check("middleware 308s the legacy product URL before anything renders", () => {
  // It cannot be done in the route: the (storefront) group has a loading.tsx,
  // so every page under it streams behind a Suspense boundary — Next flushes a
  // 200 shell and a redirect() thrown in the page body afterwards can no longer
  // set the status. Verified live: route-level gave "200 + not-found body",
  // middleware gives "308 → /p/<slug>".
  const mw = src("src/middleware.ts");
  assert.ok(
    /\/\^\\\/products\\\//.test(mw) || /products\\\/\(\[\^\/\]\+\)/.test(mw),
    "middleware does not match the legacy /products/<slug> URL",
  );
  assert.ok(
    /status:\s*308/.test(mw),
    "the legacy product redirect is not a permanent (308) one",
  );
});

check("the legacy product page redirects instead of serving a rival design", () => {
  // Comments stripped for the same reason as the route's entitlement check: the
  // file names the old chrome in prose to explain what it replaced.
  const legacy = src("src/app/(tenant)/(storefront)/products/[slug]/page.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    /permanentRedirect\(|\bredirect\(/.test(legacy),
    "legacy /products/[slug] still renders its own off-design page — two URLs for one product",
  );
  assert.ok(
    !/font-heading/.test(legacy),
    "legacy page still carries the pre-port chrome",
  );
});

check("the section module links at the canonical path", () => {
  const grid = src("src/modules/sections/ProductGrid.tsx");
  assert.ok(
    /\/p\/\$\{/.test(grid) || /productPath/.test(grid),
    "ProductGrid still points at the legacy /products/ path",
  );
});

// ──────────────────── layout treats /p/ as SPA-shaped ───────────────────────
console.log("\nStorefront layout chrome");

check("the layout does not wrap /p/ in the legacy header/footer", () => {
  const layoutSrc = src("src/app/(tenant)/(storefront)/layout.tsx");
  assert.ok(
    /\/p\//.test(layoutSrc),
    'layout still switches on `pathname === "/"` only — /p/<slug> would render the SPA inside the legacy chrome',
  );
});

// ─────────────────────────────── slug backfill ──────────────────────────────
console.log("\nSlug backfill");

check("a backfill script exists for products created outside the create path", () => {
  assert.ok(
    existsSync(join(process.cwd(), "scripts/backfill-product-slugs.ts")),
    "no backfill — imported and seeded catalogs stay on id-shaped links forever",
  );
});

check("the backfill reuses the same slugify + uniqueize the create path uses", () => {
  const backfillSrc = src("scripts/backfill-product-slugs.ts");
  assert.ok(
    /slugify/.test(backfillSrc) && /uniqueize/.test(backfillSrc),
    "backfill rolls its own slug rules — it can collide with slugs the create path already issued",
  );
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
