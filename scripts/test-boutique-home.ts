/**
 * Tests for the BOUTIQUE storefront home layout — src/lib/storefront/boutique-home.ts
 * (reference: cherieandco.ph — imagery-led, category-first discovery).
 *
 *   npm run test:boutique-home
 *
 * The layout is a REUSABLE TEMPLATE: it must carry no tenant content of its own.
 * Every section is composed from config/data the tenant already has, and every
 * section disappears when its data is empty. These tests are the guarantee —
 * they assert the view-model invents nothing, and that a store with an empty
 * catalog, no categories or no assurances gets no half-rendered furniture.
 *
 * Pure: no DB, no React, no browser.
 */

import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  buildCategoryTiles,
  normalizeAssurances,
  isBoutiqueLayout,
  HOME_LAYOUTS,
  ASSURANCE_MAX,
  ASSURANCE_LABEL_MAX,
  ASSURANCE_NOTE_MAX,
  boutiqueSections,
} from "../src/lib/storefront/boutique-home";
import { resolveHomeLayout } from "../src/lib/storefront/two-ways-home";
import { buildTenantBrandingUpdate } from "../src/lib/tenant/branding-update";
import type { Product, Category } from "../src/storefront/types";

const ROOT = join(__dirname, "..");
const BOUTIQUE_CSS = join(ROOT, "src/storefront/boutique.css");

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

const cat = (id: string, label: string): Category => ({ id, label });

// ── resolveHomeLayout — the owner-selectable third layout ────────────────────
// Boutique needs NO operator grant (it re-composes data every tenant already
// has). Two-ways keeps its grant. The table below is the whole contract.
console.log("\nresolveHomeLayout — layout resolution");

check("boutique is owner-selectable — no entitlement needed", () => {
  assert.equal(resolveHomeLayout(false, "boutique"), "boutique");
  assert.equal(resolveHomeLayout(true, "boutique"), "boutique");
});

check("two-ways still requires the operator grant", () => {
  assert.equal(resolveHomeLayout(false, "two-ways"), "classic");
  assert.equal(resolveHomeLayout(true, "two-ways"), "two-ways");
});

check("an entitled tenant with no explicit layout still gets two-ways", () => {
  assert.equal(resolveHomeLayout(true, undefined), "two-ways");
  assert.equal(resolveHomeLayout(true, null), "two-ways");
});

check("explicit classic wins over the grant", () => {
  assert.equal(resolveHomeLayout(true, "classic"), "classic");
  assert.equal(resolveHomeLayout(false, "classic"), "classic");
});

check("unentitled + unset stays classic", () => {
  assert.equal(resolveHomeLayout(false, undefined), "classic");
});

check("an unknown/garbage value fails closed to the pre-boutique answer", () => {
  assert.equal(resolveHomeLayout(false, "nonsense"), "classic");
  assert.equal(resolveHomeLayout(true, "nonsense"), "two-ways");
});

check("HOME_LAYOUTS is the single source of truth and lists all three", () => {
  assert.deepEqual([...HOME_LAYOUTS], ["classic", "two-ways", "boutique"]);
});

check("isBoutiqueLayout only recognises the exact value", () => {
  assert.equal(isBoutiqueLayout("boutique"), true);
  assert.equal(isBoutiqueLayout("Boutique"), false);
  assert.equal(isBoutiqueLayout("classic"), false);
  assert.equal(isBoutiqueLayout(undefined), false);
  assert.equal(isBoutiqueLayout({ layout: "boutique" }), false);
});

// ── buildCategoryTiles — imagery-led discovery, derived from real data ───────
console.log("\nbuildCategoryTiles — category discovery tiles");

const CATS = [cat("all", "All Products"), cat("peptides", "Peptides"), cat("kits", "Kits")];
const PRODUCTS = [
  product({ id: "p1", category: "peptides", image: null }),
  product({ id: "p2", category: "peptides", image: "https://img/2.jpg" }),
  product({ id: "p3", category: "kits", image: "https://img/3.jpg" }),
];

check("counts the products actually in each category", () => {
  const tiles = buildCategoryTiles(PRODUCTS, CATS);
  assert.deepEqual(
    tiles.map((t) => [t.id, t.count]),
    [["peptides", 2], ["kits", 1]],
  );
});

check("excludes the synthetic 'all' filter tab — it is not a shelf", () => {
  const tiles = buildCategoryTiles(PRODUCTS, CATS);
  assert.ok(!tiles.some((t) => t.id === "all"));
});

