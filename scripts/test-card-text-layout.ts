/**
 * Self-contained gate for the Card Studio "Text only" layout (layout: "text").
 * Some stores have no product photos — or would rather not show them — so this
 * card drops the media box entirely and lets the name, price and buy row lead.
 *
 * Renders the REAL ProductCard to static markup (no DB, no browser) and checks:
 *
 *   - the "text-only" preset exists and isTextOnlyCard() recognises it
 *   - cardDesignAttrs() stamps data-cd-layout="text" (what storefront.css keys off)
 *   - a text card renders NO media box, no <img>, no placeholder SVG — even for
 *     a product that has a photo, a store default image, or variation photos
 *   - every other layout still renders its media box (no regression)
 *   - the server normalizer accepts "text" instead of clamping it back to vertical
 *
 *   npm run test:card-text-layout
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// tsx compiles the storefront components to classic React.createElement calls,
// so React must be on the global before they render outside Next.
(globalThis as { React?: typeof React }).React = React;

import type { Product } from "../src/storefront/types";
import { ProductCard } from "../src/storefront/components/Catalog";
import {
  CARD_PRESETS,
  DEFAULT_CARD_DESIGN,
  cardDesignAttrs,
  getCardPreset,
  isTextOnlyCard,
  type CardDesign,
} from "../src/storefront/cardDesign";

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

const baseProduct = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Tirzepatide",
  description: "Research-only compound.",
  price: 2500,
  currency: "₱",
  category: "peptides",
  featured: true,
  image: "https://ik.imagekit.io/demo/tirz.jpg",
  stock: 5,
  ...over,
});

function render(product: Product, design?: CardDesign, defaultImage?: string): string {
  return renderToStaticMarkup(
    createElement(ProductCard, { product, onAdd: () => {}, design, defaultImage }),
  );
}

const textDesign = getCardPreset("text-only")?.design;

console.log("\nCard Studio — Text only layout\n");

check("the text-only preset exists with layout \"text\"", () => {
  assert.ok(textDesign, "no text-only preset in CARD_PRESETS");
  assert.equal(textDesign.layout, "text");
  assert.equal(CARD_PRESETS.filter((p) => p.id === "text-only").length, 1);
});

check("isTextOnlyCard is true only for the text layout", () => {
  assert.equal(isTextOnlyCard(textDesign), true);
  assert.equal(isTextOnlyCard(DEFAULT_CARD_DESIGN), false);
  assert.equal(isTextOnlyCard(undefined), false);
});

check("cardDesignAttrs stamps data-cd-layout=\"text\"", () => {
  assert.equal(cardDesignAttrs(textDesign!).data["data-cd-layout"], "text");
});

check("a text card with a product photo renders no media and no <img>", () => {
  const html = render(baseProduct(), textDesign);
  assert.ok(html.includes('data-cd-layout="text"'), "layout attribute missing");
  assert.ok(!html.includes("product-card__media"), "media box still rendered");
  assert.ok(!html.includes("<img"), "an image is still downloaded");
});

check("a text card ignores the store's default product image", () => {
  const html = render(baseProduct({ image: null }), textDesign, "https://ik.imagekit.io/demo/default.jpg");
  assert.ok(!html.includes("<img"), "default image still rendered");
  assert.ok(!html.includes("product-card__media-placeholder"), "placeholder SVG still rendered");
});

check("a text card skips the per-variation photo gallery", () => {
  const withVariationPhotos = baseProduct({
    variations: [
      { name: "5mg", price: 2500, image: "https://ik.imagekit.io/demo/5.jpg" },
      { name: "10mg", price: 4200, image: "https://ik.imagekit.io/demo/10.jpg" },
    ],
  } as Partial<Product>);
  // Control: the fixture really does earn a gallery on a photo layout, so the
  // text-layout assertion below can't pass vacuously.
  assert.ok(
    render(withVariationPhotos, DEFAULT_CARD_DESIGN).includes("product-card__gallery"),
    "fixture does not produce a gallery on the standard layout",
  );
  const html = render(withVariationPhotos, textDesign);
  assert.ok(!html.includes("product-card__gallery"), "gallery still rendered");
  assert.ok(!html.includes("<img"), "variation photos still rendered");
});

check("a text card still shows the name, price, badge and buy button", () => {
  const html = render(baseProduct(), textDesign);
  assert.ok(html.includes("Tirzepatide"), "name missing");
  assert.ok(html.includes("product-card__price"), "price missing");
  assert.ok(html.includes("Featured"), "badge missing");
  assert.ok(html.includes("product-card__cta"), "buy button missing");
});

check("the other layouts (and the classic card) still render their image", () => {
  for (const layout of ["vertical", "horizontal", "overlay"] as const) {
    const html = render(baseProduct(), { ...DEFAULT_CARD_DESIGN, layout });
    assert.ok(html.includes("<img"), `${layout} lost its image`);
  }
  assert.ok(render(baseProduct()).includes("<img"), "classic card lost its image");
});

check("the server normalizer accepts the text layout", () => {
  const src = readFileSync(join(process.cwd(), "src/actions/storefront-admin.ts"), "utf8");
  assert.ok(
    /layout: cdEnum\(o\.layout, \[[^\]]*"text"[^\]]*\]/.test(src),
    "normalizeCardDesign would clamp \"text\" back to vertical on save",
  );
});

check("storefront.css styles the text layout", () => {
  const css = readFileSync(join(process.cwd(), "src/storefront/storefront.css"), "utf8");
  assert.ok(css.includes('.product-card[data-cd-layout="text"] .product-card__badge'), "badge not reflowed");
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
