/**
 * Tests for the SHOWCASE storefront layout — src/lib/storefront/showcase-home.ts,
 * its registration in home-layout.ts / resolveHomeLayout, and showcase.css.
 *
 *   npm run test:showcase-home
 *
 * The layout is a REUSABLE TEMPLATE. It must carry no tenant content of its own:
 * no business name, no palette, no products, no categories. Everything it draws
 * is composed from data the tenant already has, and every section disappears
 * when its data is empty. These tests are that guarantee.
 *
 * Pure: no DB, no browser.
 */

import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  HOME_LAYOUTS,
  isBoutiqueLayout,
  isEditorialLayout,
  isShowcaseLayout,
} from "../src/lib/storefront/home-layout";
import {
  showcaseSections,
  buildShowcaseFeatured,
  SHOWCASE_FEATURED_MAX,
  heroShowcaseImage,
  promiseBarVars,
  collectionImage,
  assuranceIcon,
  ASSURANCE_ICONS,
  hasProtocolsHub,
  SHOWCASE_PROTOCOLS_ROUTE,
} from "../src/lib/storefront/showcase-home";
import { resolveHomeLayout } from "../src/lib/storefront/two-ways-home";
import { buildTenantBrandingUpdate } from "../src/lib/tenant/branding-update";
import type { Product } from "../src/storefront/types";

const ROOT = join(__dirname, "..");
const SHOWCASE_CSS = join(ROOT, "src/storefront/showcase.css");
const SCOPE = '[data-sf-home="showcase"]';

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

function product(p: Partial<Product> & { id: string }): Product {
  return {
    name: "Product",
    description: "",
    price: 100,
    currency: "₱",
    category: "all",
    featured: false,
    image: null,
    ...p,
  };
}

