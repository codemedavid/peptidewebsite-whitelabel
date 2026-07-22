/**
 * Tests for the reseller-pricing entitlement gate —
 * src/lib/storefront/reseller-gate.ts
 *
 * Bug (pepstack-davao): the cart auto-applies a product's wholesale
 * `reseller` tier at qty ≥ minQty even when the tenant's Reseller portal
 * feature (FEATURES.STORE_RESELLER_PORTAL) is disabled. The feature flag only
 * gated the #merchant page + admin view — never the pricing path — so one
 * product carrying stray `reseller.vialsOnly = 2` data sold at ₱2/ea in bulk.
 *
 * Guarantee: an UNENTITLED tenant's catalog carries no reseller legs at all —
 * both the storefront render (page.tsx) and server-authoritative order
 * placement (orders.ts) strip them, so no cart/badge/price surface can apply
 * wholesale pricing without the operator's grant.
 *
 *   npm run test:reseller-gate
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { stripResellerPricing } from "../src/lib/storefront/reseller-gate";
import { isResellerQty, unitPrice, resellerUnitPrice } from "../src/storefront/checkout";
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
    name: "Product",
    description: "",
    price: 650,
    currency: "₱",
    category: "all",
    featured: false,
    image: null,
    stock: 100,
    ...p,
  };
}

// The pepstack-davao repro: retail ₱650, stray wholesale leg ₱2 @ minQty 10.
const ghk = product({
  id: "ghk-50",
  name: "GHK-Cu 50mg (Vial + 10ml Bac)",
  price: 650,
  reseller: { vialsOnly: 2, minQty: 10 },
});

// ── The pure gate ────────────────────────────────────────────────────────────

check("unentitled: reseller legs are stripped from every product", () => {
  const out = stripResellerPricing([ghk, product({ id: "plain" })], false);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].reseller, undefined);
  assert.strictEqual(out[1].reseller, undefined);
});

check("unentitled: stripping is immutable — the input products are unchanged", () => {
  const input = [ghk];
  const out = stripResellerPricing(input, false);
  assert.notStrictEqual(out[0], ghk);
  assert.deepStrictEqual(ghk.reseller, { vialsOnly: 2, minQty: 10 });
});

check("unentitled: every other product field survives the strip", () => {
  const [out] = stripResellerPricing([ghk], false);
  assert.strictEqual(out.name, ghk.name);
  assert.strictEqual(out.price, 650);
  assert.strictEqual(out.stock, 100);
});

check("entitled: products pass through unchanged, reseller legs intact", () => {
  const out = stripResellerPricing([ghk], true);
  assert.deepStrictEqual(out[0].reseller, { vialsOnly: 2, minQty: 10 });
});

// ── Effect on pricing (the actual bug surface) ───────────────────────────────

check("bug repro: WITH reseller data, qty 10 prices at the ₱2 wholesale leg", () => {
  // Documents why the gate matters — ungated data undercuts retail 325x.
  assert.strictEqual(unitPrice(ghk, 10), 2);
  assert.strictEqual(isResellerQty(ghk, 10), true);
});

check("gated: a stripped product prices at retail in bulk — no badge, no ₱2", () => {
  const [gated] = stripResellerPricing([ghk], false);
  assert.strictEqual(unitPrice(gated, 10), 650);
  assert.strictEqual(isResellerQty(gated, 10), false);
  assert.strictEqual(resellerUnitPrice(gated), null);
});

// ── Wiring: both server surfaces apply the gate ──────────────────────────────

const ROOT = join(__dirname, "..");
const pageSrc = readFileSync(join(ROOT, "src/app/(tenant)/(storefront)/page.tsx"), "utf8");
const ordersSrc = readFileSync(join(ROOT, "src/actions/orders.ts"), "utf8");

check("page.tsx gates the rendered catalog on resellerEntitled", () => {
  assert.match(pageSrc, /stripResellerPricing\(\s*products,\s*resellerEntitled\s*\)/);
});

check("orders.ts gates BOTH placement catalogs (demo + DB) on the entitlement", () => {
  const calls = ordersSrc.match(/stripResellerPricing\(/g) ?? [];
  assert.ok(
    calls.length >= 2,
    `expected stripResellerPricing on both catalog loads, found ${calls.length}`,
  );
  assert.match(ordersSrc, /STORE_RESELLER_PORTAL/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
