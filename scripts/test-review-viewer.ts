/**
 * Self-contained gate for the customer-review image viewer (click-to-enlarge).
 *
 * Reported by the pepstack-davao owner: "the review can't be zoomed in — when
 * clicked it should view a much larger modal". Every review surface painted the
 * testimonial into a small fixed box and nothing was clickable:
 *
 *   - the Reviews page card cropped the image into a 4/5 `object-fit: cover`
 *     tile, so a tall chat screenshot lost its top and bottom and its text was
 *     rendered at card width;
 *   - the product quick-view rendered it at 56x56px;
 *   - the store-admin Reviews manager rendered it as a cover thumb too.
 *
 * Testimonials in this niche are overwhelmingly SCREENSHOTS of customer chats,
 * so "cropped and small" means "unreadable" — the content is the text inside
 * the picture. The fix is the lightbox pattern this codebase already uses twice
 * (ProtocolsPage's .protocols__viewer, the admin's .od-proof-viewer): a
 * full-screen dialog that shows the image whole, plus a zoom toggle that drops
 * the fit-to-screen constraint so the image renders at its own size and can be
 * panned — the part a plain `object-fit: contain` lightbox still can't do on a
 * phone.
 *
 * Runs the REAL pure core (no DB, no React runtime, no browser):
 *
 *   - src/lib/storefront/review-viewer.ts
 *       canOpenReviewViewer(review)     — is there anything to enlarge?
 *       buildReviewViewer(review, brand) — the dialog's whole model, including
 *           the owner's per-review typography (delegated to the existing
 *           resolveReviewDescStyle) and product links (reviewProductIds), so
 *           the enlarged view can't drift from the card it opened from.
 *       reviewViewerSrc(image, zoom)    — the ImageKit width/quality the viewer
 *           asks for. A lightbox that reuses the CARD's downsized URL is not a
 *           zoom: the pixels were already thrown away at the edge.
 *       nextReviewZoom / reviewZoomLabel — the fit <-> actual-size toggle.
 *
 * Plus structural checks that the wiring is real (a pure core that type-checks
 * is not proof any surface calls it):
 *
 *   - ReviewViewer.tsx is a real dialog (aria-modal, Escape, scroll lock)
 *   - ReviewsPage opens it from a real <button>, and sizes its grid image
 *     through imageUrl instead of a raw src
 *   - Catalog's detail modal opens it from the thumbnail, and its own Escape
 *     handler stands down while the viewer is open
 *   - AdminReviewsManager opens it from the manager thumb
 *   - storefront.css stacks it above the product detail overlay
 *
 *   npm run test:review-viewer
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  REVIEW_VIEWER_FIT_WIDTH,
  REVIEW_VIEWER_ZOOM_WIDTH,
  REVIEW_VIEWER_QUALITY,
  buildReviewViewer,
  canOpenReviewViewer,
  nextReviewZoom,
  reviewViewerAlt,
  reviewViewerSrc,
  reviewZoomLabel,
} from "../src/lib/storefront/review-viewer";
import type { Brand, Review } from "../src/storefront/types";

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

const IK = "https://ik.imagekit.io/demo/review.jpg";
const brand = (over: Partial<Brand> = {}) => over as Brand;

console.log("\nCustomer review viewer — click to enlarge, toggle to actual size\n");

// ───────────────────────────── canOpenReviewViewer ──────────────────────────
console.log("canOpenReviewViewer");

check("a testimonial with an image can be enlarged", () => {
  assert.equal(canOpenReviewViewer(review({ image: IK })), true);
});

check("a text-only testimonial can still be enlarged (the modal shows the copy)", () => {
  assert.equal(canOpenReviewViewer(review({ image: "" })), true);
});

check("an all-blank row is not clickable — an empty dialog is worse than none", () => {
  const blank = review({ headline: "", title: "", subtitle: "", badge: "", image: "" });
  assert.equal(canOpenReviewViewer(blank), false);
});

// ───────────────────────────── buildReviewViewer ────────────────────────────
console.log("\nbuildReviewViewer (the dialog's model)");

check("hasImage reflects a real image, not a blank string", () => {
  assert.equal(buildReviewViewer(review({ image: IK }), brand()).hasImage, true);
  assert.equal(buildReviewViewer(review({ image: "" }), brand()).hasImage, false);
  assert.equal(buildReviewViewer(review({ image: "   " }), brand()).hasImage, false);
});

check("the whole testimonial travels into the dialog, not just the picture", () => {
  const m = buildReviewViewer(
    review({ image: IK, headline: "Six weeks in", badge: "Verified" }),
    brand(),
  );
  assert.equal(m.headline, "Six weeks in");
  assert.equal(m.title, "Great result");
  assert.equal(m.subtitle, "Down 4kg in two months.");
  assert.equal(m.badge, "Verified");
});

check("the enlarged copy keeps the owner's typography (tenant default + per-review override)", () => {
  const m = buildReviewViewer(
    review({ descStyle: { weight: 700 } }),
    brand({ reviewDescStyle: { font: "Inter", color: "#112233" } }),
  );
  // Merged per-attribute by the SHARED resolver — the enlarged text must not
  // render in a different face than the card it was opened from.
  assert.equal(m.descStyle.fontWeight, 700);
  assert.equal(m.descStyle.color, "#112233");
  assert.ok(String(m.descStyle.fontFamily ?? "").includes("Inter"), "keeps the tenant font");
});

check("product links resolve through the shared reader, so legacy rows still link", () => {
  const legacy = buildReviewViewer(review({ productId: "p-1" }), brand());
  assert.deepEqual(legacy.productIds, ["p-1"]);
  const multi = buildReviewViewer(review({ productId: "p-1", productIds: ["p-1", "p-2"] }), brand());
  assert.deepEqual(multi.productIds, ["p-1", "p-2"]);
});

check("the dialog label falls back through title, headline, badge", () => {
  assert.equal(reviewViewerAlt(review()), "Great result");
  assert.equal(reviewViewerAlt(review({ title: "" })), "Great");
  assert.equal(reviewViewerAlt(review({ title: "", headline: "" })), "Testimonial");
  assert.equal(
    reviewViewerAlt(review({ title: "", headline: "", badge: "" })),
    "Customer review",
  );
});

// ────────────────────────────── reviewViewerSrc ─────────────────────────────
console.log("\nreviewViewerSrc (the zoom is only real if the pixels are)");

check("the fit view asks the edge for a screenshot-legible width", () => {
  const url = reviewViewerSrc(IK, "fit");
  assert.ok(url.includes(`w-${REVIEW_VIEWER_FIT_WIDTH}`), `fit width missing: ${url}`);
  assert.ok(REVIEW_VIEWER_FIT_WIDTH >= 1000, "a 4/5 card thumb width is not an enlargement");
});

check("zooming in requests MORE pixels, not the same URL scaled up in CSS", () => {
  const fit = reviewViewerSrc(IK, "fit");
  const actual = reviewViewerSrc(IK, "actual");
  assert.notEqual(fit, actual);
  assert.ok(actual.includes(`w-${REVIEW_VIEWER_ZOOM_WIDTH}`), `zoom width missing: ${actual}`);
  assert.ok(REVIEW_VIEWER_ZOOM_WIDTH > REVIEW_VIEWER_FIT_WIDTH, "zoom must be the bigger fetch");
});

check("the viewer raises quality — small text in a screenshot is what breaks first", () => {
  assert.ok(REVIEW_VIEWER_QUALITY > 75, "must beat the default card quality");
  assert.ok(reviewViewerSrc(IK, "fit").includes(`q-${REVIEW_VIEWER_QUALITY}`));
});

check("a non-ImageKit testimonial is passed through byte-for-byte", () => {
  const foreign = "https://example.test/proof.png";
  assert.equal(reviewViewerSrc(foreign, "fit"), foreign);
  assert.equal(reviewViewerSrc(foreign, "actual"), foreign);
});

check("no image yields no src — never a broken <img> in the dialog", () => {
  assert.equal(reviewViewerSrc("", "fit"), "");
  assert.equal(reviewViewerSrc("   ", "actual"), "");
});

// ─────────────────────────────── the zoom toggle ────────────────────────────
console.log("\nzoom toggle");

check("clicking toggles between fit-to-screen and actual size", () => {
  assert.equal(nextReviewZoom("fit"), "actual");
  assert.equal(nextReviewZoom("actual"), "fit");
});

check("the control is labelled with the ACTION, not the current state", () => {
  // A button reading "Fit to screen" while already fitted tells a screen-reader
  // user nothing about what pressing it does.
  assert.equal(reviewZoomLabel("fit"), "Zoom in");
  assert.equal(reviewZoomLabel("actual"), "Fit to screen");
});

// ────────────────────────────── surface wiring ──────────────────────────────
console.log("\nsurface wiring");

check("ReviewViewer is a real modal dialog, not a styled div", () => {
  const v = src("src/storefront/components/ReviewViewer.tsx");
  assert.ok(/role="dialog"/.test(v), "role=dialog");
  assert.ok(/aria-modal/.test(v), "aria-modal");
  assert.ok(/"Escape"/.test(v), "Escape closes it");
  assert.ok(/document\.body\.style\.overflow/.test(v), "locks background scroll");
  assert.ok(/reviewViewerSrc/.test(v), "sizes the image through the pure core");
  assert.ok(/nextReviewZoom/.test(v), "wires the zoom toggle");
  assert.ok(/stopPropagation/.test(v), "clicking the image must not close the dialog");
});

check("the Reviews page opens the viewer from a real button", () => {
  const p = src("src/storefront/pages/ReviewsPage.tsx");
  assert.ok(/<ReviewViewer/.test(p), "renders the shared viewer");
  const btnAt = p.indexOf("review-card__zoom");
  assert.ok(btnAt > 0, "the media is wrapped in a .review-card__zoom control");
  // A <div onClick> is invisible to the keyboard — the protocols gallery uses a
  // real <button> for exactly this and so must the review card.
  assert.ok(/<button[\s\S]{0,400}review-card__zoom/.test(p), "the control is a <button>");
});

check("the Reviews page stops shipping the untouched original into a card", () => {
  const p = src("src/storefront/pages/ReviewsPage.tsx");
  assert.ok(/imageUrl\(/.test(p), "grid image is sized through imageUrl");
  assert.ok(!/src=\{r\.image\}/.test(p), "no raw full-size src left in the grid");
});

check("the product quick-view opens the viewer from its 56px thumbnail", () => {
  const c = src("src/storefront/components/Catalog.tsx");
  assert.ok(/<ReviewViewer/.test(c), "renders the shared viewer");
  assert.ok(/sf-detail__review-zoom/.test(c), "the thumb is a zoom control");
});

check("one Escape closes the review viewer, not the product modal underneath it", () => {
  const c = src("src/storefront/components/Catalog.tsx");
  // The detail modal listens for Escape on window; while the review viewer is
  // open it must stand down, or a single keypress dismisses both.
  assert.ok(
    /reviewViewer\s*\)\s*return|if \(reviewViewer\)/.test(c),
    "the detail modal's Escape handler defers while a review viewer is open",
  );
});

check("the store-admin Reviews manager thumb opens the same viewer", () => {
  const a = src("src/storefront/admin/AdminReviewsManager.tsx");
  assert.ok(/<ReviewViewer/.test(a), "reuses the shared viewer rather than a fourth lightbox");
  assert.ok(/review-admin-card__zoom/.test(a), "the thumb is a zoom control");
});

check("the viewer stacks above the product detail overlay", () => {
  const css = src("src/storefront/storefront.css");
  assert.ok(/\.sf-review-viewer\b/.test(css), "the viewer has its own block");
  const zoomStage = /\.sf-review-viewer__stage[\s\S]{0,400}overflow:\s*auto/.test(css);
  assert.ok(zoomStage, "the zoomed stage scrolls, so an oversized image can be panned");
  // .sf-detail-overlay is z-index 1200; a viewer opened from inside it must win.
  const zi = /\.sf-review-viewer\s*\{[\s\S]{0,400}?z-index:\s*(\d+)/.exec(css);
  assert.ok(zi, "the viewer sets a z-index");
  assert.ok(Number(zi![1]) > 1200, `z-index ${zi![1]} must beat the detail overlay's 1200`);
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
