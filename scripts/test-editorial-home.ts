/**
 * Tests for the EDITORIAL storefront layout — src/lib/storefront/editorial-home.ts
 * and src/lib/storefront/home-layout.ts (reference design: "SKN Storefront").
 *
 *   npm run test:editorial-home
 *
 * The layout is a REUSABLE TEMPLATE. It must carry no tenant content of its own:
 * no business name, no palette, no copy, no products, no categories. Everything
 * it draws is composed from data the tenant already has, and every section
 * disappears when its data is empty. These tests are that guarantee.
 *
 * Pure: no DB, no React, no browser.
 */

import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  HOME_LAYOUTS,
  isBoutiqueLayout,
  isEditorialLayout,
} from "../src/lib/storefront/home-layout";
import {
  editorialSections,
  buildCategoryIndex,
  buildEditRow,
  EDIT_MAX,
} from "../src/lib/storefront/editorial-home";
import { buildStorefrontNav } from "../src/lib/storefront/nav";
import { resolveHomeLayout } from "../src/lib/storefront/two-ways-home";
import { buildTenantBrandingUpdate } from "../src/lib/tenant/branding-update";
import type { Brand, Category, Product } from "../src/storefront/types";

const ROOT = join(__dirname, "..");
const EDITORIAL_CSS = join(ROOT, "src/storefront/editorial.css");

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

function brand(b: Partial<Brand>): Brand {
  return { nav: [], ...b } as unknown as Brand;
}

// ── The layout enum ──────────────────────────────────────────────────────────
console.log("\nhome-layout — the four selectable layouts");

check("HOME_LAYOUTS carries editorial alongside the existing three", () => {
  assert.deepEqual([...HOME_LAYOUTS], ["classic", "two-ways", "boutique", "editorial"]);
});

check("isEditorialLayout matches the stored value exactly and fails closed", () => {
  assert.equal(isEditorialLayout("editorial"), true);
  for (const junk of ["Editorial", " editorial", "editorial ", "boutique", "", null, undefined, 0, {}]) {
    assert.equal(isEditorialLayout(junk), false, `accepted ${JSON.stringify(junk)}`);
  }
});

check("the two owner-selectable predicates never both claim one value", () => {
  for (const layout of HOME_LAYOUTS) {
    assert.ok(
      !(isBoutiqueLayout(layout) && isEditorialLayout(layout)),
      `"${layout}" answers to both predicates`,
    );
  }
});

// ── Entitlement ──────────────────────────────────────────────────────────────
// Editorial is a LAYOUT CHOICE, not a sold module: it only re-composes config
// the tenant already has, so the store owner picks it without an operator grant.
console.log("\nresolveHomeLayout — editorial needs no grant, two-ways still does");

check("an unentitled tenant may select editorial", () => {
  assert.equal(resolveHomeLayout(false, "editorial"), "editorial");
  assert.equal(resolveHomeLayout(true, "editorial"), "editorial");
});

check("adding editorial did not open a back door into the two-ways module", () => {
  assert.equal(resolveHomeLayout(false, "two-ways"), "classic");
  assert.equal(resolveHomeLayout(true, "two-ways"), "two-ways");
  assert.equal(resolveHomeLayout(true, undefined), "two-ways");
  assert.equal(resolveHomeLayout(false, undefined), "classic");
  assert.equal(resolveHomeLayout(true, "classic"), "classic");
});

check("boutique still resolves ahead of the entitlement", () => {
  assert.equal(resolveHomeLayout(false, "boutique"), "boutique");
});

check("an unknown layout still fails closed to something the tenant may have", () => {
  assert.equal(resolveHomeLayout(false, "editoriall"), "classic");
  assert.equal(resolveHomeLayout(false, "atelier"), "classic");
});

// ── Page composition ─────────────────────────────────────────────────────────
console.log("\neditorialSections — the home is discovery, the catalog is the grid");

check("the home carries NO product grid", () => {
  const home = editorialSections("home");
  assert.ok(!home.includes("catalog"), `home renders the grid: ${home.join(", ")}`);
  assert.ok(!home.includes("chips"), `home renders the filter chips: ${home.join(", ")}`);
});

check("the home is hero → category index → the edit → assurances → contact", () => {
  assert.deepEqual(editorialSections("home"), [
    "hero",
    "index",
    "edit",
    "assurances",
    "contact",
  ]);
});

check("the catalog screen leads with the chips, then the grid", () => {
  assert.deepEqual(editorialSections("catalog"), ["chips", "catalog", "contact"]);
});

check("an unknown view falls back to the home composition", () => {
  assert.deepEqual(editorialSections("nonsense" as never), editorialSections("home"));
});

check("callers get a fresh array they cannot use to corrupt the next answer", () => {
  const first = editorialSections("home");
  first.push("catalog");
  assert.ok(!editorialSections("home").includes("catalog"));
});

// ── The category index ───────────────────────────────────────────────────────
// The reference design's signature section: every category as a full-width
// editorial line with its live count. It must be derived, never authored.
console.log("\nbuildCategoryIndex — derived from the tenant's own catalog");

