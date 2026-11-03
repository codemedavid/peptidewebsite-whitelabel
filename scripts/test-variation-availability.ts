// Per-variation availability (mnm-pepsabuy, 2026-11-03): the owner can take ONE
// option of a product off sale ("Tirzepatide 50mg isn't in this group buy")
// without hiding the whole product. A variation with `available: false` is
// persisted, never offered to a customer, and refused at placement.
//
// Run: npm run test:variation-availability

import assert from "node:assert";
import { normalizeProductInput } from "../src/lib/storefront/product-input";
import { dbProductToStorefront, productToDbWrite } from "../src/lib/storefront/product-mapping";
import { buildProductOptions, shouldShowOptionPicker } from "../src/lib/storefront/variations";
import { gbDisplayName, gbPageOptions } from "../src/lib/storefront/group-buy-page";
import {
  hasListedOption,
  isVariationListed,
  listedVariations,
  unavailableLineViolation,
} from "../src/lib/storefront/variation-availability";
import { matchesListingQuery } from "../src/lib/storefront/listing-filter";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

const tirz = {
  id: "p1",
  name: "Tirzepatide",
  price: 416,
  variations: [
    { name: "5mg", price: 416 },
    { name: "30mg", price: 595 },
    { name: "50mg", price: 960, available: false },
  ],
};

console.log("rules");
check("only a literal false hides an option (absent / true = listed)", () => {
  assert.equal(isVariationListed({}), true);
  assert.equal(isVariationListed({ available: true }), true);
  assert.equal(isVariationListed({ available: false }), false);
  assert.deepEqual(listedVariations(tirz.variations).map((v) => v.name), ["5mg", "30mg"]);
  assert.deepEqual(listedVariations(undefined), []);
});
check("a product whose every option is hidden has nothing to sell", () => {
  assert.equal(hasListedOption(tirz), true);
  assert.equal(hasListedOption({ variations: [{ name: "a", price: 1, available: false }] }), false);
  assert.equal(hasListedOption({ variations: [] }), true, "no variations = plain product");
});

console.log("persistence");
check("normalizeProductInput keeps available:false, drops the key otherwise", () => {
  const p = normalizeProductInput({ ...tirz, variations: [...tirz.variations, { name: "40mg", price: 800, available: true }] });
  const by = Object.fromEntries((p.variations ?? []).map((v) => [v.name, v]));
  assert.equal(by["50mg"].available, false);
  assert.ok(!("available" in by["5mg"]));
  assert.ok(!("available" in by["40mg"]));
});
check("DB write → read round-trip keeps the hidden option", () => {
  const write = productToDbWrite(normalizeProductInput(tirz), "PHP", "₱");
  const read = dbProductToStorefront(
    {
      id: "p1", sku: "S", name: write.name, description: write.description,
      priceCents: write.priceCents, currency: write.currency, slug: "tirzepatide",
      images: [], stock: 0, status: write.status, active: write.active, metadata: write.metadata,
    },
    "₱",
  );
  assert.equal(read.variations?.find((v) => v.name === "50mg")?.available, false);
  assert.ok(!("available" in (read.variations?.find((v) => v.name === "5mg") ?? {})));
});

console.log("storefront");
check("card options skip the hidden option", () => {
  assert.deepEqual(buildProductOptions(tirz).map((o) => o.name), ["5mg", "30mg"]);
});
check("every option hidden → no picker, no options", () => {
  const all = { price: 416, variations: [{ name: "5mg", price: 416, available: false }] };
  assert.deepEqual(buildProductOptions(all), []);
  assert.equal(shouldShowOptionPicker(all), false);
});
check("group-buy page options + card name skip it", () => {
  assert.deepEqual(gbPageOptions({ ...tirz, productType: "gb" } as never, "₱").map((o) => o.name), ["5mg", "30mg"]);
  assert.equal(gbDisplayName("Tirzepatide", tirz.variations), "Tirzepatide 5mg / 30mg");
});
check("search does not match a hidden option's name", () => {
  assert.equal(matchesListingQuery(tirz, "50mg"), false);
  assert.equal(matchesListingQuery(tirz, "30mg"), true);
});

console.log("placement guard");
check("a line for the hidden option is refused", () => {
  const err = unavailableLineViolation([tirz], [{ productId: "p1", name: "Tirzepatide", variation: "50mg" }]);
  assert.ok(err && err.includes("50mg"), String(err));
});
check("listed options and unrelated lines pass", () => {
  assert.equal(unavailableLineViolation([tirz], [{ productId: "p1", name: "Tirzepatide", variation: "5mg" }]), null);
  assert.equal(unavailableLineViolation([tirz], [{ productId: "zz", name: "Other" }]), null);
});
check("a product the owner switched off is refused too", () => {
  assert.ok(unavailableLineViolation([{ id: "p2", name: "BPC-157", available: false }], [{ productId: "p2", name: "BPC-157" }]));
});
check("a bare line for a product with every option hidden is refused", () => {
  const all = { id: "p3", name: "Sema", variations: [{ name: "10mg", price: 1, available: false }] };
  assert.ok(unavailableLineViolation([all], [{ productId: "p3", name: "Sema" }]));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
