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

import { stripResellerPricing, preserveResellerMetadata } from "../src/lib/storefront/reseller-gate";
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

// ── Product-save preservation ────────────────────────────────────────────────
// The strip feeds the store-admin editor too, so an UNENTITLED owner's product
// save would otherwise write reseller zeros over the DB's dormant wholesale
// data — breaking the "re-granting restores prices untouched" guarantee. The
// save path must keep the EXISTING DB leg when the tenant isn't entitled.

check("unentitled save: the DB's existing reseller leg is preserved verbatim", () => {
  const incoming = { name: "GHK", reseller: { vialsOnly: 0, completeSet: 0 } };
  const existing = { reseller: { vialsOnly: 2, minQty: 10 } };
  const out = preserveResellerMetadata(incoming, existing, false);
  assert.deepStrictEqual(out.reseller, { vialsOnly: 2, minQty: 10 });
  assert.strictEqual(out.name, "GHK");
});

check("unentitled save: no existing leg → no reseller key is written", () => {
  const out = preserveResellerMetadata({ reseller: { vialsOnly: 5 } }, {}, false);
  assert.ok(!("reseller" in out), "must not invent a reseller leg");
});

check("entitled save: the incoming reseller value wins", () => {
  const out = preserveResellerMetadata(
    { reseller: { vialsOnly: 5 } },
    { reseller: { vialsOnly: 2 } },
    true,
  );
  assert.deepStrictEqual(out.reseller, { vialsOnly: 5 });
});

check("preservation is immutable — the incoming metadata object is unchanged", () => {
  const incoming = { reseller: { vialsOnly: 5 } };
  preserveResellerMetadata(incoming, { reseller: { vialsOnly: 2 } }, false);
  assert.deepStrictEqual(incoming.reseller, { vialsOnly: 5 });
});

// ── Wiring: both server surfaces apply the gate ──────────────────────────────

const ROOT = join(__dirname, "..");
const pageSrc = readFileSync(join(ROOT, "src/app/(tenant)/(storefront)/page.tsx"), "utf8");
const ordersSrc = readFileSync(join(ROOT, "src/actions/orders.ts"), "utf8");
const productsSrc = readFileSync(join(ROOT, "src/actions/products.ts"), "utf8");

check("page.tsx gates the rendered catalog on BOTH reseller entitlements", () => {
  assert.match(
    pageSrc,
    /stripResellerPricing\(\s*products,\s*resellerEntitled,\s*resellerCaps\.wholesalePricing,?\s*\)/,
    "the render must pass the parent gate AND the wholesale child gate",
  );
});

check("orders.ts gates BOTH placement catalogs (demo + DB) on the entitlement", () => {
  const calls = ordersSrc.match(/stripResellerPricing\(/g) ?? [];
  assert.ok(
    calls.length >= 2,
    `expected stripResellerPricing on both catalog loads, found ${calls.length}`,
  );
  // The gate is resolved through resolveResellerCaps now (which ANDs each child
  // with the STORE_RESELLER_PORTAL parent) rather than a bare hasFeature call.
  assert.match(ordersSrc, /resolveResellerCaps/);
  const wholesaleFlags = ordersSrc.match(/\.wholesalePricing/g) ?? [];
  assert.ok(
    wholesaleFlags.length >= 4,
    `both placement paths must pass the wholesale flag to the strip AND build the
     order-wide MOQ scope from it; found ${wholesaleFlags.length} uses`,
  );
});

check("orders.ts re-prices against the ORDER-WIDE wholesale scope", () => {
  // Built once per placement, before the re-price loop: a per-line view cannot
  // see that four colours of 250 are 1,000 units of one product, so without this
  // the server would undo the cart's wholesale price on every split order.
  assert.match(ordersSrc, /orderWholesaleScope\(/);
  const built = ordersSrc.match(/orderWholesaleScope\(/g) ?? [];
  assert.strictEqual(built.length, 2, "one scope per placement path (demo + DB)");
  const priced = ordersSrc.match(/repriceItems\(\s*p\.items,[^)]*Scope\s*\)/g) ?? [];
  assert.strictEqual(priced.length, 2, "both re-price calls must receive a wholesale scope");
});

check("products.ts strips the PUBLIC storefront refresh (getStorefrontProductsAction)", () => {
  // The refresh action re-feeds the client catalog mid-session; without the
  // strip, an unentitled storefront regains wholesale legs the render removed
  // and the cart advertises prices checkout won't charge.
  const start = productsSrc.indexOf("export async function getStorefrontProductsAction");
  const end = productsSrc.indexOf("export async function", start + 1);
  const body = productsSrc.slice(start, end === -1 ? undefined : end);
  assert.ok(start >= 0, "getStorefrontProductsAction must exist");
  assert.match(body, /stripResellerPricing/, "public refresh must apply the strip");
});

check("products.ts preserves existing reseller metadata on unentitled saves", () => {
  assert.match(productsSrc, /preserveResellerMetadata/);
});

// ── The wholesale (MOQ) config is gated on its OWN child entitlement ──────────
// `reseller` is gated by the parent (above). `wholesale` — the config the
// Product Management screen writes — is gated by storefront.reseller.wholesale,
// a separate child, because a tenant can hold the parent (for the #merchant
// page) without being granted MOQ pricing on the regular storefront. The strip
// therefore takes TWO flags, and the wholesale one fails CLOSED: a call site
// that does not pass it strips the config rather than charging wholesale prices
// the operator never granted.

check("an unentitled tenant's catalog carries no wholesale config", () => {
  const p = product({ id: "caps", price: 10, wholesale: { enabled: true, moq: 100, price: 7 } });
  const [stripped] = stripResellerPricing([p], true, false);
  assert.strictEqual(stripped.wholesale, undefined, "wholesale config must be removed");
  assert.strictEqual(unitPrice(stripped, 500), 10, "and the price falls back to retail");
});

check("wholesale is stripped by DEFAULT — the gate fails closed", () => {
  const p = product({ id: "caps", price: 10, wholesale: { enabled: true, moq: 100, price: 7 } });
  const [stripped] = stripResellerPricing([p], true);
  assert.strictEqual(stripped.wholesale, undefined, "omitting the flag must not grant wholesale");
});

check("an entitled tenant keeps the wholesale config untouched", () => {
  const p = product({ id: "caps", price: 10, wholesale: { enabled: true, moq: 100, price: 7 } });
  const [kept] = stripResellerPricing([p], true, true);
  assert.deepStrictEqual(kept.wholesale, { enabled: true, moq: 100, price: 7 });
  assert.strictEqual(unitPrice(kept, 500), 7);
});

check("the parent gate still strips the legacy leg independently", () => {
  const p = product({
    id: "both",
    price: 10,
    reseller: { completeSet: 7 },
    wholesale: { enabled: true, moq: 100, price: 6 },
  });
  const [parentOff] = stripResellerPricing([p], false, true);
  assert.strictEqual(parentOff.reseller, undefined, "legacy leg goes with the parent");
  assert.deepStrictEqual(parentOff.wholesale, { enabled: true, moq: 100, price: 6 });
});

check("an unentitled owner's save cannot overwrite dormant wholesale config", () => {
  const existing = { wholesale: { enabled: true, moq: 100, price: 7 }, other: 1 };
  const kept = preserveResellerMetadata({ wholesale: { enabled: false, moq: 0, price: 0 } }, existing, false);
  assert.deepStrictEqual(
    kept.wholesale,
    { enabled: true, moq: 100, price: 7 },
    "the DB's dormant config must survive, so re-granting restores prices",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