const CATS: Category[] = [
  { id: "all", label: "All Products" },
  { id: "peptides", label: "Peptides" },
  { id: "skin", label: "Skin" },
  { id: "empty", label: "Nothing Here" },
];

const CATALOG: Product[] = [
  product({ id: "1", category: "peptides" }),
  product({ id: "2", category: "peptides" }),
  product({ id: "3", category: "skin" }),
];

check("counts come from the passed catalog, so a row can never advertise a lie", () => {
  const rows = buildCategoryIndex(CATALOG, CATS);
  assert.deepEqual(
    rows.map((r) => [r.id, r.count]),
    [
      ["peptides", 2],
      ["skin", 1],
    ],
  );
});

check("the synthetic 'all' tab is not a shelf and never becomes a row", () => {
  assert.ok(!buildCategoryIndex(CATALOG, CATS).some((r) => r.id === "all"));
});

check("a category with nothing in it is dropped rather than dead-ending", () => {
  assert.ok(!buildCategoryIndex(CATALOG, CATS).some((r) => r.id === "empty"));
});

check("the owner's category order is preserved — the index is their merchandising", () => {
  const reversed = [...CATS].reverse();
  assert.deepEqual(
    buildCategoryIndex(CATALOG, reversed).map((r) => r.id),
    ["skin", "peptides"],
  );
});

check("a category saved without a label falls back to its id, never to blank", () => {
  const rows = buildCategoryIndex(
    [product({ id: "1", category: "raw" })],
    [{ id: "raw", label: "" }],
  );
  assert.equal(rows[0]?.label, "raw");
});

check("an empty catalog or an empty category list yields no rows at all", () => {
  assert.deepEqual(buildCategoryIndex([], CATS), []);
  assert.deepEqual(buildCategoryIndex(CATALOG, []), []);
  assert.deepEqual(buildCategoryIndex(null, null), []);
});

check("malformed config rows are skipped, not thrown on", () => {
  const rows = buildCategoryIndex(CATALOG, [
    null as unknown as Category,
    { id: 7 } as unknown as Category,
    { id: "  ", label: "blank" },
    { id: "peptides", label: "Peptides" },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["peptides"]);
});

check("the inputs are never mutated", () => {
  const cats = [...CATS];
  const list = [...CATALOG];
  buildCategoryIndex(list, cats);
  assert.deepEqual(cats, CATS);
  assert.deepEqual(list, CATALOG);
});

// ── The Edit ─────────────────────────────────────────────────────────────────
// The inverted band under the index. It is the owner's OWN featured flag — this
// template picks no products of its own.
console.log("\nbuildEditRow — the owner's featured products, or nothing");

check("only products the owner flagged featured appear", () => {
  const row = buildEditRow([
    product({ id: "a", featured: false }),
    product({ id: "b", featured: true }),
    product({ id: "c", featured: true }),
  ]);
  assert.deepEqual(row.map((p) => p.id), ["b", "c"]);
});

check("a store with nothing featured gets an EMPTY row, not a filler selection", () => {
  assert.deepEqual(buildEditRow(CATALOG), []);
  assert.deepEqual(buildEditRow([]), []);
  assert.deepEqual(buildEditRow(null), []);
});

check("the band is capped so it stays a band and not a second catalog", () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    product({ id: `f${i}`, featured: true }),
  );
  assert.equal(buildEditRow(many).length, EDIT_MAX);
  assert.equal(buildEditRow(many, 2).length, 2);
});

check("a nonsense cap falls back to the default rather than emptying the band", () => {
  const many = Array.from({ length: 8 }, (_, i) => product({ id: `f${i}`, featured: true }));
  assert.equal(buildEditRow(many, 0).length, EDIT_MAX);
  assert.equal(buildEditRow(many, -3).length, EDIT_MAX);
  assert.equal(buildEditRow(many, Number.NaN).length, EDIT_MAX);
});

check("the input list is never mutated", () => {
  const list = [product({ id: "a", featured: true }), product({ id: "b" })];
  const snapshot = list.map((p) => p.id);
  buildEditRow(list);
  assert.deepEqual(list.map((p) => p.id), snapshot);
});

// ── The rail's nav ───────────────────────────────────────────────────────────
// The sidebar and the classic header must show the SAME links: the auto-surfaced
// pages (Group Buy, Resellers, Calculator) and the toggled-off filtering used to
// live inline in Header.tsx, where a second nav surface could only re-implement
// it and drift.
console.log("\nbuildStorefrontNav — one nav, shared by the header and the rail");

check("links pointing at a toggled-off page are dropped", () => {
  const nav = buildStorefrontNav(
    brand({
      nav: [
        { label: "Home", href: "#top" },
        { label: "FAQ", href: "#faq" },
      ],
      showPageFAQ: false,
      showPageCalculator: false,
    }),
  );
  assert.ok(!nav.some((i) => i.href === "#faq"));
  assert.ok(nav.some((i) => i.href === "#top"));
});

