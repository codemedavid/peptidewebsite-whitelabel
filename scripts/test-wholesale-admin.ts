/**
 * Wholesale config in Product Management: validation, persistence and gating.
 *
 * The owner sets three things per product — an enable toggle, a minimum order
 * quantity, and a wholesale unit price. The NORMAL price is the product's
 * existing Price field (and each variation's own price); there is no second
 * "price below MOQ" input, because one box could not represent four
 * differently-priced variations.
 *
 * What this pins:
 *   - the config survives a save -> load round trip
 *   - an INCOMPLETE config is never silently persisted as a live rule
 *   - wholesale fields only render when the feature is granted, on create,
 *     edit and view alike
 *   - a newly created product is never auto-enabled
 *
 *   npm run test:wholesale-admin
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  dbProductToStorefront,
  productToDbWrite,
  type DbProductRow,
} from "../src/lib/storefront/product-mapping";
import { resolveWholesale } from "../src/lib/storefront/wholesale";
import { unitPrice } from "../src/storefront/checkout";
import type { Product } from "../src/storefront/types";

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

function product(p: Partial<Product> & { id: string }): Product {
  return {
    name: "Vial Caps",
    description: "",
    price: 10,
    currency: "₱",
    category: "all",
    featured: false,
    image: null,
    stock: 1000,
    ...p,
  };
}

/** The metadata a save would write for this product. */
function savedMeta(p: Product): Record<string, unknown> {
  return (productToDbWrite(p, "PHP", "₱").metadata ?? {}) as Record<string, unknown>;
}

/** Save then load, exactly as the admin screen round-trips a product. */
function roundTrip(p: Product): Product {
  const write = productToDbWrite(p, "PHP", "₱");
  const row = {
    id: p.id,
    sku: "SKU",
    slug: "slug",
    name: write.name,
    description: write.description,
    priceCents: write.priceCents,
    currency: write.currency,
    stock: write.stock,
    status: write.status,
    active: write.active,
    images: write.images,
    metadata: write.metadata,
  } as unknown as DbProductRow;
  return dbProductToStorefront(row, "₱");
}

// ── Round trip ───────────────────────────────────────────────────────────────

check("a complete wholesale config survives save → load", () => {
  const p = product({ id: "caps", wholesale: { enabled: true, moq: 1000, price: 7 } });
  assert.deepStrictEqual(savedMeta(p).wholesale, { enabled: true, moq: 1000, price: 7 });
  assert.deepStrictEqual(roundTrip(p).wholesale, { enabled: true, moq: 1000, price: 7 });
});

check("the round-tripped product actually prices at wholesale", () => {
  const p = roundTrip(product({ id: "caps", wholesale: { enabled: true, moq: 100, price: 7 } }));
  assert.strictEqual(unitPrice(p, 99), 10, "below the MOQ");
  assert.strictEqual(unitPrice(p, 100), 7, "at the MOQ");
});

check("an MOQ is rounded to whole units and never negative", () => {
  const p = product({ id: "caps", wholesale: { enabled: true, moq: 999.6, price: 7 } });
  assert.strictEqual((savedMeta(p).wholesale as { moq: number }).moq, 1000);
});

// ── §18: an incomplete config is never persisted as a live rule ──────────────

check("wholesale ON with no MOQ is not persisted", () => {
  const p = product({ id: "caps", wholesale: { enabled: true, moq: 0, price: 7 } });
  assert.strictEqual(savedMeta(p).wholesale, undefined, "an MOQ of 0 is not a rule");
});

check("wholesale ON with no price is not persisted", () => {
  const p = product({ id: "caps", wholesale: { enabled: true, moq: 1000, price: 0 } });
  assert.strictEqual(savedMeta(p).wholesale, undefined, "a price of 0 is not a rule");
});

check("a negative wholesale price is never persisted", () => {
  const p = product({ id: "caps", wholesale: { enabled: true, moq: 1000, price: -5 } });
  assert.strictEqual(savedMeta(p).wholesale, undefined);
});