check("drops categories with no products rather than promising an empty shelf", () => {
  const tiles = buildCategoryTiles(PRODUCTS, [...CATS, cat("empty", "Empty")]);
  assert.ok(!tiles.some((t) => t.id === "empty"));
});

check("preserves the owner's category order", () => {
  const tiles = buildCategoryTiles(PRODUCTS, [cat("kits", "Kits"), cat("peptides", "Peptides")]);
  assert.deepEqual(tiles.map((t) => t.id), ["kits", "peptides"]);
});

check("uses the first product in the category that actually has an image", () => {
  const tiles = buildCategoryTiles(PRODUCTS, CATS);
  assert.equal(tiles[0].image, "https://img/2.jpg"); // p1 has none, p2 does
});

check("falls back to the brand default image when no product carries one", () => {
  const tiles = buildCategoryTiles(
    [product({ id: "x", category: "peptides", image: null })],
    CATS,
    "https://img/default.jpg",
  );
  assert.equal(tiles[0].image, "https://img/default.jpg");
});

check("falls back to null (never a placeholder URL) when there is no image at all", () => {
  const tiles = buildCategoryTiles([product({ id: "x", category: "peptides" })], CATS);
  assert.equal(tiles[0].image, null);
});

check("carries a monogram initial so an imageless tile still reads as a tile", () => {
  const tiles = buildCategoryTiles(PRODUCTS, CATS);
  assert.equal(tiles[0].initial, "P");
  assert.equal(tiles[1].initial, "K");
});

check("an empty catalog yields no tiles — the section self-hides", () => {
  assert.deepEqual(buildCategoryTiles([], CATS), []);
});

check("no categories yields no tiles", () => {
  assert.deepEqual(buildCategoryTiles(PRODUCTS, []), []);
  assert.deepEqual(buildCategoryTiles(PRODUCTS, undefined), []);
});

check("never mutates its inputs", () => {
  const products = [...PRODUCTS];
  const cats = [...CATS];
  buildCategoryTiles(products, cats);
  assert.deepEqual(products, PRODUCTS);
  assert.deepEqual(cats, CATS);
});

check("tolerates malformed category rows without throwing", () => {
  const tiles = buildCategoryTiles(PRODUCTS, [
    null as unknown as Category,
    { id: "", label: "" } as Category,
    cat("peptides", "Peptides"),
  ]);
  assert.deepEqual(tiles.map((t) => t.id), ["peptides"]);
});

check("a category with no label falls back to its id for the tile label", () => {
  const tiles = buildCategoryTiles(PRODUCTS, [{ id: "peptides", label: "" } as Category]);
  assert.equal(tiles[0].label, "peptides");
  assert.equal(tiles[0].initial, "P");
});

// ── normalizeAssurances — owner-typed, never invented ────────────────────────
console.log("\nnormalizeAssurances — the owner's own assurance strip");

check("absent / non-array config yields no assurances (nothing is invented)", () => {
  assert.deepEqual(normalizeAssurances(undefined), []);
  assert.deepEqual(normalizeAssurances(null), []);
  assert.deepEqual(normalizeAssurances("Guaranteed Authentic"), []);
  assert.deepEqual(normalizeAssurances({ label: "x" }), []);
});

