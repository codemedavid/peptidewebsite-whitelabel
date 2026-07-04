/**
 * Self-contained test for the announcement-banner core — the pure module both the
 * store-admin save action (server) and the live storefront (client) depend on:
 *
 *   src/lib/storefront/banner.ts
 *     safeCssColor()             — allowlists a conservative CSS-color charset so a
 *                                  stored color can't smuggle url()/;/quotes into
 *                                  an inline style
 *     normalizeBanner()          — coerces untrusted banner config into a closed,
 *                                  safe shape before it is written to branding.config
 *     resolveBannerSlideTarget() — resolves a stored slide link into a navigation
 *                                  target used to wire the storefront banner
 *     BANNER_MODES / MAX_BANNER_SLIDES / DEFAULT_BANNER
 *
 * Runs the REAL module (no DB, no Next runtime, no browser):
 *
 *   npm run test:banner
 */

import assert from "node:assert";

import {
  BANNER_MODES,
  MAX_BANNER_SLIDES,
  DEFAULT_BANNER,
  safeCssColor,
  normalizeBanner,
  resolveBannerSlideTarget,
} from "../src/lib/storefront/banner";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

// ──────────────────────────── safeCssColor ───────────────────────────────────
console.log("safeCssColor");
check("keeps hex colors", () => {
  assert.equal(safeCssColor("#ff0055"), "#ff0055");
});
check("keeps rgb()/rgba() colors", () => {
  assert.equal(safeCssColor("rgba(20, 30, 40, 0.5)"), "rgba(20, 30, 40, 0.5)");
});
check("keeps oklch() colors", () => {
  assert.equal(safeCssColor("oklch(68% 0.21 250)"), "oklch(68% 0.21 250)");
});
check("keeps var(--token) references", () => {
  assert.equal(safeCssColor("var(--brand-accent)"), "var(--brand-accent)");
});
check("keeps simple named colors", () => {
  assert.equal(safeCssColor("rebeccapurple"), "rebeccapurple");
});
check("trims surrounding whitespace", () => {
  assert.equal(safeCssColor("  #abc  "), "#abc");
});
check("rejects a url() payload", () => {
  assert.equal(safeCssColor("url(https://evil.example/x)"), "");
});
check("rejects a value that closes the declaration", () => {
  assert.equal(safeCssColor("red; } body { display:none"), "");
});
check("rejects quotes and angle brackets", () => {
  assert.equal(safeCssColor('"><script>'), "");
});
check("empty/undefined → empty string", () => {
  assert.equal(safeCssColor(""), "");
  assert.equal(safeCssColor(undefined), "");
});

// ──────────────────────────── normalizeBanner: shape/defaults ────────────────
console.log("normalizeBanner — defaults");
check("empty input → disabled single banner with no slides", () => {
  const b = normalizeBanner({});
  assert.equal(b.enabled, false);
  assert.equal(b.mode, "single");
  assert.deepEqual(b.slides, []);
  assert.equal(b.autoplayMs, DEFAULT_BANNER.autoplayMs);
  assert.equal(b.speed, "normal");
  assert.equal(b.pauseOnHover, true);
});
check("null / non-object input does not throw", () => {
  assert.doesNotThrow(() => normalizeBanner(null));
  assert.doesNotThrow(() => normalizeBanner(undefined));
  assert.doesNotThrow(() => normalizeBanner(42));
});
check("enabled is a strict boolean (truthy strings do not enable)", () => {
  assert.equal(normalizeBanner({ enabled: true }).enabled, true);
  assert.equal(normalizeBanner({ enabled: "yes" }).enabled, false);
  assert.equal(normalizeBanner({ enabled: 1 }).enabled, false);
});

// ──────────────────────────── normalizeBanner: mode ─────────────────────────
console.log("normalizeBanner — mode");
check("each known mode is preserved", () => {
  for (const mode of BANNER_MODES) {
    assert.equal(normalizeBanner({ mode }).mode, mode);
  }
});
check("unknown mode coerces to 'single'", () => {
  assert.equal(normalizeBanner({ mode: "spinny" }).mode, "single");
});

// ──────────────────────────── normalizeBanner: slides ───────────────────────
console.log("normalizeBanner — slides");
check("trims slide text and drops empty-text slides", () => {
  const b = normalizeBanner({
    slides: [{ text: "  Free shipping  " }, { text: "   " }, { text: "" }, {}],
  });
  assert.equal(b.slides.length, 1);
  assert.equal(b.slides[0].text, "Free shipping");
});
check("caps the number of slides to MAX_BANNER_SLIDES", () => {
  const many = Array.from({ length: MAX_BANNER_SLIDES + 5 }, (_, i) => ({ text: `msg ${i}` }));
  assert.equal(normalizeBanner({ slides: many }).slides.length, MAX_BANNER_SLIDES);
});
check("keeps a provided non-empty slide id, else derives a stable one", () => {
  const b = normalizeBanner({ slides: [{ id: "promo-1", text: "A" }, { text: "B" }] });
  assert.equal(b.slides[0].id, "promo-1");
  assert.ok(typeof b.slides[1].id === "string" && b.slides[1].id.length > 0);
});
check("non-array slides → empty list, no throw", () => {
  assert.deepEqual(normalizeBanner({ slides: "nope" }).slides, []);
});