check("the reseller page is surfaced only when the owner opted in", () => {
  const off = buildStorefrontNav(brand({ nav: [], showPageCalculator: false }));
  assert.ok(!off.some((i) => i.href === "#merchant"));

  const on = buildStorefrontNav(
    brand({ nav: [], showPageMerchant: true, showPageCalculator: false }),
  );
  assert.ok(on.some((i) => i.href === "#merchant"));
});

check("the calculator is surfaced by default and slots before Reviews", () => {
  const nav = buildStorefrontNav(
    brand({ nav: [{ label: "Reviews", href: "#reviews" }], showPageReviews: true }),
  );
  const calc = nav.findIndex((i) => i.href === "#calculator");
  const reviews = nav.findIndex((i) => i.href === "#reviews");
  assert.ok(calc >= 0, "calculator missing");
  assert.ok(calc < reviews, "calculator must precede reviews");
});

check("an existing link is never duplicated by the auto-surfacing", () => {
  const nav = buildStorefrontNav(
    brand({ nav: [{ label: "Calc", href: "#calculator" }] }),
  );
  assert.equal(nav.filter((i) => i.href === "#calculator").length, 1);
});

check("the brand's own nav array is never mutated", () => {
  const own = [{ label: "Home", href: "#top" }];
  buildStorefrontNav(brand({ nav: own, showPageMerchant: true }));
  assert.deepEqual(own, [{ label: "Home", href: "#top" }]);
});

// ── editorial.css — cannot leak into other tenants ───────────────────────────
// storefront.css has already produced one silent same-specificity override (the
// image hero's padding). Same defence as boutique.css: own file, and every rule
// scoped to .sf-root[data-sf-home="editorial"].
console.log("\neditorial.css — scoping");

check("the stylesheet exists", () => {
  assert.ok(existsSync(EDITORIAL_CSS), "src/storefront/editorial.css is missing");
});

check("every rule is scoped to [data-sf-home='editorial']", () => {
  const css = readFileSync(EDITORIAL_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
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
      else if (/^@(keyframes|font-face|property)/.test(prelude)) {
        /* at-rules carry no selector — nothing to scope */
      } else {
        for (const sel of prelude.split(",")) {
          const s = sel.trim();
          if (s && !s.includes('[data-sf-home="editorial"]')) unscoped.push(s);
        }
      }
      i = k;
    }
  };
  walk(css);

  assert.deepEqual(
    unscoped,
    [],
    `unscoped selector(s) would leak onto every tenant: ${unscoped.join(" | ")}`,
  );
});

check("declares no literal brand colours — tokens only", () => {
  const css = readFileSync(EDITORIAL_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // A hex here is one tenant's palette baked into every tenant's storefront.
  const literals = css.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi) ?? [];
  assert.deepEqual(literals, [], `hardcoded colour literal(s): ${literals.join(", ")}`);
});

// Banning colour literals is only half the guarantee. A var(--brand-invented)
// passes that check and still paints NOTHING — which is exactly what shipped
// first: the rail referenced --brand-primary / --brand-on-accent, neither of
// which the storefront defines, so the sidebar rendered with no background at
// all on every tenant. Every token the sheet reads must be one that exists.
check("references only --brand-* tokens the storefront actually defines", () => {
  const base = readFileSync(join(ROOT, "src/storefront/storefront.css"), "utf8");
  const defined = new Set(
    (base.match(/--brand-[a-z0-9-]+\s*:/gi) ?? []).map((d) => d.replace(/\s*:$/, "")),
  );

  const css = readFileSync(EDITORIAL_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const used = new Set(
    (css.match(/var\(\s*(--brand-[a-z0-9-]+)/gi) ?? []).map((m) =>
      m.replace(/^var\(\s*/i, ""),
    ),
  );

  const unknown = [...used].filter((t) => !defined.has(t)).sort();
  assert.deepEqual(
    unknown,
    [],
    `undefined token(s) — these paint nothing: ${unknown.join(", ")}`,
  );
});

check("carries no tenant copy — the reference brand's name never appears", () => {
  // Comments are stripped first, as in the two checks above: naming the
  // reference design in a header comment is provenance, not content. What must
  // never appear is the name in a selector, a value or a content string, where
  // it would actually reach a tenant's page.
  const css = readFileSync(EDITORIAL_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\bSKN\b/i.test(css), "the reference tenant's name leaked into the sheet");
});

// ── The config allow-list ────────────────────────────────────────────────────
console.log("\nbranding.config — homeLayout allow-list");

check("every HOME_LAYOUTS value survives a branding patch", () => {
  for (const layout of HOME_LAYOUTS) {
    const res = buildTenantBrandingUpdate({ config: {} }, { layout: { homeLayout: layout } });
    assert.deepEqual(res.errors, [], `"${layout}" was rejected: ${res.errors.join("; ")}`);
    assert.equal(res.config.homeLayout, layout, `"${layout}" was silently dropped on save`);
  }
});

check("a layout outside the list is still rejected", () => {
  const res = buildTenantBrandingUpdate({ config: {} }, { layout: { homeLayout: "atelier" } });
  assert.ok(res.errors.length > 0 || res.config.homeLayout === undefined);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
