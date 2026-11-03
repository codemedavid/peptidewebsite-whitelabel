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
  applyRoundExclusions,
} from "../src/lib/storefront/variation-availability";
import { normalizeExcludedVariations } from "../src/lib/storefront/group-buy";
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

console.log("per-round exclusions");
const plain = { id: "p1", name: "Tirzepatide", price: 416, variations: [{ name: "5mg", price: 416 }, { name: "30mg", price: 595 }, { name: "50mg", price: 960 }] };
check("the live round's unticked option is hidden and refused — only for products it names", () => {
  const [p, other] = applyRoundExclusions([plain, { id: "p9", name: "BPC", price: 1, variations: [{ name: "50mg", price: 1 }] }], { p1: ["50mg"] });
  assert.deepEqual(buildProductOptions(p).map((o) => o.name), ["5mg", "30mg"]);
  assert.ok(unavailableLineViolation([p], [{ productId: "p1", name: "Tirzepatide", variation: "50mg" }]));
  assert.equal(unavailableLineViolation([p], [{ productId: "p1", name: "Tirzepatide", variation: "30mg" }]), null);
  assert.deepEqual(buildProductOptions(other).map((o) => o.name), ["50mg"], "other products untouched");
});
check("no round / empty exclusions → same objects back (nothing hidden)", () => {
  const list = [plain];
  assert.equal(applyRoundExclusions(list, undefined), list);
  assert.equal(applyRoundExclusions(list, {}), list);
});
check("the round flag never persists: a product save drops it", () => {
  const [p] = applyRoundExclusions([plain], { p1: ["50mg"] });
  const saved = normalizeProductInput(p);
  assert.ok(!(saved.variations ?? []).some((v) => "notInRound" in v || v.available === false));
});
check("excludedVariations normalizer: unique trimmed names, empty lists dropped", () => {
  assert.deepEqual(normalizeExcludedVariations({ p1: [" 50mg", "50mg", "", 3], p2: [], "": ["x"] }), { p1: ["50mg"] });
  assert.deepEqual(normalizeExcludedVariations(null), {});
  assert.deepEqual(normalizeExcludedVariations(["x"]), {});
});

check("guards: an app round save keeps exclusions; Inventory reads only the store-wide flag", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const gbActions = readFileSync("src/actions/group-buys.ts", "utf8");
  assert.match(gbActions, /"excludedVariations" in/);
  assert.match(gbActions, /gb\.excludedVariations = before\.excludedVariations/);
  const inv = readFileSync("src/storefront/admin/AdminInventory.tsx", "utf8");
  assert.match(inv, /v\.available === false/);
  assert.doesNotMatch(inv, /isVariationListed\(/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