// ──────────────────────────── normalizeBanner: slide links ──────────────────
console.log("normalizeBanner — slide links");
check("default slide link type is 'none'", () => {
  const b = normalizeBanner({ slides: [{ text: "Hi" }] });
  assert.equal(b.slides[0].linkType, "none");
  assert.equal(b.slides[0].linkUrl, "");
});
check("custom link keeps a valid http(s) URL", () => {
  const b = normalizeBanner({
    slides: [{ text: "Sale", linkType: "custom", linkUrl: "https://example.com/sale" }],
  });
  assert.equal(b.slides[0].linkType, "custom");
  assert.equal(b.slides[0].linkUrl, "https://example.com/sale");
});
check("custom link strips a javascript: URL", () => {
  const b = normalizeBanner({
    slides: [{ text: "X", linkType: "custom", linkUrl: "javascript:alert(1)" }],
  });
  assert.equal(b.slides[0].linkUrl, "");
});
check("page link keeps a known route and drops any custom URL", () => {
  const b = normalizeBanner({
    slides: [{ text: "Shop", linkType: "page", linkPage: "catalog", linkUrl: "https://x.io" }],
  });
  assert.equal(b.slides[0].linkType, "page");
  assert.equal(b.slides[0].linkPage, "catalog");
  assert.equal(b.slides[0].linkUrl, "");
});
check("page link with an unknown route falls back to catalog", () => {
  const b = normalizeBanner({ slides: [{ text: "Shop", linkType: "page", linkPage: "bogus" }] });
  assert.equal(b.slides[0].linkPage, "catalog");
});

// ──────────────────────────── normalizeBanner: numeric/enum options ─────────
console.log("normalizeBanner — options");
check("autoplayMs is clamped into a sane range", () => {
  assert.ok(normalizeBanner({ autoplayMs: 10 }).autoplayMs >= 2000);
  assert.ok(normalizeBanner({ autoplayMs: 999999 }).autoplayMs <= 20000);
  assert.equal(normalizeBanner({ autoplayMs: 4000 }).autoplayMs, 4000);
});
check("non-numeric autoplayMs falls back to the default", () => {
  assert.equal(normalizeBanner({ autoplayMs: "fast" }).autoplayMs, DEFAULT_BANNER.autoplayMs);
});
check("speed is allowlisted, else 'normal'", () => {
  assert.equal(normalizeBanner({ speed: "slow" }).speed, "slow");
  assert.equal(normalizeBanner({ speed: "fast" }).speed, "fast");
  assert.equal(normalizeBanner({ speed: "warp" }).speed, "normal");
});
check("pauseOnHover is a strict boolean defaulting to true", () => {
  assert.equal(normalizeBanner({ pauseOnHover: false }).pauseOnHover, false);
  assert.equal(normalizeBanner({}).pauseOnHover, true);
});
check("colors are sanitized through safeCssColor", () => {
  const b = normalizeBanner({ bgColor: "#101820", textColor: "url(x)" });
  assert.equal(b.bgColor, "#101820");
  assert.equal(b.textColor, "");
});

// ──────────────────────────── resolveBannerSlideTarget ──────────────────────
console.log("resolveBannerSlideTarget");
check("none link → none target", () => {
  assert.deepEqual(resolveBannerSlideTarget({ linkType: "none" }), { kind: "none" });
});
check("custom + valid URL → external target", () => {
  assert.deepEqual(
    resolveBannerSlideTarget({ linkType: "custom", linkUrl: "https://example.com" }),
    { kind: "external", url: "https://example.com" },
  );
});
check("custom + unsafe URL → none (inert)", () => {
  assert.deepEqual(
    resolveBannerSlideTarget({ linkType: "custom", linkUrl: "javascript:alert(1)" }),
    { kind: "none" },
  );
});
check("page → route target", () => {
  assert.deepEqual(
    resolveBannerSlideTarget({ linkType: "page", linkPage: "faq" }),
    { kind: "route", route: "faq" },
  );
});
check("page with no route defaults to catalog", () => {
  assert.deepEqual(resolveBannerSlideTarget({ linkType: "page" }), { kind: "route", route: "catalog" });
});

// ──────────────────────────── BANNER_MODES ───────────────────────────────────
console.log("BANNER_MODES");
check("contains exactly single, carousel and marquee", () => {
  assert.deepEqual([...BANNER_MODES], ["single", "carousel", "marquee"]);
});

// ──────────────────────────── summary ────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
