/**
 * Self-contained test for the two product-editor behaviours added alongside the
 * Reseller Portal entitlement (AdminAddProduct.tsx). Runs the REAL pure helpers
 * (no DB, no React runtime) plus one structural check on the editor source:
 *
 *   - src/storefront/visibility.ts
 *       isResellerPricingVisible(brand) — the product editor's "Reseller /
 *           Wholesale Pricing" card is entitlement-gated exactly like the
 *           Reseller Portal manager view it feeds. Before this it rendered
 *           unconditionally, so tenants without the feature still saw (and could
 *           fill in) wholesale prices no storefront surface would ever sell.
 *
 *   - src/storefront/admin/variation-presets.ts
 *       applyVariationPreset(items, preset) — quick-fill for the two options
 *           peptide sellers reach for constantly ("Vials only" / "Complete
 *           set"), so the labels stay consistent instead of being retyped.
 *
 *   npm run test:product-variations
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Brand } from "../src/storefront/types";
import { isAdminViewVisible, isResellerPricingVisible } from "../src/storefront/visibility";
import {
  VARIATION_PRESETS,
  applyVariationPreset,
  type VariationDraft,
} from "../src/storefront/admin/variation-presets";

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

// Only the field under test matters; the rest of Brand is irrelevant here.
const brandWith = (showAdminReseller?: boolean) => ({ showAdminReseller }) as Brand;

console.log("\nProduct editor — reseller gate + variation presets\n");

// ───────────────────── isResellerPricingVisible (the bug) ───────────────────
console.log("isResellerPricingVisible");

check("hidden when the tenant's Reseller Portal entitlement is off", () => {
  assert.equal(isResellerPricingVisible(brandWith(false)), false);
});

check("shown when the tenant is entitled to the Reseller Portal", () => {
  assert.equal(isResellerPricingVisible(brandWith(true)), true);
});

check("shown for a legacy brand blob that predates the flag (undefined = entitled)", () => {
  assert.equal(isResellerPricingVisible(brandWith(undefined)), true);
});

check("agrees with the Reseller Portal manager view — one entitlement, no drift", () => {
  for (const flag of [true, false, undefined]) {
    assert.equal(
      isResellerPricingVisible(brandWith(flag)),
      isAdminViewVisible(brandWith(flag), "reseller"),
      `showAdminReseller=${String(flag)} should match the manager view`,
    );
  }
});

check("the editor actually gates its wholesale card on the helper", () => {
  const src = readFileSync(
    join(process.cwd(), "src/storefront/admin/AdminAddProduct.tsx"),
    "utf8",
  );
  const heading = src.indexOf("Reseller / Wholesale Pricing");
  assert.notEqual(heading, -1, "wholesale card heading not found in the editor");

  // The gate must appear in the JSX immediately preceding the card, not merely
  // somewhere in the file — an unused import would otherwise pass this check.
  const preceding = src.slice(Math.max(0, heading - 400), heading);
  assert.ok(
    /isResellerPricingVisible\(\s*brand\s*\)\s*&&/.test(preceding),
    "the Reseller / Wholesale Pricing card is not wrapped in isResellerPricingVisible(brand) &&",
  );
});

// ─────────────────────────── applyVariationPreset ───────────────────────────
console.log("applyVariationPreset");

check("exposes the two presets peptide sellers use", () => {
  assert.deepEqual([...VARIATION_PRESETS], ["Vials only", "Complete set"]);
});

check("appends the preset with a blank price ready to type into", () => {
  const out = applyVariationPreset([], "Vials only");
  assert.deepEqual(out, [{ name: "Vials only", price: "" }]);
});

check("keeps existing rows untouched when appending", () => {
  const items: VariationDraft[] = [{ name: "5mg", price: 1200 }];
  const out = applyVariationPreset(items, "Complete set");
  assert.deepEqual(out, [
    { name: "5mg", price: 1200 },
    { name: "Complete set", price: "" },
  ]);
});

check("does not mutate the input array", () => {
  const items: VariationDraft[] = [{ name: "5mg", price: 1200 }];
  const before = JSON.stringify(items);
  applyVariationPreset(items, "Vials only");
  assert.equal(JSON.stringify(items), before, "input array was mutated");
});

check("fills the first blank row instead of stacking another empty one", () => {
  const items: VariationDraft[] = [{ name: "5mg", price: 1200 }, { name: "", price: "" }];
  const out = applyVariationPreset(items, "Vials only");
  assert.deepEqual(out, [
    { name: "5mg", price: 1200 },
    { name: "Vials only", price: "" },
  ]);
});

check("preserves a price already typed into the blank row it fills", () => {
  const items: VariationDraft[] = [{ name: "", price: 950 }];
  const out = applyVariationPreset(items, "Complete set");
  assert.deepEqual(out, [{ name: "Complete set", price: 950 }]);
});

check("is a no-op when the preset is already in the list", () => {
  const items: VariationDraft[] = [{ name: "Vials only", price: 800 }];
  assert.deepEqual(applyVariationPreset(items, "Vials only"), items);
});

check("matches an existing preset case-insensitively and ignores stray whitespace", () => {
  const items: VariationDraft[] = [{ name: "  vials ONLY ", price: 800 }];
  assert.deepEqual(applyVariationPreset(items, "Vials only"), items);
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
