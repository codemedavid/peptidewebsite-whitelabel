/**
 * Self-contained test for the wholesale decision at ORDER PLACEMENT.
 *
 * The storefront render (page.tsx), the public price refresh (products.ts) and
 * the order pipeline (orders.ts) each decide, independently, whether this
 * request may see wholesale prices. They must reach the SAME answer: the price a
 * customer browses has to be the price they are charged. They did not — the
 * render honoured the verified reseller session while placement looked only at
 * the bare `wholesalePricing` cap, so a reseller on a gated page-only tenant was
 * quoted ₱7/unit and charged ₱10/unit.
 *
 * That divergence survived a green suite because the existing coverage asserts
 * on the SOURCE TEXT of orders.ts with regexes rather than exercising the
 * decision. This suite tests the decision itself.
 *
 *   src/lib/storefront/reseller-access.ts
 *     resolveWholesaleAccess(caps, unlocked) -> { visible, moqEnforced }
 *       visible     — may this request see/charge wholesale at all (the one
 *                     answer all three call sites share)?
 *       moqEnforced — does the gated page's minimum-order rule govern this
 *                     order? Only when the wholesale prices in play are the
 *                     PAGE's, which are advertised with an MOQ.
 *
 *   npm run test:reseller-placement
 */

import assert from "node:assert";

import type { Product } from "../src/storefront/types";
import type { ResellerCapabilities } from "../src/lib/storefront/reseller-caps";
import {
  wholesaleVisibleTo,
  resolveWholesaleAccess,
} from "../src/lib/storefront/reseller-access";
import { stripResellerPricing } from "../src/lib/storefront/reseller-gate";
import { orderWholesaleScope } from "../src/lib/storefront/wholesale";
import { resellerMoqViolation } from "../src/lib/storefront/reseller-moq";
import { unitPrice, authoritativeItemPrice } from "../src/storefront/checkout";

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

function caps(over: Partial<ResellerCapabilities> = {}): ResellerCapabilities {
  return { enabled: true, wholesalePricing: false, resellerPage: false, ...over };
}

const OFF = caps({ enabled: false });
const PAGE_ONLY = caps({ resellerPage: true });                       // today's stores
const PUBLIC_WHOLESALE = caps({ wholesalePricing: true });            // MOQ on the regular store
const BOTH = caps({ wholesalePricing: true, resellerPage: true });

function product(p: Partial<Product> & { id: string }): Product {
  return {
    name: "Product",
    description: "",
    price: 10,
    currency: "₱",
    category: "all",
    featured: false,
    image: null,
    stock: 100_000,
    ...p,
  };
}

/** Retail ₱10, wholesale ₱7 once 1,000 units are reached. */
const VIAL = product({
  id: "vial",
  name: "Semaglutide vial",
  price: 10,
  wholesale: { enabled: true, moq: 1000, price: 7 },
});

console.log("\nWholesale access at placement\n");

// ─── The shared decision ────────────────────────────────────────────────────

check("visibility still matches the render's existing rule, for every tenant shape", () => {
  // resolveWholesaleAccess must not change what the storefront already shows —
  // it only gives placement the same answer.
  for (const c of [OFF, PAGE_ONLY, PUBLIC_WHOLESALE, BOTH]) {
    for (const unlocked of [false, true]) {
      assert.strictEqual(
        resolveWholesaleAccess(c, unlocked).visible,
        wholesaleVisibleTo(c, unlocked),
        `caps=${JSON.stringify(c)} unlocked=${unlocked}`,
      );
    }
  }
});

check("a page-only tenant hides wholesale until the reseller unlocks it", () => {
  assert.strictEqual(resolveWholesaleAccess(PAGE_ONLY, false).visible, false);
  assert.strictEqual(resolveWholesaleAccess(PAGE_ONLY, true).visible, true);
});

check("public wholesale is visible to everyone, locked or not", () => {
  assert.strictEqual(resolveWholesaleAccess(PUBLIC_WHOLESALE, false).visible, true);
  assert.strictEqual(resolveWholesaleAccess(PUBLIC_WHOLESALE, true).visible, true);
});

check("the parent switch off hides wholesale even from an unlocked session", () => {
  assert.strictEqual(resolveWholesaleAccess(OFF, true).visible, false);
});

// ─── The money bug: browse price must equal charged price ───────────────────

/** What the storefront quotes: the cart's own per-unit price. */
function browsePrice(c: ResellerCapabilities, unlocked: boolean, qty: number): number {
  const access = resolveWholesaleAccess(c, unlocked);
  const [live] = stripResellerPricing([VIAL], access.visible, access.visible);
  const scope = orderWholesaleScope([{ productId: "vial", name: VIAL.name, qty }], [live], access.visible);
  return unitPrice(live, qty, null, scope);
}

/** What the server actually charges: the placement re-price. */
function chargedPrice(c: ResellerCapabilities, unlocked: boolean, qty: number): number {
  const access = resolveWholesaleAccess(c, unlocked);
  const [live] = stripResellerPricing([VIAL], access.visible, access.visible);
  const item = { productId: "vial", name: VIAL.name, qty };
  const scope = orderWholesaleScope([item], [live], access.visible);
  return authoritativeItemPrice(item, [live], null, scope) ?? -1;
}