const css = (): string =>
  readFileSync(SHOWCASE_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// ── Registration ─────────────────────────────────────────────────────────────
console.log("\nhome-layout — showcase is the fifth layout");

check("HOME_LAYOUTS carries showcase after the existing four", () => {
  assert.deepEqual([...HOME_LAYOUTS], ["classic", "two-ways", "boutique", "editorial", "showcase"]);
});

check("isShowcaseLayout matches the stored value exactly and fails closed", () => {
  assert.equal(isShowcaseLayout("showcase"), true);
  for (const junk of ["Showcase", " showcase", "showcase ", "editorial", "", null, undefined, 0, {}]) {
    assert.equal(isShowcaseLayout(junk), false, `accepted ${JSON.stringify(junk)}`);
  }
});

check("no stored value answers to two owner-selectable predicates", () => {
  for (const layout of HOME_LAYOUTS) {
    const hits = [isBoutiqueLayout, isEditorialLayout, isShowcaseLayout].filter((f) => f(layout));
    assert.ok(hits.length <= 1, `"${layout}" answers to ${hits.length} predicates`);
  }
});

check("showcase needs no grant — an unentitled tenant gets it", () => {
  assert.equal(resolveHomeLayout(false, "showcase"), "showcase");
});

check("an entitled two-ways tenant that chose showcase is not dragged back", () => {
  assert.equal(resolveHomeLayout(true, "showcase"), "showcase");
});

check("the existing layouts resolve exactly as before", () => {
  assert.equal(resolveHomeLayout(false, "boutique"), "boutique");
  assert.equal(resolveHomeLayout(false, "editorial"), "editorial");
  assert.equal(resolveHomeLayout(false, "two-ways"), "classic");
  assert.equal(resolveHomeLayout(true, undefined), "two-ways");
  assert.equal(resolveHomeLayout(true, "classic"), "classic");
});

check("a branding patch accepts showcase (no silent drop on save)", () => {
  const res = buildTenantBrandingUpdate({ config: {} }, { layout: { homeLayout: "showcase" } });
  assert.deepEqual(res.errors, []);
  assert.equal(res.config.homeLayout, "showcase");
});

check("the owner's layout picker offers showcase", () => {
  const panel = readFileSync(join(ROOT, "src/storefront/tweaks/BoutiqueEditor.tsx"), "utf8");
  assert.ok(/:\s*"showcase",/.test(panel), "BoutiqueEditor OWNER_LAYOUTS has no showcase entry");
});

// ── Composition ──────────────────────────────────────────────────────────────
console.log("\nshowcaseSections — what each screen renders");

check("the home is merchandised: hero, badges, shelf, promos", () => {
  assert.deepEqual(showcaseSections("home"), ["hero", "circles", "featured", "promos"]);
});

check("the owner's promises are not repeated in a closing strip (hero + promise bar carry them)", () => {
  assert.ok(!(showcaseSections("home") as string[]).includes("assurances"));
  assert.ok(!/\.sc-trust\b/.test(readFileSync(SHOWCASE_CSS, "utf8")), "no leftover .sc-trust styles");
});

check("the home never carries the full grid", () => {
  assert.ok(!showcaseSections("home").includes("catalog"));
});

check("the catalog screen leads with the chips, then the grid", () => {
  assert.deepEqual(showcaseSections("catalog"), ["chips", "catalog"]);
});

check("no screen carries a \"Questions before you order?\" contact block — the footer has contact", () => {
  for (const view of ["home", "catalog"] as const) {
    assert.ok(!(showcaseSections(view) as string[]).includes("contact"));
  }
});

check("the returned list is a copy — callers cannot corrupt the composition", () => {
  const first = showcaseSections("home");
  first.length = 0;
  assert.equal(showcaseSections("home").length, 4);
});

// ── The featured shelf ───────────────────────────────────────────────────────
console.log("\nbuildShowcaseFeatured — the home shelf");

check("an empty or missing catalog gives an empty shelf", () => {
  assert.deepEqual(buildShowcaseFeatured([]), { products: [], curated: false });
  assert.deepEqual(buildShowcaseFeatured(null), { products: [], curated: false });
  assert.deepEqual(buildShowcaseFeatured(undefined), { products: [], curated: false });
});

check("the owner's featured products lead, in catalog order", () => {
  const list = [
    product({ id: "a" }),
    product({ id: "b", featured: true }),
    product({ id: "c" }),
    product({ id: "d", featured: true }),
  ];
  const shelf = buildShowcaseFeatured(list);
  assert.equal(shelf.curated, true);
  assert.deepEqual(shelf.products.slice(0, 2).map((p) => p.id), ["b", "d"]);
});

check("a short featured list is topped up from the catalog, never duplicated", () => {
  const list = [product({ id: "a" }), product({ id: "b", featured: true }), product({ id: "c" })];
  const ids = buildShowcaseFeatured(list).products.map((p) => p.id);
  assert.deepEqual(ids, ["b", "a", "c"]);
});

check("nothing featured → the catalog's own order, flagged not curated", () => {
  const list = Array.from({ length: 6 }, (_, i) => product({ id: `p${i}` }));
  const shelf = buildShowcaseFeatured(list);
  assert.equal(shelf.curated, false);
  assert.deepEqual(shelf.products.map((p) => p.id), ["p0", "p1", "p2", "p3"]);
});

check("the shelf is capped at one row", () => {
  const many = Array.from({ length: 20 }, (_, i) => product({ id: `f${i}`, featured: true }));
  assert.equal(buildShowcaseFeatured(many).products.length, SHOWCASE_FEATURED_MAX);
  assert.equal(buildShowcaseFeatured(many, 2).products.length, 2);
});

check("a nonsense cap falls back to the default rather than emptying the shelf", () => {
  const many = Array.from({ length: 8 }, (_, i) => product({ id: `f${i}` }));
  for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(buildShowcaseFeatured(many, bad).products.length, SHOWCASE_FEATURED_MAX);
  }
});

check("malformed rows in the catalog are skipped, not thrown on", () => {
  const list = [null, product({ id: "ok" }), { name: "no id" }] as unknown as Product[];
  assert.deepEqual(buildShowcaseFeatured(list).products.map((p) => p.id), ["ok"]);
});

check("the input list is never mutated", () => {
  const list = [product({ id: "a" }), product({ id: "b", featured: true })];
  const snapshot = list.map((p) => p.id);
  buildShowcaseFeatured(list);
  assert.deepEqual(list.map((p) => p.id), snapshot);
});

// ── Hero photography ─────────────────────────────────────────────────────────
console.log("\nheroShowcaseImage — only the owner's uploaded hero image");

const IK = (n: string) => `https://ik.imagekit.io/demo/${n}.png`;

check("an uploaded hero image is the hero's picture", () => {
  assert.equal(heroShowcaseImage(IK("hero")), IK("hero"));
});

