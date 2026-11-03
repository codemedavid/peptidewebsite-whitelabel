/**
 * Tests for the INTL & LOCAL storefront layout and the reusable section
 * background system:
 *
 *   src/lib/storefront/section-background.ts   (image/overlay layers)
 *   src/lib/storefront/intl-local/{config,normalize,links}.ts
 *   registration in home-layout.ts / resolveHomeLayout / branding-update
 *   src/storefront/intl-local.css + section-background.css
 *
 *   npm run test:intl-local
 *
 * The layout is a REUSABLE, fully owner-editable TEMPLATE. These tests are the
 * guarantees behind that: stored config is always coerced into a safe closed
 * shape (old / missing / hostile values included), a link with nowhere real to
 * go is never rendered, a background image's opacity can only ever reach the
 * image layer, and the CSS can't leak onto other layouts.
 *
 * Pure: no DB, no browser.
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HOME_LAYOUTS, isIntlLocalLayout } from "../src/lib/storefront/home-layout";
import { resolveHomeLayout } from "../src/lib/storefront/two-ways-home";
import { buildTenantBrandingUpdate } from "../src/lib/tenant/branding-update";
import {
  backgroundVars,
  colorBackground,
  DEFAULT_IMAGE_OPACITY,
  hasBackgroundImage,
  normalizeBackground,
  safeCssColor,
} from "../src/lib/storefront/section-background";
import { DEFAULT_INTL_LOCAL, IL_LIMITS, IL_SECTION_KEYS } from "../src/lib/storefront/intl-local/config";
import { normalizeIntlLocalConfig, normalizeOrder } from "../src/lib/storefront/intl-local/normalize";
import {
  CONTACT_LINK,
  catalogLink,
  infoLink,
  normalizeLink,
  pageLink,
  resolveIlLink,
  safeLinkUrl,
  sectionLink,
  targetHref,
  urlLink,
  type IlLinkContext,
} from "../src/lib/storefront/intl-local/links";
import { themeDeclarations } from "../src/storefront/components/intl-local/il-style";
import { fillCopyright } from "../src/storefront/components/intl-local/IntlLocalFooter";

const ROOT = join(__dirname, "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const LAYOUT_CSS = strip(readFileSync(join(ROOT, "src/storefront/intl-local.css"), "utf8"));
const BG_CSS = strip(readFileSync(join(ROOT, "src/storefront/section-background.css"), "utf8"));
const STOREFRONT_CSS = readFileSync(join(ROOT, "src/storefront/storefront.css"), "utf8");
const SCOPE = '.sf-root[data-sf-home="intl-local"]';

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

const ctx = (over: Partial<IlLinkContext> = {}): IlLinkContext => ({
  isPageVisible: (r) => r !== "merchant",
  contactUrl: "",
  infoIds: new Set(),
  categoryIds: new Set(["peptides"]),
  ...over,
});

// ── Registration ─────────────────────────────────────────────────────────────
console.log("\nhome-layout — intl-local is an additional, owner-selectable layout");

check("HOME_LAYOUTS appends intl-local and keeps every existing layout", () => {
  for (const l of ["classic", "two-ways", "boutique", "editorial", "showcase", "groupbuy"]) {
    assert.ok((HOME_LAYOUTS as readonly string[]).includes(l), `${l} missing`);
  }
  assert.equal(HOME_LAYOUTS[HOME_LAYOUTS.length - 1], "intl-local");
});

check("isIntlLocalLayout matches the stored value exactly", () => {
  assert.equal(isIntlLocalLayout("intl-local"), true);
  for (const v of ["Intl-Local", " intl-local", "intl_local", "", null, undefined, 1]) assert.equal(isIntlLocalLayout(v), false);
});

check("resolveHomeLayout gives it to an unentitled tenant (no grant needed)", () => {
  assert.equal(resolveHomeLayout(false, "intl-local"), "intl-local");
  assert.equal(resolveHomeLayout(true, "intl-local"), "intl-local");
});

check("other layouts resolve exactly as before", () => {
  assert.equal(resolveHomeLayout(false, "showcase"), "showcase");
  assert.equal(resolveHomeLayout(false, undefined), "classic");
  assert.equal(resolveHomeLayout(true, undefined), "two-ways");
  assert.equal(resolveHomeLayout(false, "groupbuy", false), "classic");
});

check("the branding allow-list (MCP / operator) accepts intl-local", () => {
  const res = buildTenantBrandingUpdate({ config: {} }, { layout: { homeLayout: "intl-local" } });
  assert.deepEqual(res.errors, []);
  assert.equal(res.config.homeLayout, "intl-local");
});

check("the operator layout picker offers it", () => {
  const panel = readFileSync(join(ROOT, "src/storefront/tweaks/BoutiqueEditor.tsx"), "utf8");
  assert.ok(/:\s*"intl-local",/.test(panel));
});

check("the store admin registers the Website Layout view as a gated module", () => {
  const perms = readFileSync(join(ROOT, "src/storefront/admin/staff-permissions.ts"), "utf8");
  const nav = readFileSync(join(ROOT, "src/storefront/admin/admin-nav.ts"), "utf8");
  const page = readFileSync(join(ROOT, "src/storefront/admin/AdminPage.tsx"), "utf8");
  assert.ok(perms.includes('key: "site-layout"'));
  assert.ok(nav.includes('view: "site-layout"'));
  assert.ok(page.includes('"site-layout"') && page.includes("AdminSiteBuilder"));
});

// ── Background system ───────────────────────────────────────────────────────
console.log("\nsection-background — image opacity never touches the content");

check("default image opacity is subtle (15–20%)", () => {
  assert.ok(DEFAULT_IMAGE_OPACITY >= 15 && DEFAULT_IMAGE_OPACITY <= 20);
  assert.equal(colorBackground("#fff").imageOpacity, DEFAULT_IMAGE_OPACITY);
});

check("opacity and overlay become 0..1 vars for the two separate layers", () => {
  const vars = backgroundVars({
    ...colorBackground("#ECE6FB"),
    type: "image-color",
    imageUrl: "https://ik.imagekit.io/x/card.png",
    imageOpacity: 15,
    overlayColor: "#2E1268",
    overlayOpacity: 40,
  });
  assert.equal(vars["--sbg-color"], "#ECE6FB");
  assert.equal(vars["--sbg-image-opacity"], "0.15");
  assert.equal(vars["--sbg-overlay-opacity"], "0.4");
  assert.ok(vars["--sbg-image"].startsWith('url("https://ik.imagekit.io/x/card.png'));
  assert.ok(vars["--sbg-image"].includes("tr="), "ImageKit backgrounds are resized for loading performance");
});

check("type colour paints no image even when one is stored; type image has no colour", () => {
  const stored = { ...colorBackground("#fff"), imageUrl: "https://e.test/a.png" };
  assert.equal(backgroundVars({ ...stored, type: "color" })["--sbg-image"], "none");
  assert.equal(hasBackgroundImage({ ...stored, type: "color" }), false);
  assert.equal(backgroundVars({ ...stored, type: "image" })["--sbg-color"], "transparent");
});

check("an image URL can't break out of url(\"…\")", () => {
  const v = backgroundVars({ ...colorBackground(""), type: "image", imageUrl: 'https://e.test/a.png?x=")};body{color:red' });
  assert.ok(!/"\)\s*;/.test(v["--sbg-image"].slice(5, -2)), v["--sbg-image"]);
  assert.equal((v["--sbg-image"].match(/"/g) ?? []).length, 2);
});

check("normalizeBackground clamps, drops unsafe values and keeps an explicit blank colour", () => {
  const fb = colorBackground("#FAD6E1");
  const bg = normalizeBackground(
    { type: "video", color: "red;}", imageUrl: "javascript:alert(1)", imageOpacity: 900, position: "middle", size: "huge", overlayOpacity: -5 },
    fb,
  );
  assert.equal(bg.type, "color");
  assert.equal(bg.color, "");
  assert.equal(bg.imageUrl, "");
  assert.equal(bg.imageOpacity, 100);
  assert.equal(bg.position, "center");
  assert.equal(bg.size, "cover");
  assert.equal(bg.overlayOpacity, 0);
  assert.equal(normalizeBackground({}, fb).color, "#FAD6E1", "missing key falls back");
  assert.equal(normalizeBackground({ color: "" }, fb).color, "", "blank is a real choice");
});

check("safeCssColor accepts hex / rgb / hsl only", () => {
  for (const ok of ["#fff", "#FAD6E1", "rgb(1, 2, 3)", "rgba(1,2,3,.5)", "hsl(200 50% 50%)"]) assert.equal(safeCssColor(ok), ok);
  for (const bad of ["red", "url(x)", "#fff;color:red", "expression(1)", 12]) assert.equal(safeCssColor(bad), "");
});

check("CSS: opacity lives on the ::before / ::after layers, never on .sbg itself", () => {
  const sbg = BG_CSS.match(/\.sbg\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.ok(!/opacity/.test(sbg), ".sbg must not set opacity");
  assert.ok(/isolation:\s*isolate/.test(sbg) && /overflow:\s*hidden/.test(sbg));
  assert.ok(/\.sbg::before\s*\{[^}]*opacity:\s*var\(--sbg-image-opacity/.test(BG_CSS));
  assert.ok(/\.sbg::after\s*\{[^}]*opacity:\s*var\(--sbg-overlay-opacity/.test(BG_CSS));
  assert.ok(/pointer-events:\s*none/.test(BG_CSS), "layers must not block clicks");
  assert.ok(/border-radius:\s*inherit/.test(BG_CSS));
});

// ── Config normalization ────────────────────────────────────────────────────
console.log("\nintl-local config — every tenant gets a complete, safe config");

check("absent config → the full reference defaults", () => {
  assert.deepEqual(normalizeIntlLocalConfig(undefined), normalizeIntlLocalConfig(DEFAULT_INTL_LOCAL));
  const c = normalizeIntlLocalConfig(null);
  assert.equal(c.hero.title, "Discover. Understand. Choose.");
  assert.deepEqual(c.nav.map((n) => n.label), ["Learn", "Shop", "Community", "Help", "Account"]);
  assert.equal(c.markets.cards.length, 2);
  assert.equal(c.learn.cards.length, 3);
});

check("normalize is idempotent (save → reload gives back the same config)", () => {
  const once = normalizeIntlLocalConfig({ hero: { title: "Hi" }, nav: [{ id: "x", label: "X" }] });
  assert.deepEqual(normalizeIntlLocalConfig(JSON.parse(JSON.stringify(once))), once);
});

check("an older / partial config keeps what it has and fills the rest", () => {
  const c = normalizeIntlLocalConfig({ hero: { title: "Shop smarter" } });
  assert.equal(c.hero.title, "Shop smarter");
  assert.equal(c.hero.eyebrow, DEFAULT_INTL_LOCAL.hero.eyebrow);
  assert.deepEqual(c.footer, normalizeIntlLocalConfig({}).footer);
});

check("a cleared field stays cleared (no sample copy resurrected)", () => {
  const c = normalizeIntlLocalConfig({ hero: { eyebrow: "", description: "" }, footer: { tagline: "" } });
  assert.equal(c.hero.eyebrow, "");
  assert.equal(c.hero.description, "");
  assert.equal(c.footer.tagline, "");
});

check("the template carries no tenant identity", () => {
  const c = normalizeIntlLocalConfig({});
  assert.equal(c.header.brandName, "", "brand name falls back to the store's own name");
  assert.equal(c.footer.brandName, "");
  assert.equal(c.header.logoUrl, "");
});

check("unknown keys are dropped; text is capped", () => {
  const c = normalizeIntlLocalConfig({ evil: 1, hero: { title: "x".repeat(999), onclick: "x" } }) as unknown as Record<string, unknown>;
  assert.equal("evil" in c, false);
  const hero = c.hero as Record<string, unknown>;
  assert.equal("onclick" in hero, false);
  assert.ok(String(hero.title).length <= IL_LIMITS.short * 2);
});

check("lists keep owner order, cap length, and make ids safe + unique", () => {
  const nav = Array.from({ length: 20 }, (_, i) => ({ id: i < 2 ? "dup" : `m${i}`, label: `M${i}` }));
  const c = normalizeIntlLocalConfig({ nav: [{ id: "<script>", label: "Bad" }, ...nav] });
  assert.equal(c.nav.length, IL_LIMITS.nav);
  const ids = c.nav.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^[a-z0-9][a-z0-9-]*$/.test(id)));
  assert.equal(c.nav[0].label, "Bad");
});

check("an owner can empty a list (no menu, no cards) without it refilling", () => {
  const c = normalizeIntlLocalConfig({ nav: [], learn: { cards: [] }, markets: { cards: [] } });
  assert.equal(c.nav.length, 0);
  assert.equal(c.learn.cards.length, 0);
  assert.equal(c.markets.cards.length, 0);
});

check("unsafe colours, fonts and image sources fall back", () => {
  const c = normalizeIntlLocalConfig({
    theme: { accent: "red}body{x:1", headingFont: "Comic Hack", radius: 999 },
    hero: { imageUrl: "javascript:alert(1)" },
  });
  assert.equal(c.theme.accent, DEFAULT_INTL_LOCAL.theme.accent);
  assert.equal(c.theme.headingFont, DEFAULT_INTL_LOCAL.theme.headingFont);
  assert.equal(c.theme.radius, 40);
  assert.equal(c.hero.imageUrl, "");
});

check("the theme <style> can't be broken out of", () => {
  const decl = themeDeclarations(normalizeIntlLocalConfig({ theme: { ink: "#000;}*{x:1" } }).theme);
  assert.ok(!decl.includes("}") && !decl.includes("{"), decl);
  assert.ok(decl.includes("--il-accent:"));
  assert.ok(themeDeclarations({ ...DEFAULT_INTL_LOCAL.theme, useBrandColors: true }).includes("--il-accent:var(--brand-main)"));
});

check("section order: every section once, customs kept, dangling dropped", () => {
  assert.deepEqual(normalizeOrder(undefined, []), [...IL_SECTION_KEYS]);
  assert.deepEqual(normalizeOrder(["newsletter", "hero", "hero", "custom:gone", "junk"], ["promo"]), [
    "newsletter",
    "hero",
    "markets",
    "learn",
    "community",
    "custom:promo",
  ]);
  const c = normalizeIntlLocalConfig({ customSections: [{ id: "promo", title: "Sale" }], order: ["custom:promo", "hero"] });
  assert.equal(c.order[0], "custom:promo");
  assert.equal(c.customSections[0].title, "Sale");
});

// ── Links ───────────────────────────────────────────────────────────────────
console.log("\nintl-local links — no dead buttons");

check("a page the store switched off resolves to null (link not drawn)", () => {
  assert.equal(resolveIlLink(pageLink("merchant"), ctx()), null);
  assert.deepEqual(resolveIlLink(pageLink("faq"), ctx()), { kind: "route", route: "faq" });
  assert.deepEqual(resolveIlLink(pageLink("home"), ctx()), { kind: "home" });
});

check("catalog links keep a real category and drop a deleted one", () => {
  assert.deepEqual(resolveIlLink(catalogLink("peptides"), ctx()), { kind: "catalog", category: "peptides" });
  assert.deepEqual(resolveIlLink(catalogLink("gone"), ctx()), { kind: "catalog", category: "" });
  assert.equal(resolveIlLink(catalogLink(), ctx({ isPageVisible: (r) => r !== "catalog" })), null);
});

check("custom URLs: empty and active schemes are refused; web, mailto, tel allowed", () => {
  assert.equal(resolveIlLink(urlLink(""), ctx()), null);
  assert.equal(resolveIlLink(urlLink("javascript:alert(1)"), ctx()), null);
  assert.equal(resolveIlLink(urlLink("data:text/html,x"), ctx()), null);
  assert.equal(safeLinkUrl("mystore.com/usd"), "https://mystore.com/usd");
  assert.equal(safeLinkUrl("mailto:hi@store.com"), "mailto:hi@store.com");
  assert.equal(safeLinkUrl("tel:+63 917 123 4567"), "tel:+63 917 123 4567");
});

check("contact links need a channel; info links need written text", () => {
  assert.equal(resolveIlLink(CONTACT_LINK, ctx()), null);
  assert.deepEqual(resolveIlLink(CONTACT_LINK, ctx({ contactUrl: "https://m.me/x" })), { kind: "external", url: "https://m.me/x" });
  assert.equal(resolveIlLink(infoLink("about"), ctx()), null);
  assert.deepEqual(resolveIlLink(infoLink("about"), ctx({ infoIds: new Set(["about"]) })), { kind: "info", id: "about" });
});

check("normalizeLink keeps only the field its type uses", () => {
  const l = normalizeLink({ type: "page", page: "faq", url: "https://evil.test", infoId: "x" });
  assert.deepEqual(l, { ...pageLink("faq") });
  assert.equal(normalizeLink({ type: "page", page: "nope" }).page, "home");
  assert.equal(normalizeLink({ type: "bogus" }).type, "none");
  assert.equal(normalizeLink({ type: "section", section: "evil" }).section, "markets");
});

check("targetHref gives every target a real, non-script href", () => {
  assert.equal(targetHref({ kind: "section", section: "newsletter" }), "#il-newsletter");
  assert.equal(targetHref({ kind: "route", route: "faq" }), "#faq");
  assert.equal(resolveIlLink(sectionLink("newsletter"), ctx())?.kind, "section");
});

check("defaults: each market card opens its own shop page — and USD only when the store sells in two markets", () => {
  const intl = DEFAULT_INTL_LOCAL.markets.cards.find((c) => c.id === "international");
  const local = DEFAULT_INTL_LOCAL.markets.cards.find((c) => c.id === "local");
  assert.ok(intl && local);
  assert.equal(intl.currency, "USD");
  // One market (dual-currency off): never a wrong-currency catalog.
  assert.equal(resolveIlLink(intl.button.link, ctx()), null);
  assert.deepEqual(resolveIlLink(local.button.link, ctx()), { kind: "catalog", category: "" });
  // Two markets: each its own shop page.
  assert.deepEqual(resolveIlLink(intl.button.link, ctx({ dualMarket: true })), { kind: "route", route: "shop-international" });
  assert.deepEqual(resolveIlLink(local.button.link, ctx({ dualMarket: true })), { kind: "route", route: "shop-local" });
});

check("market links survive normalizeLink and fall back to local", () => {
  assert.equal(normalizeLink({ type: "market", market: "international" }).market, "international");
  assert.equal(normalizeLink({ type: "market", market: "mars" }).market, "local");
  assert.equal(normalizeLink({ type: "page", page: "faq", market: "international" }).market, undefined);
});

check("defaults: the hero's Shop button leads to the market choice, not one catalog", () => {
  const shop = DEFAULT_INTL_LOCAL.hero.buttons.find((b) => b.label === "Shop Products");
  assert.ok(shop);
  assert.deepEqual(resolveIlLink(shop.link, ctx()), { kind: "section", section: "markets" });
  assert.equal(targetHref({ kind: "section", section: "markets" }), "#il-markets");
});

check("defaults: footer info pages stay hidden until the owner writes them", () => {
  const c = normalizeIntlLocalConfig({});
  assert.ok(c.infoPages.every((p) => p.body === ""));
  const about = c.footer.links.find((l) => l.id === "about");
  assert.ok(about);
  assert.equal(resolveIlLink(about.link, ctx()), null);
});

check("fillCopyright fills {year} and {brand}", () => {
  assert.equal(fillCopyright("© {year} {brand}.", "Acme", 2026), "© 2026 Acme.");
});

// ── CSS scope ───────────────────────────────────────────────────────────────
console.log("\nintl-local.css — scoped, token-driven");

check("every rule is scoped to the intl-local root", () => {
  const body = LAYOUT_CSS.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "");
  const preludes = [...body.matchAll(/(?:^|[}{;])([^{};]*)\{/g)].map((m) => m[1].trim()).filter((s) => s && !s.startsWith("@"));
  // Split selector lists on TOP-LEVEL commas only (not those inside :is(…)).
  const split = (sel: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of sel) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    return [...out, cur.trim()];
  };
  const bad = preludes.flatMap(split).filter((s) => s && !s.startsWith(SCOPE));
  assert.deepEqual(bad, []);
});

check("no colour literals — every colour is a token", () => {
  const literals = LAYOUT_CSS.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) ?? [];
  assert.deepEqual(literals, []);
});

check("every --brand-* var it reads is one the storefront defines", () => {
  const used = new Set([...LAYOUT_CSS.matchAll(/var\(--(brand-[a-z0-9-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((v) => !STOREFRONT_CSS.includes(`--${v}:`));
  assert.deepEqual(missing, []);
});

check("root-level styles fall back to the brand (the admin renders in this root)", () => {
  const root = LAYOUT_CSS.match(/\.sf-root\[data-sf-home="intl-local"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.ok(/background:\s*var\(--il-page,\s*var\(--brand-background\)\)/.test(root));
  assert.ok(/font-family:\s*var\(--il-font-body,\s*var\(--brand-body-font\)\)/.test(root));
});

check("responsive breakpoints are container queries (true phone layout in the admin preview)", () => {
  assert.ok(/@container il-header \(max-width: 959px\)/.test(LAYOUT_CSS));
  assert.ok(/@container il-main/.test(LAYOUT_CSS));
  assert.ok(!/\.il-catalog\s*\{[^}]*container/.test(LAYOUT_CSS), "the catalog screen hosts fixed modals — never a container");
});

check("decorative card images blend into the card by default, on their own layer", () => {
  const card = normalizeIntlLocalConfig({}).markets.cards[0];
  assert.equal(card.imageBlend, "blend");
  assert.equal(card.imageSize, "md");
  assert.equal(card.imageOpacity, 90);
  const old = normalizeIntlLocalConfig({ markets: { cards: [{ id: "local", imageUrl: "https://e.test/flag.png" }] } }).markets.cards[0];
  assert.equal(old.imageBlend, "blend", "a card saved before the setting existed blends too");
  assert.equal(normalizeIntlLocalConfig({ markets: { cards: [{ id: "x", imageBlend: "glitter", imageOpacity: 400 }] } }).markets.cards[0].imageBlend, "blend");
  assert.equal(normalizeIntlLocalConfig({ markets: { cards: [{ id: "x", imageOpacity: 400 }] } }).markets.cards[0].imageOpacity, 100);
  // The blend must sit on the layer: an img inside an opacity < 1 layer blends only with that layer.
  assert.ok(/\.il-market__art--blend \{ mix-blend-mode: multiply; \}/.test(LAYOUT_CSS));
  assert.ok(!/\.il-market__art--\w+ img \{ mix-blend-mode/.test(LAYOUT_CSS));
  assert.ok(/\.il-market__art \{ opacity: var\(--il-art-opacity/.test(LAYOUT_CSS));
  assert.ok(!/\.il-market__art \{ width: 96px; opacity: 0\.55; \}/.test(LAYOUT_CSS), "the phone rule must not override the owner's opacity");
  // "cover" fills the card under the copy, mixed into the card colour.
  const cover = LAYOUT_CSS.match(/\.il-market__art--cover \{([^}]*)\}/)?.[1] ?? "";
  assert.ok(/inset: 0/.test(cover) && /z-index: 0/.test(cover) && /mix-blend-mode: multiply/.test(cover), cover);
  assert.ok(/\.il-market__art--cover img \{[^}]*object-fit: cover/.test(LAYOUT_CSS));
  assert.equal(normalizeIntlLocalConfig({ markets: { cards: [{ id: "x", imageBlend: "cover" }] } }).markets.cards[0].imageBlend, "cover");
  assert.equal(normalizeIntlLocalConfig({}).markets.cards[0].imageFocus, "center");
  assert.equal(normalizeIntlLocalConfig({ markets: { cards: [{ id: "x", imageFocus: "top" }] } }).markets.cards[0].imageFocus, "top");
  assert.equal(normalizeIntlLocalConfig({ markets: { cards: [{ id: "x", imageFocus: "sideways" }] } }).markets.cards[0].imageFocus, "center");
  assert.ok(/object-position: var\(--il-art-pos, center\)/.test(LAYOUT_CSS));
});

check("reduced motion turns the layout's motion off", () => {
  assert.ok(/prefers-reduced-motion:\s*reduce/.test(LAYOUT_CSS));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
