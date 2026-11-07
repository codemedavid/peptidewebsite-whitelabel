/**
 * The Expo app's product editor must not erase an option's packing list.
 *
 * WHY (vrjonina, 2026-11-07): the storefront shows "Complete set includes: …"
 * from `variation.includes`, which is set on the website's Add Product screen.
 * The app's editor neither seeded `includes` into its draft nor sent it back,
 * and the server rebuilds each variation from the payload, so ONE save from the
 * app silently wiped every option's list. The storefront then showed nothing.
 *
 * Run: npm run test:mobile-variation-includes
 */
import assert from "node:assert/strict";
import {
  draftFromProduct,
  toSavePayload,
} from "../mobile/src/features/admin/catalog/product-form";
import type { CatalogProduct } from "../mobile/src/features/admin/catalog/model";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const INCLUDES = "Insulin syringe - 6 pcs\nAlcohol pads - 12 pcs";

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: "p1",
    name: "Tirzepatide 30mg",
    description: "",
    price: 1400,
    currency: "₱",
    category: "peptides",
    featured: false,
    image: null,
    ...overrides,
  };
}

console.log("\nThe app's product editor keeps each option's \"includes\" list");

check("an untouched option keeps its includes through draft → payload", () => {
  const initial = product({
    variations: [
      { name: "Vial only", price: 1400 },
      { name: "Complete set", price: 1550, includes: INCLUDES },
    ],
  });
  const payload = toSavePayload(draftFromProduct(initial, "peptides"), initial, "₱");
  assert.equal(payload.variations?.[1].includes, INCLUDES);
});

check("an option without a list gains no includes key", () => {
  const initial = product({ variations: [{ name: "Vial only", price: 1400 }] });
  const payload = toSavePayload(draftFromProduct(initial, "peptides"), initial, "₱");
  assert.equal("includes" in (payload.variations?.[0] ?? {}), false);
});

check("includes survives editing another field of the same option", () => {
  const initial = product({ variations: [{ name: "Complete set", price: 1550, includes: INCLUDES }] });
  const draft = draftFromProduct(initial, "peptides");
  const edited = { ...draft, variations: draft.variations.map((v) => ({ ...v, price: "1600" })) };
  const out = toSavePayload(edited, initial, "₱").variations?.[0];
  assert.equal(out?.price, 1600);
  assert.equal(out?.includes, INCLUDES);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