check("no upload → no picture (the hero never borrows product photos)", () => {
  assert.equal(heroShowcaseImage(""), null);
  assert.equal(heroShowcaseImage(undefined), null);
  assert.equal(heroShowcaseImage(null), null);
});

check("unsafe URLs never reach <img>", () => {
  assert.equal(heroShowcaseImage("javascript:alert(1)"), null);
  assert.equal(heroShowcaseImage("data:text/html;base64,PHNjcmlwdD4="), null);
});

check("with no picture the hero is text-only across the full width", () => {
  const hero = readFileSync(join(ROOT, "src/storefront/components/ShowcaseHero.tsx"), "utf8");
  assert.ok(hero.includes("sc-hero--text"), "ShowcaseHero marks the text-only hero");
  assert.ok(!hero.includes("sc-hero__mark"), "no logo/monogram stand-in picture");
  assert.ok(!hero.includes("products"), "the hero does not read the catalog");
  const css = readFileSync(SHOWCASE_CSS, "utf8");
  assert.ok(/\.sc-hero--text \.sc-hero__inner\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/.test(css),
    "showcase.css collapses the text-only hero to one column");
});

// ── The collection card's photo ──────────────────────────────────────────────
console.log("\ncollectionImage — the collection card shows one of the store's own products");

check("featured product photo first, then catalog order", () => {
  const list = [product({ id: "a", image: IK("a") }), product({ id: "b", image: IK("b"), featured: true })];
  assert.equal(collectionImage(list), IK("b"));
  assert.equal(collectionImage([product({ id: "a", image: IK("a") })]), IK("a"));
});

check("no photographed product → no photo; unsafe URLs skipped", () => {
  assert.equal(collectionImage([]), null);
  assert.equal(collectionImage(null), null);
  assert.equal(collectionImage([product({ id: "a", image: "javascript:alert(1)" })]), null);
  assert.equal(collectionImage([product({ id: "a", image: "//evil.example/x.png" })]), null);
});

check("same-origin bundled paths are allowed", () => {
  assert.equal(collectionImage([product({ id: "a", image: "/seed/a.png" })]), "/seed/a.png");
});

// ── Assurance pictograms ─────────────────────────────────────────────────────
console.log("\nassuranceIcon — illustrates the owner's words, never adds to them");

check("shipping promises get the truck", () => {
  for (const label of ["Fast & Secure Shipping", "Nationwide delivery", "Same-day dispatch"]) {
    assert.equal(assuranceIcon(label), "shipping", label);
  }
});

check("authenticity and lab promises get the gem", () => {
  for (const label of ["Authentic products", "Lab-verified", "Third-party tested", "COA on every batch"]) {
    assert.equal(assuranceIcon(label), "authentic", label);
  }
});

check("support, education, quality and safety each get their own mark", () => {
  assert.equal(assuranceIcon("Supportive community"), "support");
  assert.equal(assuranceIcon("Guides & education"), "education");
  assert.equal(assuranceIcon("Quality sourcing"), "quality");
  assert.equal(assuranceIcon("Safe & responsible use"), "secure");
  assert.equal(assuranceIcon("Discreet packaging"), "secure");
  assert.equal(assuranceIcon("Cash on delivery"), "shipping");
  assert.equal(assuranceIcon("GCash accepted"), "payment");
});

check("the note is read when the label alone says nothing recognisable", () => {
  assert.equal(assuranceIcon("Our promise", "Ships within 24 hours"), "shipping");
});

check("unrecognised or non-string input gets the neutral spark", () => {
  assert.equal(assuranceIcon("Made with love"), "spark");
  assert.equal(assuranceIcon(undefined), "spark");
  assert.equal(assuranceIcon(42), "spark");
  assert.equal(assuranceIcon(""), "spark");
});

check("every rule resolves to an icon the component can draw", () => {
  const icon = readFileSync(join(ROOT, "src/storefront/components/ShowcaseIcon.tsx"), "utf8");
  for (const name of ASSURANCE_ICONS) {
    assert.ok(new RegExp(`\\b${name}:`).test(icon), `ShowcaseIcon has no drawing for "${name}"`);
  }
});

// ── The Protocols hub promo card ─────────────────────────────────────────────
console.log("\nhasProtocolsHub — the card links to the Protocols page, only when it is on");

check("Protocols page off → no hub card, even when other help pages are on", () => {
  const on = new Set(["faq", "calculator", "coa"]);
  assert.equal(hasProtocolsHub((r) => on.has(r)), false);
});