check("a DISABLED config is still persisted, so the owner's numbers survive", () => {
  // Toggling wholesale off must not blank the MOQ and price the owner typed —
  // they come straight back when it is toggled on again.
  const p = product({ id: "caps", wholesale: { enabled: false, moq: 1000, price: 7 } });
  assert.deepStrictEqual(savedMeta(p).wholesale, { enabled: false, moq: 1000, price: 7 });
  assert.strictEqual(resolveWholesale(roundTrip(p)), null, "but it prices nothing");
});

check("a product with no wholesale config persists no key at all", () => {
  assert.strictEqual(savedMeta(product({ id: "plain" })).wholesale, undefined);
  assert.strictEqual(roundTrip(product({ id: "plain" })).wholesale, undefined);
});

// ── §17: existing products are never auto-enabled ────────────────────────────

check("granting the feature does not enable wholesale on an existing product", () => {
  // The catalog row carries no `wholesale` key; reading it back must not invent
  // an enabled one, whatever the tenant's entitlements say.
  const row = {
    id: "old", sku: "S", slug: "s", name: "Old", description: "",
    priceCents: 1000, currency: "PHP", stock: 10, status: "active", active: true,
    images: [], metadata: {},
  } as unknown as DbProductRow;
  const loaded = dbProductToStorefront(row, "₱");
  assert.strictEqual(loaded.wholesale, undefined);
  assert.strictEqual(resolveWholesale(loaded), null);
  assert.strictEqual(unitPrice(loaded, 100000), 10, "still retail at any quantity");
});

// ── §1 / §16: the form only shows wholesale when the feature is granted ──────

const formSrc = readFileSync(
  join(process.cwd(), "src/storefront/admin/AdminAddProduct.tsx"),
  "utf8",
);

check("the wholesale section is gated on the wholesale-pricing entitlement", () => {
  assert.match(formSrc, /isWholesalePricingVisible\(brand\)/, "the section must be gated");
  // Every wholesale INPUT must sit after the gate opens and before it closes, so
  // an unentitled owner sees none of them — on create, edit or view alike. (The
  // useState declarations legitimately sit above it; those render nothing.)
  const gate = formSrc.indexOf("{isWholesalePricingVisible(brand) && (");
  assert.ok(gate > 0, "the gate must wrap a JSX block");
  const closes = formSrc.indexOf("\n        )}", gate);
  const block = formSrc.slice(gate, closes);
  for (const field of ["Minimum order quantity", "Wholesale unit price", "Enable wholesale pricing"]) {
    assert.ok(block.includes(field), `"${field}" must sit INSIDE the gate`);
  }
});

check("the form carries the owner-facing MOQ and price copy", () => {
  // JSX wraps these across lines, so compare on collapsed whitespace.
  const flat = formSrc.replace(/\s+/g, " ");
  assert.ok(
    flat.includes(
      "Minimum combined quantity of this product required to unlock wholesale pricing.",
    ),
    "the MOQ helper text is missing or reworded",
  );
  assert.ok(
    flat.includes("This price applies to the entire quantity once the MOQ is reached."),
    "the wholesale-price helper text is missing or reworded",
  );
});

check("the form blocks a save with an incomplete wholesale config", () => {
  assert.match(formSrc, /wholesaleError/, "an incomplete config must surface an error");
});

check("a new product starts with wholesale OFF", () => {
  assert.match(
    formSrc,
    /useState<boolean>\(\s*initial\?\.wholesale\?\.enabled === true\s*\)/,
    "the toggle must default to false for a product that has no config",
  );
});

check("the 'will never apply' warning accounts for variation-priced products", () => {
  // A product priced entirely through variations keeps a base Price of 0, so
  // comparing the wholesale price against the base warned "not below the P0
  // retail price" for every valid configuration. The engine compares against
  // each variation's own price, so the warning must too.
  const flat = formSrc.replace(/\s+/g, " ");
  assert.ok(
    !flat.includes("wholesalePriceNum >= (Number(price) || 0)"),
    "the warning must not compare against the base price alone",
  );
  assert.match(formSrc, /lowestRetail/, "it must compare against the lowest price a unit could pay");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