check("an unlocked reseller on a page-only tenant is CHARGED the ₱7 they were quoted", () => {
  // The reported bug: quoted ₱7,000 for 1,000 units, charged ₱10,000.
  assert.strictEqual(browsePrice(PAGE_ONLY, true, 1000), 7, "quoted");
  assert.strictEqual(chargedPrice(PAGE_ONLY, true, 1000), 7, "charged");
});

check("browse price equals charged price for every tenant shape and lock state", () => {
  for (const c of [OFF, PAGE_ONLY, PUBLIC_WHOLESALE, BOTH]) {
    for (const unlocked of [false, true]) {
      for (const qty of [1, 999, 1000, 5000]) {
        assert.strictEqual(
          chargedPrice(c, unlocked, qty),
          browsePrice(c, unlocked, qty),
          `caps=${JSON.stringify(c)} unlocked=${unlocked} qty=${qty}`,
        );
      }
    }
  }
});

check("a LOCKED visitor on a page-only tenant pays retail on both sides", () => {
  // The mirror of the bug: placement must not apply a wholesale leg the page
  // withheld, which would undercharge instead of overcharge.
  assert.strictEqual(browsePrice(PAGE_ONLY, false, 5000), 10);
  assert.strictEqual(chargedPrice(PAGE_ONLY, false, 5000), 10);
});

check("public wholesale still reaches the MOQ price with no session at all", () => {
  assert.strictEqual(chargedPrice(PUBLIC_WHOLESALE, false, 1000), 7);
  assert.strictEqual(chargedPrice(PUBLIC_WHOLESALE, false, 999), 10);
});

// ─── The MOQ rule: who it governs ───────────────────────────────────────────

check("the MOQ rule governs an unlocked reseller on a page-only tenant", () => {
  // That page advertises "1,000 units @ ₱7", so ordering 1 through it is an
  // error worth naming rather than silently charging retail.
  assert.strictEqual(resolveWholesaleAccess(PAGE_ONLY, true).moqEnforced, true);
});

check("the MOQ rule does NOT govern a tenant whose wholesale is public", () => {
  // Here MOQ pricing is a public tier any shopper can reach: buying 1 unit at
  // retail is an ordinary purchase, not a violation. Blocking it made every
  // wholesale-configured product unbuyable in small quantities for 12 hours to
  // anyone who had ever unlocked the portal.
  assert.strictEqual(resolveWholesaleAccess(PUBLIC_WHOLESALE, true).moqEnforced, false);
  assert.strictEqual(resolveWholesaleAccess(BOTH, true).moqEnforced, false);
});

check("the MOQ rule never governs a request that cannot see wholesale at all", () => {
  assert.strictEqual(resolveWholesaleAccess(PAGE_ONLY, false).moqEnforced, false);
  assert.strictEqual(resolveWholesaleAccess(OFF, true).moqEnforced, false);
  assert.strictEqual(resolveWholesaleAccess(OFF, false).moqEnforced, false);
});

check("moqEnforced never implies anything invisible — it is a subset of visible", () => {
  for (const c of [OFF, PAGE_ONLY, PUBLIC_WHOLESALE, BOTH]) {
    for (const unlocked of [false, true]) {
      const a = resolveWholesaleAccess(c, unlocked);
      if (a.moqEnforced) assert.strictEqual(a.visible, true, JSON.stringify(c));
    }
  }
});

// ─── The MOQ rule actually fires on the catalog placement uses ──────────────

check("the MOQ rule sees the wholesale leg it is meant to enforce", () => {
  // It was previously handed the STRIPPED catalog on exactly the page-only
  // tenants it was written for, so resolveWholesale() found nothing and the
  // rule silently enforced nothing.
  const access = resolveWholesaleAccess(PAGE_ONLY, true);
  const catalog = stripResellerPricing([VIAL], access.visible, access.visible);
  const short = resellerMoqViolation([{ productId: "vial", name: VIAL.name, qty: 1 }], catalog);
  assert.ok(short && /minimum reseller order of 1,000/.test(short), `got: ${short}`);
});

check("a reseller who meets the MOQ is not blocked", () => {
  const access = resolveWholesaleAccess(PAGE_ONLY, true);
  const catalog = stripResellerPricing([VIAL], access.visible, access.visible);
  assert.strictEqual(
    resellerMoqViolation([{ productId: "vial", name: VIAL.name, qty: 1000 }], catalog),
    null,
  );
});

check("a signed-in reseller can still buy ONE unit at retail on a public-wholesale store", () => {
  // The availability bug, end to end: same person, same cookie, ordinary cart.
  const access = resolveWholesaleAccess(BOTH, true);
  assert.strictEqual(access.moqEnforced, false, "the rule must not govern this order");
  assert.strictEqual(chargedPrice(BOTH, true, 1), 10, "and they pay ordinary retail");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