check("Protocols page on → the hub card shows", () => {
  assert.equal(hasProtocolsHub((r) => r === "protocols"), true);
});

check("the hub card's button goes to the Protocols page", () => {
  assert.equal(SHOWCASE_PROTOCOLS_ROUTE, "protocols");
  const src = readFileSync(join(ROOT, "src/storefront/components/ShowcaseSections.tsx"), "utf8");
  assert.ok(src.includes("Protocols hub"), "card is titled Protocols hub");
  assert.ok(!src.includes("Education hub"), "the old Education hub title is gone");
  assert.ok(src.includes("onRoute(SHOWCASE_PROTOCOLS_ROUTE)"), "button routes to #protocols");
});

// ── Promise bar on phones ────────────────────────────────────────────────────
console.log("\npromise bar — fully visible on phones");

check("phones show one promise at a time, rotating — never a clipped strip", () => {
  const bar = readFileSync(join(ROOT, "src/storefront/components/ShowcasePromiseBar.tsx"), "utf8");
  assert.ok(bar.includes("is-active"), "the bar marks the promise currently shown");
  assert.ok(bar.includes("prefers-reduced-motion"), "rotation stops for reduced-motion shoppers");
  const css = readFileSync(SHOWCASE_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const phone = css.slice(css.indexOf("@media (max-width: 819px)"));
  assert.ok(/\.sc-promise__item\s*\{[^}]*grid-area:\s*1 \/ 1/.test(phone), "promises stack in one cell");
  assert.ok(/\.sc-promise__item\.is-active\s*\{[^}]*opacity:\s*1/.test(phone), "only the active one is shown");
  assert.ok(!/\.sc-promise__row\s*\{[^}]*justify-content:\s*flex-start/.test(phone), "no left-aligned clipped strip");
});

// ── Promise bar colours ──────────────────────────────────────────────────────
console.log("\npromiseBarVars — owner-chosen promise bar colours, fail-closed");

check("unset → no overrides (the bar keeps its brand-text / background default)", () => {
  assert.deepEqual(promiseBarVars({}), {});
  assert.deepEqual(promiseBarVars({ promiseBarBg: "", promiseBarText: "  " }), {});
});

check("hex, rgb() and hsl() colours become the bar's CSS variables", () => {
  assert.deepEqual(promiseBarVars({ promiseBarBg: "#D62D86", promiseBarText: "#fff" }), {
    "--sc-promise-bg": "#D62D86",
    "--sc-promise-text": "#fff",
  });
  assert.deepEqual(promiseBarVars({ promiseBarBg: "rgb(214, 45, 134)", promiseBarText: "hsl(0 0% 100%)" }), {
    "--sc-promise-bg": "rgb(214, 45, 134)",
    "--sc-promise-text": "hsl(0 0% 100%)",
  });
});

check("anything that is not a plain colour is dropped — no url(), no injection", () => {
  assert.deepEqual(promiseBarVars({ promiseBarBg: "url(https://evil.example/x.png)" }), {});
  assert.deepEqual(promiseBarVars({ promiseBarBg: "red; background: url(x)" }), {});
  assert.deepEqual(promiseBarVars({ promiseBarText: "#12345" }), {});
  assert.deepEqual(promiseBarVars({ promiseBarText: 42 as unknown as string }), {});
});

check("the bar reads the variables; unset, they default to the brand tokens", () => {
  const css = readFileSync(SHOWCASE_CSS, "utf8");
  assert.ok(/--sc-promise-bg:\s*var\(--brand-text\)/.test(css), "default background = brand text colour");
  assert.ok(/--sc-promise-text:\s*var\(--brand-background\)/.test(css), "default text = brand background");
  assert.ok(/\.sc-promise\s*\{[^}]*background:\s*var\(--sc-promise-bg\)/.test(css));
  assert.ok(/\.sc-promise\s*\{[^}]*color:\s*var\(--sc-promise-text\)/.test(css));
  const editor = readFileSync(join(ROOT, "src/storefront/tweaks/BoutiqueEditor.tsx"), "utf8");
  assert.ok(editor.includes("promiseBarBg") && editor.includes("promiseBarText"), "editable in the branding editor");
});

// ── Promo cards on phones ────────────────────────────────────────────────────
console.log("\npromo cards — side by side on every screen size");

check("the two promo cards never stack into one column", () => {
  const css = readFileSync(SHOWCASE_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const oneCol = /\.sc-promos__grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)\s*;/;
  for (const bp of ["@media (max-width: 999px)", "@media (max-width: 819px)", "@media (max-width: 559px)"]) {
    const start = css.indexOf(bp);
    if (start === -1) continue;
    const block = css.slice(start, css.indexOf("\n}\n", start));
    assert.ok(!oneCol.test(block), `${bp} must not collapse the pair to one column`);
  }
  const phone = css.slice(css.indexOf("@media (max-width: 819px)"));
  assert.ok(/\.sc-promos__grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/.test(phone),
    "phones keep two equal columns");
});

check("promo cards carry an eyebrow label and their hover lift respects reduced motion", () => {
  const src = readFileSync(join(ROOT, "src/storefront/components/ShowcaseSections.tsx"), "utf8");
  assert.equal((src.match(/className="sc-promo__eyebrow"/g) ?? []).length, 2, "both cards have an eyebrow");
  const css = readFileSync(SHOWCASE_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(/\.sc-promo:hover[^{]*\{[^}]*transform:/.test(css), "cards lift on hover");
  const calm = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(/\.sc-promo\b/.test(calm), "reduced motion switches the card motion off");
});

check("on phones the promo cards read as banners, never as product cards", () => {
  const src = readFileSync(join(ROOT, "src/storefront/components/ShowcaseSections.tsx"), "utf8");
  assert.equal((src.match(/className="sc-pill__label"/g) ?? []).length, 2, "button labels wrapped so phones can hide them visually");
  assert.ok(src.includes("sc-promo--has-photo"), "the collection card knows when it has a photo to bleed");
  const css = readFileSync(SHOWCASE_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const phone = css.slice(css.indexOf("@media (max-width: 819px)"));
  assert.ok(/\.sc-promo--learn\s*\{[^}]*background:\s*linear-gradient\([^)]*var\(--brand-button\)/.test(phone),
    "protocols card is a filled brand panel on phones");
  assert.ok(/\.sc-promo--has-photo \.sc-promo__photo\s*\{[^}]*position:\s*absolute/.test(phone),
    "collection photo bleeds behind the copy on phones");
  assert.ok(/\.sc-pill::after\s*\{[^}]*inset:\s*0/.test(phone), "the whole card is the tap target");
  assert.ok(/\.sc-pill__label\s*\{[^}]*clip:/.test(phone), "label hidden visually, kept for screen readers");
});

// ── Banner hero (image mode + text over the image) ──────────────────────────
console.log("\nbanner hero — the owner's banner image with the copy laid over it");

check("image mode + overlay → the Showcase banner hero; overlay off → the plain shared banner", () => {
  const src = readFileSync(join(ROOT, "src/storefront/components/ShowcaseHero.tsx"), "utf8");
  assert.ok(src.includes("sc-hero--banner"), "ShowcaseHero has a banner variant");
  assert.ok(/media\.mode === "image" && !media\.overlay/.test(src), "only overlay-off falls back to <Hero>");
  assert.ok(src.includes("heroMediaPosition("), "the owner's focus point positions the banner");
});

check("banner copy stays readable, and on phones the copy sits ON the banner", () => {
  const css = readFileSync(SHOWCASE_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(/\.sc-hero--banner::before\s*\{[^}]*linear-gradient\([^;]*var\(--brand-background\)/.test(css),
    "a wash in the page colour sits behind the copy");
  const phone = css.slice(css.indexOf("@media (max-width: 819px)"));
  assert.ok(!/\.sc-hero--banner \.sc-hero__backdrop\s*\{[^}]*position:\s*relative/.test(phone),
    "on phones the banner is never pushed out from behind the copy");
  assert.ok(!phone.includes("--sc-banner-h"), "no top-only banner strip on phones — it backs the whole hero");
  assert.ok(/\.sc-hero--banner::before\s*\{[^}]*linear-gradient\(\s*180deg[^;]*var\(--brand-background\)/.test(phone),
    "phones keep the copy readable with a top-to-bottom wash over the banner");
});

check("banner copy stops before the product, and mid-size screens shift the picture right", () => {
  const css = readFileSync(SHOWCASE_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(/\.sc-hero--banner \.sc-hero__copy\s*\{[^}]*max-width:\s*min\([^;]*var\(--sc-banner-copy\)/.test(css),
    "the copy column is a share of the hero, not a fixed 560px that ran into the vials at ~1000px");
  const midAt = css.indexOf("@media (min-width: 820px) and (max-width: 1279px)");
  assert.ok(midAt >= 0, "a mid-size banner rule exists");
  assert.ok(/\.sc-hero__backdrop\s*\{[^}]*inset-inline-start:[^}]*mask-image:/.test(css.slice(midAt)),
    "an uncropped 16:9 banner starts right of the copy and fades in");
  const phone = css.slice(css.indexOf("@media (max-width: 819px)"));
  assert.ok(/\.sc-hero--banner \.sc-hero__copy\s*\{[^}]*max-width:\s*none/.test(phone),
    "phones give the copy the full width again");
});

check("header nav labels never wrap onto two lines", () => {
  const base = readFileSync(join(ROOT, "src/storefront/storefront.css"), "utf8");
  assert.ok(/\.site-header__navlink\s*\{[^}]*white-space:\s*nowrap/.test(base), "\"Track Order\" stays on one line");
});

// ── showcase.css — cannot leak into other tenants ────────────────────────────
console.log("\nshowcase.css — scoping and tokens");

check("the stylesheet exists and every storefront surface imports it", () => {
  assert.ok(existsSync(SHOWCASE_CSS), "src/storefront/showcase.css is missing");
  for (const file of [
    "src/app/(tenant)/(storefront)/layout.tsx",
    "src/components/admin/StorefrontLivePreview.tsx",
  ]) {
    const src = readFileSync(join(ROOT, file), "utf8");
    assert.ok(src.includes('"@/storefront/showcase.css"'), `${file} does not import showcase.css`);
  }
});

check(`every rule is scoped to ${SCOPE}`, () => {
  const unscoped: string[] = [];
  const walk = (text: string): void => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open === -1) break;
      const prelude = text.slice(i, open).trim();
      let depth = 1;
      let k = open + 1;
      while (k < text.length && depth > 0) {
        if (text[k] === "{") depth++;
        else if (text[k] === "}") depth--;
        k++;
      }
      const body = text.slice(open + 1, k - 1);
      if (/^@(media|supports|layer)/.test(prelude)) walk(body);
      else if (!/^@(keyframes|font-face|property)/.test(prelude)) {
        for (const sel of prelude.split(",")) {
          const s = sel.trim();
          if (s && !s.includes(SCOPE)) unscoped.push(s);
        }
      }
      i = k;
    }
  };
  walk(css());
  assert.deepEqual(unscoped, [], `unscoped selector(s) would leak onto every tenant: ${unscoped.join(" | ")}`);
});

check("declares no literal colours — tokens only", () => {
  const literals = css().match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi) ?? [];
  assert.deepEqual(literals, [], `hardcoded colour literal(s): ${literals.join(", ")}`);
});

check("references only --brand-* tokens the storefront actually defines", () => {
  const base = readFileSync(join(ROOT, "src/storefront/storefront.css"), "utf8");
  const defined = new Set(
    (base.match(/--brand-[a-z0-9-]+\s*:/gi) ?? []).map((d) => d.replace(/\s*:$/, "")),
  );
  const used = new Set(
    (css().match(/var\(\s*(--brand-[a-z0-9-]+)/gi) ?? []).map((m) => m.replace(/^var\(\s*/i, "")),
  );
  const unknown = [...used].filter((t) => !defined.has(t)).sort();
  assert.deepEqual(unknown, [], `undefined token(s) — these paint nothing: ${unknown.join(", ")}`);
});

check("every --sc-* variable the sheet reads is one it declares", () => {
  const text = css();
  const declared = new Set((text.match(/--sc-[a-z0-9-]+\s*:/gi) ?? []).map((d) => d.replace(/\s*:$/, "")));
  const used = new Set((text.match(/var\(\s*(--sc-[a-z0-9-]+)/gi) ?? []).map((m) => m.replace(/^var\(\s*/i, "")));
  const missing = [...used].filter((t) => !declared.has(t)).sort();
  assert.deepEqual(missing, [], `undeclared layout variable(s): ${missing.join(", ")}`);
});

check("motion is switched off for shoppers who ask for reduced motion", () => {
  assert.ok(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css()));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
