/**
 * Self-contained test for the hero media core — the pure module the store-admin
 * save action, the live storefront <Hero> and the operator live preview all
 * depend on:
 *
 *   - src/lib/storefront/hero-media.ts
 *       normalizeHeroMedia()    — coerces untrusted image-hero config into a
 *                                 closed, safe shape before branding.config write
 *       resolveHeroMedia()      — the EFFECTIVE hero mode (image mode with no
 *                                 uploaded image falls back to the written hero)
 *       heroMediaAspect()       — ratio key → CSS aspect-ratio
 *       heroMediaPosition()     — focus key → CSS object-position
 *       heroMediaScrimAlpha()   — overlay + scrim → rgba alpha (0 when overlay off)
 *       resolveHeroMediaLink()  — stored link config → navigation target
 *
 * Runs the REAL module (no DB, no Next runtime, no browser):
 *
 *   npm run test:hero-media
 */

import assert from "node:assert";

import {
  normalizeHeroMedia,
  resolveHeroMedia,
  heroMediaAspect,
  heroMediaPosition,
  heroMediaScrimAlpha,
  resolveHeroMediaLink,
  heroMediaSrcIssue,
  HERO_MEDIA_MAX_URL_LEN,
  HERO_MEDIA_MAX_HTTP_URL_LEN,
} from "../src/lib/storefront/hero-media";

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

// ──────────────────────────── normalizeHeroMedia ─────────────────────────────
console.log("normalizeHeroMedia");

check("empty input → safe written-hero defaults", () => {
  const m = normalizeHeroMedia({});
  assert.equal(m.mode, "text");
  assert.equal(m.url, "");
  assert.equal(m.alt, "");
  assert.equal(m.ratio, "standard");
  assert.equal(m.focus, "center");
  assert.equal(m.linkType, "page");
  assert.equal(m.linkPage, "catalog");
  assert.equal(m.linkUrl, "");
  assert.equal(m.overlay, false);
  assert.equal(m.scrim, 30);
});

check("null / non-object input does not throw", () => {
  assert.doesNotThrow(() => normalizeHeroMedia(null));
  assert.doesNotThrow(() => normalizeHeroMedia(undefined));
  assert.doesNotThrow(() => normalizeHeroMedia(42));
  assert.doesNotThrow(() => normalizeHeroMedia("nope"));
});

check("reads a nested heroMedia payload", () => {
  const m = normalizeHeroMedia({ heroMedia: { mode: "image", url: "https://ik.io/a.jpg" } });
  assert.equal(m.mode, "image");
  assert.equal(m.url, "https://ik.io/a.jpg");
});

check("unknown mode coerces to 'text'", () => {
  assert.equal(normalizeHeroMedia({ heroMedia: { mode: "bogus" } }).mode, "text");
});

check("unknown ratio / focus fall back to defaults", () => {
  const m = normalizeHeroMedia({ heroMedia: { ratio: "gigantic", focus: "diagonal" } });
  assert.equal(m.ratio, "standard");
  assert.equal(m.focus, "center");
});

check("known ratio / focus are preserved", () => {
  const m = normalizeHeroMedia({ heroMedia: { ratio: "wide", focus: "bottom" } });
  assert.equal(m.ratio, "wide");
  assert.equal(m.focus, "bottom");
});

check("keeps an https image URL", () => {
  const m = normalizeHeroMedia({ heroMedia: { url: "https://ik.imagekit.io/t/hero.webp" } });
  assert.equal(m.url, "https://ik.imagekit.io/t/hero.webp");
});

check("strips a javascript: image URL", () => {
  assert.equal(normalizeHeroMedia({ heroMedia: { url: "javascript:alert(1)" } }).url, "");
});

check("keeps a small data:image URL (demo / no-ImageKit upload path)", () => {
  const tiny = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(normalizeHeroMedia({ heroMedia: { url: tiny } }).url, tiny);
});

check("drops a non-image data: URL", () => {
  const bad = "data:text/html;base64,PHNjcmlwdD54PC9zY3JpcHQ+";
  assert.equal(normalizeHeroMedia({ heroMedia: { url: bad } }).url, "");
});

check("drops an oversized data: URL instead of bloating branding.config", () => {
  const huge = "data:image/png;base64," + "A".repeat(HERO_MEDIA_MAX_URL_LEN + 10);
  assert.equal(normalizeHeroMedia({ heroMedia: { url: huge } }).url, "");
});

check("scrim clamps to 0..70", () => {
  assert.equal(normalizeHeroMedia({ heroMedia: { scrim: -20 } }).scrim, 0);
  assert.equal(normalizeHeroMedia({ heroMedia: { scrim: 999 } }).scrim, 70);
});

check("scrim snaps to the 5% step", () => {
  assert.equal(normalizeHeroMedia({ heroMedia: { scrim: 32 } }).scrim, 30);
  assert.equal(normalizeHeroMedia({ heroMedia: { scrim: 33 } }).scrim, 35);
});

