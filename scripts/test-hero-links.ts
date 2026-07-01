/**
 * Self-contained test for the hero CTA link core — the pure module both the
 * store-admin save action and the live storefront depend on:
 *
 *   - src/lib/storefront/hero-links.ts
 *       safeHttpUrl()          — scheme allowlist (http/https only)
 *       normalizeHeroLinks()   — coerces untrusted CTA link config into a closed,
 *                                safe shape before it is written to branding.config
 *       resolveHeroCtaLink()   — resolves stored config into a navigation target
 *                                (used to wire the storefront hero buttons)
 *       HERO_LINK_PAGES        — the route allowlist
 *
 * Runs the REAL module (no DB, no Next runtime, no browser):
 *
 *   npm run test:hero-links
 */

import assert from "node:assert";

import {
  HERO_LINK_PAGES,
  safeHttpUrl,
  normalizeHeroLinks,
  resolveHeroCtaLink,
} from "../src/lib/storefront/hero-links";

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

// ──────────────────────────── safeHttpUrl ────────────────────────────────────
console.log("safeHttpUrl");
check("keeps https URLs", () => {
  assert.equal(safeHttpUrl("https://example.com/promo"), "https://example.com/promo");
});
check("keeps http URLs", () => {
  assert.equal(safeHttpUrl("http://shop.example.io/a?b=1"), "http://shop.example.io/a?b=1");
});
check("trims surrounding whitespace", () => {
  assert.equal(safeHttpUrl("  https://x.io  "), "https://x.io");
});
check("rejects javascript: scheme", () => {
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
});
check("rejects data: scheme", () => {
  assert.equal(safeHttpUrl("data:text/html,<script>x</script>"), "");
});
check("rejects ftp: scheme", () => {
  assert.equal(safeHttpUrl("ftp://files.example.com/x"), "");
});
check("rejects non-URL garbage", () => {
  assert.equal(safeHttpUrl("not a url"), "");
});
check("empty/undefined → empty string", () => {
  assert.equal(safeHttpUrl(""), "");
  assert.equal(safeHttpUrl(undefined), "");
});
check("caps length to 500 chars before parsing", () => {
  const long = "https://x.io/" + "a".repeat(1000);
  assert.ok(safeHttpUrl(long).length <= 500);
});

// ──────────────────────────── normalizeHeroLinks ─────────────────────────────
console.log("normalizeHeroLinks");
check("empty input → safe defaults (cta1 catalog / cta2 reviews, page type)", () => {
  const out = normalizeHeroLinks({});
  assert.equal(out.heroCta1LinkType, "page");
  assert.equal(out.heroCta1LinkPage, "catalog");
  assert.equal(out.heroCta1LinkUrl, "");
  assert.equal(out.heroCta2LinkType, "page");
  assert.equal(out.heroCta2LinkPage, "reviews");
  assert.equal(out.heroCta2LinkUrl, "");
});
check("unknown page route falls back to per-button default", () => {
  const out = normalizeHeroLinks({
    heroCta1LinkPage: "totally-made-up",
    heroCta2LinkPage: "also-bogus",
  });
  assert.equal(out.heroCta1LinkPage, "catalog");
  assert.equal(out.heroCta2LinkPage, "reviews");
});
check("known page route is preserved", () => {
  const out = normalizeHeroLinks({ heroCta1LinkPage: "faq", heroCta2LinkPage: "protocols" });
  assert.equal(out.heroCta1LinkPage, "faq");
  assert.equal(out.heroCta2LinkPage, "protocols");
});
check("custom type keeps a valid http(s) URL", () => {
  const out = normalizeHeroLinks({
    heroCta1LinkType: "custom",
    heroCta1LinkUrl: "https://example.com/sale",
  });
  assert.equal(out.heroCta1LinkType, "custom");
  assert.equal(out.heroCta1LinkUrl, "https://example.com/sale");
});
check("custom type strips a javascript: URL", () => {
  const out = normalizeHeroLinks({
    heroCta1LinkType: "custom",
    heroCta1LinkUrl: "javascript:alert(document.cookie)",
  });
  assert.equal(out.heroCta1LinkUrl, "");
});
check("page type drops any provided custom URL", () => {
  const out = normalizeHeroLinks({
    heroCta1LinkType: "page",
    heroCta1LinkUrl: "https://example.com/ignored",
  });
  assert.equal(out.heroCta1LinkUrl, "");
});
check("unknown link type coerces to 'page'", () => {
  const out = normalizeHeroLinks({ heroCta1LinkType: "bogus" });
  assert.equal(out.heroCta1LinkType, "page");
});
check("null / non-object input does not throw", () => {
  assert.doesNotThrow(() => normalizeHeroLinks(null));
  assert.doesNotThrow(() => normalizeHeroLinks(undefined));
  assert.doesNotThrow(() => normalizeHeroLinks(42));
});

// ──────────────────────────── resolveHeroCtaLink ─────────────────────────────
console.log("resolveHeroCtaLink");
check("custom + valid URL → external target", () => {
  const t = resolveHeroCtaLink({ type: "custom", url: "https://example.com" }, 1);
  assert.deepEqual(t, { kind: "external", url: "https://example.com" });
});
check("custom + unsafe URL → none (inert)", () => {
  const t = resolveHeroCtaLink({ type: "custom", url: "javascript:alert(1)" }, 1);
  assert.deepEqual(t, { kind: "none" });
});
check("page catalog → catalog target", () => {
  const t = resolveHeroCtaLink({ type: "page", page: "catalog" }, 1);
  assert.deepEqual(t, { kind: "catalog" });
});
check("page home → home target", () => {
  const t = resolveHeroCtaLink({ type: "page", page: "home" }, 1);
  assert.deepEqual(t, { kind: "home" });
});
check("page reviews → route target", () => {
  const t = resolveHeroCtaLink({ type: "page", page: "reviews" }, 2);
  assert.deepEqual(t, { kind: "route", route: "reviews" });
});
check("primary with no config defaults to catalog (legacy behaviour preserved)", () => {
  const t = resolveHeroCtaLink({}, 1);
  assert.deepEqual(t, { kind: "catalog" });
});
check("secondary with no config defaults to reviews route", () => {
  const t = resolveHeroCtaLink({}, 2);
  assert.deepEqual(t, { kind: "route", route: "reviews" });
});

// ──────────────────────────── HERO_LINK_PAGES ────────────────────────────────
console.log("HERO_LINK_PAGES");
check("contains home, catalog and every toggle-able sub-page", () => {
  for (const route of ["home", "catalog", "reviews", "faq", "coa", "protocols", "calculator", "track", "merchant"]) {
    assert.ok(HERO_LINK_PAGES.has(route), `missing route: ${route}`);
  }
});

// ──────────────────────────── summary ────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