check("keeps the owner's labels and notes, trimmed", () => {
  const out = normalizeAssurances([{ label: "  Authentic  ", note: "  Sealed  " }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Authentic");
  assert.equal(out[0].note, "Sealed");
});

check("drops entries with a blank label", () => {
  const out = normalizeAssurances([{ label: "   " }, { label: "Kept" }, { note: "orphan" }]);
  assert.deepEqual(out.map((a) => a.label), ["Kept"]);
});

check("gives every entry a stable id for React keys", () => {
  const out = normalizeAssurances([{ label: "A" }, { label: "B" }]);
  assert.equal(new Set(out.map((a) => a.id)).size, 2);
  assert.ok(out.every((a) => typeof a.id === "string" && a.id.length > 0));
});

check("keeps an owner-supplied id when present", () => {
  const out = normalizeAssurances([{ id: "mine", label: "A" }]);
  assert.equal(out[0].id, "mine");
});

check("caps the strip so it stays a strip, not a list", () => {
  const many = Array.from({ length: ASSURANCE_MAX + 4 }, (_, i) => ({ label: `A${i}` }));
  assert.equal(normalizeAssurances(many).length, ASSURANCE_MAX);
});

check("truncates over-long copy so one entry can't blow up the layout", () => {
  const out = normalizeAssurances([
    { label: "x".repeat(ASSURANCE_LABEL_MAX + 50), note: "y".repeat(ASSURANCE_NOTE_MAX + 50) },
  ]);
  assert.equal(out[0].label.length, ASSURANCE_LABEL_MAX);
  assert.equal(out[0].note?.length, ASSURANCE_NOTE_MAX);
});

check("an entry with no note omits it rather than storing an empty string", () => {
  const out = normalizeAssurances([{ label: "A", note: "   " }]);
  assert.equal(out[0].note, undefined);
});

check("ignores non-object rows", () => {
  const out = normalizeAssurances(["Authentic", 42, null, { label: "Kept" }]);
  assert.deepEqual(out.map((a) => a.label), ["Kept"]);
});

// ── boutiqueSections — the home does NOT list products ───────────────────────
// The reference storefront's home ends at category discovery: you pick a shelf
// (or search) and the grid is the NEXT screen. Putting the grid back on the
// home would collapse that two-step flow into the classic layout with nicer
// tiles, which is the one thing this layout must not be — so the composition is
// pinned here rather than left to whoever next edits the component.
console.log("\nboutiqueSections — home vs catalog composition");

check("the home never renders the product grid", () => {
  assert.ok(!boutiqueSections("home").includes("catalog"));
});

check("the home is hero → tiles → shop-all → assurances → contact, in order", () => {
  assert.deepEqual(boutiqueSections("home"), [
    "hero",
    "tiles",
    "shopAll",
    "assurances",
    "contact",
  ]);
});

check("the catalog view is where products live", () => {
  assert.ok(boutiqueSections("catalog").includes("catalog"));
});

check("the catalog view leads with the category chips", () => {
  // Arriving from a tile means a category is already applied. Without the chips
  // the shopper sees a filtered grid with no clue which shelf they are on and no
  // way back to the rest of the catalog — the tiles are gone by then.
  const catalog = boutiqueSections("catalog");
  assert.equal(catalog[0], "chips");
  assert.ok(catalog.indexOf("chips") < catalog.indexOf("catalog"));
});

check("the catalog view does not repeat the home's discovery furniture", () => {
  const catalog = boutiqueSections("catalog");
  for (const section of ["hero", "tiles", "shopAll"] as const) {
    assert.ok(!catalog.includes(section), `"${section}" should not repeat on the catalog view`);
  }
});

check("both views end on the contact strip", () => {
  assert.equal(boutiqueSections("home").at(-1), "contact");
  assert.equal(boutiqueSections("catalog").at(-1), "contact");
});

// ── boutique.css — cannot leak into classic / two-ways tenants ───────────────
// storefront.css has already produced one silent same-specificity override
// (the image hero's padding). The boutique sheet is kept in its own file AND
// every rule is scoped to .sf-root[data-sf-home="boutique"], so it both
// outranks the base sheet and cannot touch a tenant that did not opt in.
console.log("\nboutique.css — scoping");

check("the stylesheet exists", () => {
  assert.ok(existsSync(BOUTIQUE_CSS), "src/storefront/boutique.css is missing");
});

check("every rule is scoped to [data-sf-home='boutique']", () => {
  const css = readFileSync(BOUTIQUE_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
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
          if (s && !s.includes('[data-sf-home="boutique"]')) unscoped.push(s);
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
  const css = readFileSync(BOUTIQUE_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // Hex / rgb() / hsl() literals are how a "reusable" template quietly becomes
  // one tenant's design. Only var(--brand-*) and color-mix over them are allowed.
  const literals = css.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi) ?? [];
  assert.deepEqual(literals, [], `hardcoded colour literal(s): ${literals.join(", ")}`);
});

// ── config allow-list — a value missing here is silently dropped on save ─────
console.log("\nbranding.config — homeLayout allow-list");

const patchLayout = (homeLayout: unknown) =>
  buildTenantBrandingUpdate({ config: {} }, { layout: { homeLayout } });

check("every HOME_LAYOUTS value survives a branding patch", () => {
  for (const layout of HOME_LAYOUTS) {
    const res = patchLayout(layout);
    assert.deepEqual(res.errors, [], `"${layout}" was rejected: ${res.errors.join("; ")}`);
    assert.equal(res.config.homeLayout, layout, `"${layout}" was silently dropped on save`);
  }
});

check("an unknown layout is rejected rather than written through", () => {
  const res = patchLayout("bespoke");
  assert.ok(res.errors.length > 0, "an unknown homeLayout must be an error");
  assert.equal(res.config.homeLayout, undefined);
});

check("a non-string layout is rejected", () => {
  assert.ok(patchLayout(42).errors.length > 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