check("non-numeric scrim → default 30", () => {
  assert.equal(normalizeHeroMedia({ heroMedia: { scrim: "loads" } }).scrim, 30);
  assert.equal(normalizeHeroMedia({ heroMedia: { scrim: NaN } }).scrim, 30);
});

check("overlay coerces to a real boolean", () => {
  assert.equal(normalizeHeroMedia({ heroMedia: { overlay: true } }).overlay, true);
  assert.equal(normalizeHeroMedia({ heroMedia: { overlay: "yes" } }).overlay, true);
  assert.equal(normalizeHeroMedia({ heroMedia: { overlay: 0 } }).overlay, false);
});

check("alt text is trimmed and capped", () => {
  assert.equal(normalizeHeroMedia({ heroMedia: { alt: "  Gold vials  " } }).alt, "Gold vials");
  assert.ok(normalizeHeroMedia({ heroMedia: { alt: "x".repeat(500) } }).alt.length <= 200);
});

check("linkType 'none' is preserved (not clickable)", () => {
  assert.equal(normalizeHeroMedia({ heroMedia: { linkType: "none" } }).linkType, "none");
});

check("unknown linkType coerces to 'page'", () => {
  assert.equal(normalizeHeroMedia({ heroMedia: { linkType: "telepathy" } }).linkType, "page");
});

check("unknown linkPage falls back to catalog", () => {
  assert.equal(normalizeHeroMedia({ heroMedia: { linkPage: "made-up" } }).linkPage, "catalog");
});

check("known linkPage is preserved", () => {
  assert.equal(normalizeHeroMedia({ heroMedia: { linkPage: "track" } }).linkPage, "track");
});

check("custom linkType keeps an http(s) URL and strips javascript:", () => {
  assert.equal(
    normalizeHeroMedia({ heroMedia: { linkType: "custom", linkUrl: "https://x.io/promo" } }).linkUrl,
    "https://x.io/promo",
  );
  assert.equal(
    normalizeHeroMedia({ heroMedia: { linkType: "custom", linkUrl: "javascript:alert(1)" } }).linkUrl,
    "",
  );
});

check("page linkType drops any provided custom URL", () => {
  const m = normalizeHeroMedia({
    heroMedia: { linkType: "page", linkUrl: "https://x.io/ignored" },
  });
  assert.equal(m.linkUrl, "");
});

check("output is a closed shape — no extra keys smuggled through", () => {
  const m = normalizeHeroMedia({ heroMedia: { evil: "payload" } });
  assert.deepEqual(
    Object.keys(m).sort(),
    ["alt", "focus", "linkPage", "linkType", "linkUrl", "mode", "overlay", "ratio", "scrim", "url"],
  );
});

check("normalizing its own output is stable (idempotent)", () => {
  const once = normalizeHeroMedia({
    heroMedia: { mode: "image", url: "https://x.io/a.jpg", ratio: "tall", focus: "left", scrim: 45, overlay: true },
  });
  assert.deepEqual(normalizeHeroMedia({ heroMedia: once }), once);
});

check("a long CDN URL is kept intact, not truncated into a broken one", () => {
  // ImageKit transformation URLs get long; truncating one to 500 chars would
  // persist a URL that 404s. Anything within the cap must survive byte-exact.
  const long = "https://ik.imagekit.io/t/hero.webp?tr=" + "w-2000,".repeat(60);
  assert.ok(long.length > 400 && long.length < HERO_MEDIA_MAX_HTTP_URL_LEN);
  assert.equal(normalizeHeroMedia({ heroMedia: { url: long } }).url, long);
});

check("an http URL past the cap is REJECTED, never silently truncated", () => {
  const tooLong = "https://ik.imagekit.io/t/hero.webp?tr=" + "a".repeat(HERO_MEDIA_MAX_HTTP_URL_LEN);
  assert.equal(normalizeHeroMedia({ heroMedia: { url: tooLong } }).url, "");
});

// ──────────────────────────── heroMediaSrcIssue ──────────────────────────────
// The editor asks this BEFORE storing an upload result, so an image the server
// would silently drop is reported to the owner instead of vanishing on save.
console.log("heroMediaSrcIssue");

check("a good https URL has no issue", () => {
  assert.equal(heroMediaSrcIssue("https://ik.imagekit.io/t/hero.webp"), null);
});

check("a small data:image URL has no issue", () => {
  assert.equal(heroMediaSrcIssue("data:image/png;base64,iVBORw0KGgo="), null);
});

check("an oversized data: URL reports 'too-large' (not silently dropped)", () => {
  const huge = "data:image/png;base64," + "A".repeat(HERO_MEDIA_MAX_URL_LEN + 10);
  assert.equal(heroMediaSrcIssue(huge), "too-large");
});

check("an oversized http URL reports 'too-large'", () => {
  assert.equal(
    heroMediaSrcIssue("https://x.io/" + "a".repeat(HERO_MEDIA_MAX_HTTP_URL_LEN)),
    "too-large",
  );
});

check("a javascript: URL reports 'unsupported'", () => {
  assert.equal(heroMediaSrcIssue("javascript:alert(1)"), "unsupported");
});

