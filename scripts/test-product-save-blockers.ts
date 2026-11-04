// npm run test:product-save-blockers
// The Add Product Save button is disabled until the form is complete. It used
// to say nothing, so an owner who left the (then-required) Description blank
// reported "I can't add a product". These checks pin the reasons the form
// shows, and that a blank description no longer blocks a save.
import assert from "node:assert/strict";

import { productSaveBlockers } from "../src/lib/storefront/product-save-blockers";

const COMPLETE = {
  name: "L-Carnitine 600mg",
  category: "lipo",
  price: "514",
  unpricedOptions: [] as string[],
  wholesaleError: "",
};

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${(e as Error).message}`);
  }
}

check("a complete form with NO description has no blockers (the MNM Pepsabuy report)", () => {
  // The helper does not take a description at all: it cannot block on one.
  assert.deepEqual(productSaveBlockers(COMPLETE), []);
});

check("a blank or whitespace name blocks", () => {
  assert.deepEqual(productSaveBlockers({ ...COMPLETE, name: "   " }), ["Product name"]);
});

check("no category blocks", () => {
  assert.deepEqual(productSaveBlockers({ ...COMPLETE, category: "" }), ["Category"]);
});

check("a negative or non-numeric price blocks; blank and 0 do not", () => {
  assert.deepEqual(productSaveBlockers({ ...COMPLETE, price: "-1" }), ["A base price of 0 or more"]);
  assert.deepEqual(productSaveBlockers({ ...COMPLETE, price: "abc" }), ["A base price of 0 or more"]);
  assert.deepEqual(productSaveBlockers({ ...COMPLETE, price: "0" }), []);
  assert.deepEqual(productSaveBlockers({ ...COMPLETE, price: "" }), []);
});

check("unpriced options are named", () => {
  assert.deepEqual(productSaveBlockers({ ...COMPLETE, unpricedOptions: ["5mg", "10mg"] }), [
    "A price for 5mg, 10mg",
  ]);
});

check("a wholesale error is passed through", () => {
  assert.deepEqual(productSaveBlockers({ ...COMPLETE, wholesaleError: "Set a minimum quantity" }), [
    "Wholesale: Set a minimum quantity",
  ]);
});

check("several problems are all listed, in form order", () => {
  assert.deepEqual(productSaveBlockers({ ...COMPLETE, name: "", category: "", unpricedOptions: ["5mg"] }), [
    "Product name",
    "Category",
    "A price for 5mg",
  ]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
