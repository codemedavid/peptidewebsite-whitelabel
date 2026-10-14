/**
 * Self-contained test for the "reveal price on click" behaviour of variation
 * products on the storefront product card + its full-detail quick-view modal.
 *
 * The rule (requested by the store owner): when a product has variations, the
 * option pills show ONLY the variation name — no price — and the card shows no
 * price at all until the customer clicks one of the pills. A single-price
 * product (no variations) is unchanged: its price shows immediately.
 *
 * Two layers are covered:
 *   1. The pure helper that decides what price (if any) to show:
 *        src/lib/storefront/variations.ts → resolveSelectedPrice(product, idx)
 *   2. Structural guards on src/storefront/components/Catalog.tsx so the card and
 *      modal actually consume the helper, start with nothing selected, render
 *      pill NAMES (not name · price), and block "Add to Cart" until a pick.
 *
 *   npm run test:variation-price-reveal
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { initialOptionIndex, resolveSelectedPrice } from "../src/lib/storefront/variations";

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

const productWith = (price: number, variations?: { name: string; price: number }[]) =>
  ({ price, variations }) as Parameters<typeof resolveSelectedPrice>[0];

console.log("\nVariation price reveal — name-only pills, price on click\n");

// ─────────────────────────── resolveSelectedPrice ───────────────────────────
console.log("resolveSelectedPrice");

check("a single-price product always shows its base price (index ignored)", () => {
  assert.equal(resolveSelectedPrice(productWith(1500), -1), 1500);
  assert.equal(resolveSelectedPrice(productWith(1500), 0), 1500);
});

check("a variation product shows NO price until an option is picked (idx < 0 → null)", () => {
  const p = productWith(1500, [
    { name: "Vials only", price: 900 },
    { name: "Complete set", price: 2500 },
  ]);
  assert.equal(resolveSelectedPrice(p, -1), null);
});

check("picking an option reveals exactly that option's price", () => {
  const p = productWith(1500, [
    { name: "Vials only", price: 900 },
    { name: "Complete set", price: 2500 },
  ]);
  // options = [Standard 1500, Vials only 900, Complete set 2500]
  assert.equal(resolveSelectedPrice(p, 0), 1500);
  assert.equal(resolveSelectedPrice(p, 1), 900);
  assert.equal(resolveSelectedPrice(p, 2), 2500);
});

check("an index past the end of the option list is treated as no selection", () => {
  const p = productWith(0, [{ name: "Vials only", price: 900 }]);
  // options = [Vials only 900] → only index 0 is valid
  assert.equal(resolveSelectedPrice(p, 1), null);
  assert.equal(resolveSelectedPrice(p, 5), null);
});

check("stays null for a variation product regardless of its base price", () => {
  const p = productWith(0, [{ name: "Vials only", price: 900 }]);
  assert.equal(resolveSelectedPrice(p, -1), null);
});

// ─────────────────────── Catalog.tsx structural guards ──────────────────────
console.log("Catalog.tsx card + modal");

const catalog = readFileSync(
  join(process.cwd(), "src/storefront/components/Catalog.tsx"),
  "utf8",
);

check("the card + modal consume the reveal-on-click price rule", () => {
  // Either directly, or through resolveSaleView — which wraps resolveSelectedPrice
  // so the same surfaces can also show a markdown (npm run test:sale-price). The
  // reveal rule is unchanged: a variation product still resolves to `null` until
  // a pill is clicked; only the name of the function the card calls moved.
  assert.ok(
    catalog.includes("resolveSelectedPrice") || catalog.includes("resolveSaleView"),
    "Catalog.tsx calls neither resolveSelectedPrice nor resolveSaleView — the reveal-on-click rule is not wired",
  );
});

check("both option pickers start from initialOptionIndex (nothing selected by default)", () => {
  const inits = catalog.match(/useState\(\s*\(\)\s*=>\s*initialOptionIndex\(/g) ?? [];
  assert.ok(
    inits.length >= 2,
    `expected the card AND modal to init optIdx via initialOptionIndex (found ${inits.length})`,
  );
});

check("initialOptionIndex: reveal-on-click stays the default (-1)", () => {
  assert.strictEqual(initialOptionIndex(3, undefined), -1);
  assert.strictEqual(initialOptionIndex(3, false), -1);
});

check("initialOptionIndex: a store that opts in starts on the first option", () => {
  assert.strictEqual(initialOptionIndex(2, true), 0);
});

check("initialOptionIndex: no options → nothing to preselect", () => {
  assert.strictEqual(initialOptionIndex(0, true), -1);
});

check("option pills no longer render optionLabel (name · price)", () => {
  assert.ok(
    !catalog.includes("optionLabel("),
    "Catalog.tsx still calls optionLabel — pills would show name · price, not name only",
  );
});

check("the CTA blocks purchase until an option is picked (Select an option)", () => {
  assert.ok(
    catalog.includes("Select an option"),
    "no 'Select an option' affordance — a variation product can be bought with no pick",
  );
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