check("a non-image data: URL reports 'unsupported'", () => {
  assert.equal(heroMediaSrcIssue("data:text/html;base64,PHNjcmlwdD4="), "unsupported");
});

check("an empty src reports no issue (nothing to complain about yet)", () => {
  assert.equal(heroMediaSrcIssue(""), null);
});

check("every src heroMediaSrcIssue clears is one normalizeHeroMedia keeps", () => {
  // The guarantee the editor relies on: no issue ⇒ the value survives the save.
  for (const src of [
    "https://ik.imagekit.io/t/hero.webp",
    "http://shop.example.io/banner.jpg",
    "data:image/png;base64,iVBORw0KGgo=",
  ]) {
    assert.equal(heroMediaSrcIssue(src), null);
    assert.equal(normalizeHeroMedia({ heroMedia: { url: src } }).url, src);
  }
});

// ──────────────────────────── resolveHeroMedia ───────────────────────────────
console.log("resolveHeroMedia");

check("no heroMedia config at all → written hero (legacy tenants unaffected)", () => {
  const r = resolveHeroMedia({});
  assert.equal(r.mode, "text");
  assert.equal(r.url, "");
});

check("image mode WITH an image → image hero", () => {
  const r = resolveHeroMedia({ heroMedia: { mode: "image", url: "https://x.io/a.jpg" } });
  assert.equal(r.mode, "image");
  assert.equal(r.url, "https://x.io/a.jpg");
});

check("image mode WITHOUT an image falls back to the written hero", () => {
  const r = resolveHeroMedia({ heroMedia: { mode: "image", url: "" } });
  assert.equal(r.mode, "text");
});

check("image mode whose URL was stripped as unsafe falls back to written hero", () => {
  const r = resolveHeroMedia({ heroMedia: { mode: "image", url: "javascript:alert(1)" } });
  assert.equal(r.mode, "text");
});

check("text mode ignores an uploaded image", () => {
  const r = resolveHeroMedia({ heroMedia: { mode: "text", url: "https://x.io/a.jpg" } });
  assert.equal(r.mode, "text");
});

// ──────────────────────────── CSS helpers ────────────────────────────────────
console.log("heroMediaAspect / heroMediaPosition / heroMediaScrimAlpha");

check("ratio keys map to the designed aspect ratios", () => {
  assert.equal(heroMediaAspect("wide"), "3 / 1");
  assert.equal(heroMediaAspect("standard"), "2 / 1");
  assert.equal(heroMediaAspect("tall"), "3 / 2");
});

check("unknown ratio falls back to standard", () => {
  assert.equal(heroMediaAspect("nonsense"), "2 / 1");
});

check("focus keys map to object-position values", () => {
  assert.equal(heroMediaPosition("center"), "center");
  assert.equal(heroMediaPosition("top"), "top");
  assert.equal(heroMediaPosition("bottom"), "bottom");
  assert.equal(heroMediaPosition("left"), "left");
  assert.equal(heroMediaPosition("right"), "right");
});

check("unknown focus falls back to center", () => {
  assert.equal(heroMediaPosition("sideways"), "center");
});

check("scrim alpha is 0 whenever the overlay is off", () => {
  assert.equal(heroMediaScrimAlpha({ overlay: false, scrim: 70 }), 0);
});

check("scrim alpha is the percentage as a 0..1 fraction when overlay is on", () => {
  assert.equal(heroMediaScrimAlpha({ overlay: true, scrim: 30 }), 0.3);
  assert.equal(heroMediaScrimAlpha({ overlay: true, scrim: 0 }), 0);
  assert.equal(heroMediaScrimAlpha({ overlay: true, scrim: 70 }), 0.7);
});

// ──────────────────────────── resolveHeroMediaLink ───────────────────────────
console.log("resolveHeroMediaLink");

check("linkType none → inert banner", () => {
  assert.deepEqual(resolveHeroMediaLink({ linkType: "none" }), { kind: "none" });
});

check("custom + valid URL → external target", () => {
  assert.deepEqual(resolveHeroMediaLink({ linkType: "custom", linkUrl: "https://x.io" }), {
    kind: "external",
    url: "https://x.io",
  });
});

check("custom + unsafe URL → inert (never navigates to javascript:)", () => {
  assert.deepEqual(resolveHeroMediaLink({ linkType: "custom", linkUrl: "javascript:alert(1)" }), {
    kind: "none",
  });
});

check("page catalog → catalog target", () => {
  assert.deepEqual(resolveHeroMediaLink({ linkType: "page", linkPage: "catalog" }), { kind: "catalog" });
});

check("page home → home target", () => {
  assert.deepEqual(resolveHeroMediaLink({ linkType: "page", linkPage: "home" }), { kind: "home" });
});

check("page track → route target", () => {
  assert.deepEqual(resolveHeroMediaLink({ linkType: "page", linkPage: "track" }), {
    kind: "route",
    route: "track",
  });
});

check("no config defaults to the catalog (matches the primary CTA default)", () => {
  assert.deepEqual(resolveHeroMediaLink({}), { kind: "catalog" });
});

// ──────────────────────────── summary ────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
