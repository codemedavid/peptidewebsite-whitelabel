/**
 * Tests for DUAL-CURRENCY markets (Local ₱ + International USD):
 *
 *   src/lib/storefront/markets.ts       — which products each market sells, at what price
 *   src/lib/storefront/intl-market.ts   — the International view of the checkout config
 *   product-input / product-mapping     — the new fields survive every save path
 *
 *   npm run test:markets
 *
 * The guarantees: an existing store/product is untouched (absent = local), an
 * International product is only ever sold at a USD price the owner set, peso-only
 * pricing and fees never leak into a USD order, and QR PH never appears on one.
 *
 * Pure: no DB, no browser.
 */

import assert from "node:assert";

import {
  cartMarketOf,
  hasUsdPrice,
  marketCatalog,
  marketCurrencyCode,
  normalizeProductMarket,
  positivePrice,
  sellsIn,
  toMarketProduct,
} from "../src/lib/storefront/markets";
import {
  applyMarketConfig,
  intlAdminFee,
  intlPromoCodes,
  isDualMarket,
  methodMarkets,
  methodSellsIn,
  normalizeIntlMarket,
  normalizeMethodMarkets,
} from "../src/lib/storefront/intl-market";
import { normalizeProductInput } from "../src/lib/storefront/product-input";
import { dbProductToStorefront, productToDbWrite } from "../src/lib/storefront/product-mapping";
import { normalizeAdminFee, activeAdminFee } from "../src/lib/storefront/admin-fee";
import { normalizePromoCodes } from "../src/lib/storefront/promo";
import type { PaymentMethod, Product, PromoCode } from "../src/storefront/types";
import { isForeignCurrencyOrder, orderCurrencySymbol } from "../src/lib/storefront/markets";
import { checkoutFields } from "../src/lib/storefront/checkout-fields";
import { normalizeOrderInput } from "../src/lib/orders/db-mapping";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
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
  return { name: "Vial", description: "", price: 1500, currency: "₱", category: "x", featured: false, image: null, ...p };
}

function method(p: Partial<PaymentMethod> & { id: string }): PaymentMethod {
  return { name: "GCash", account: "", number: "", qrImage: "", order: 0, active: true, ...p };
}

// ── Products ────────────────────────────────────────────────────────────────
console.log("\nmarkets — which products each market sells");

check("an existing (untagged) product is local only, exactly as before", () => {
  const p = product({ id: "a", usdPrice: 30 });
  assert.equal(normalizeProductMarket(p.market), "local");
  assert.equal(sellsIn(p, "local"), true);
  assert.equal(sellsIn(p, "international"), false, "a USD price alone doesn't list it internationally");
});

check("international-only products leave the local shop; 'both' is in both", () => {
  assert.equal(sellsIn(product({ id: "a", market: "international", usdPrice: 30 }), "local"), false);
  const both = product({ id: "b", market: "both", usdPrice: 30 });
  assert.equal(sellsIn(both, "local"), true);
  assert.equal(sellsIn(both, "international"), true);
});

check("International needs a USD price — never a peso price with a $ sign", () => {
  assert.equal(sellsIn(product({ id: "a", market: "international" }), "international"), false);
  assert.equal(hasUsdPrice({ variations: [{ name: "5mg", price: 900, usdPrice: 18 }] }), true);
});

check("group-buy listings are local only", () => {
  assert.equal(sellsIn(product({ id: "a", market: "both", usdPrice: 30, productType: "gb", gbPrice: 900 }), "international"), false);
});

check("the USD view swaps every price leg and strips peso-only pricing", () => {
  const p = product({
    id: "a",
    market: "both",
    price: 1500,
    usdPrice: 30,
    discountEnabled: true,
    discountPrice: 1200,
    usdDiscountPrice: 24,
    reseller: { vialsOnly: 1000 },
    wholesale: { enabled: true, moq: 10, price: 900 },
    variations: [
      { name: "5mg", price: 1500, usdPrice: 30 },
      { name: "10mg", price: 2500 },
    ],
  });
  const v = toMarketProduct(p, "international");
  assert.equal(v.price, 30);
  assert.equal(v.currency, "$");
  assert.equal(v.discountPrice, 24);
  assert.equal(v.discountEnabled, true);
  assert.deepEqual(v.variations?.map((x) => [x.name, x.price]), [["5mg", 30]], "an option with no USD price isn't sold");
  assert.equal(v.reseller, undefined);
  assert.equal(v.wholesale, undefined);
  assert.equal(v.gbPrice, 0);
  assert.equal(v.sellMarket, "international");
  assert.equal(p.price, 1500, "the input is never mutated");
  assert.equal(p.variations?.length, 2);
});

check("a peso sale doesn't discount the USD price unless a USD sale price is set", () => {
  const v = toMarketProduct(product({ id: "a", market: "both", usdPrice: 30, discountEnabled: true, discountPrice: 1200 }), "international");
  assert.equal(v.discountEnabled, false);
});

check("options-only USD pricing leads with the cheapest option", () => {
  const v = toMarketProduct(
    product({ id: "a", market: "international", variations: [{ name: "10mg", price: 1, usdPrice: 50 }, { name: "5mg", price: 1, usdPrice: 30 }] }),
    "international",
  );
  assert.equal(v.price, 30);
});

check("marketCatalog filters then projects; cart entries know their market", () => {
  const list = [product({ id: "l" }), product({ id: "i", market: "international", usdPrice: 20 })];
  assert.deepEqual(marketCatalog(list, "local").map((p) => p.id), ["l"]);
  const intl = marketCatalog(list, "international");
  assert.deepEqual(intl.map((p) => p.id), ["i"]);
  assert.equal(cartMarketOf(intl[0]), "international");
  assert.equal(cartMarketOf(list[0]), "local", "an unmarked (legacy) cart entry is local");
});

check("currency codes: local keeps the store's own code", () => {
  assert.equal(marketCurrencyCode("local", "SAR"), "SAR");
  assert.equal(marketCurrencyCode("international", "PHP"), "USD");
  assert.equal(positivePrice("0"), undefined);
  assert.equal(positivePrice(""), undefined);
  assert.equal(positivePrice("19.999"), 20);
});

// ── Save paths ──────────────────────────────────────────────────────────────
console.log("\nmarkets — the new fields survive every save path");

check("normalizeProductInput keeps the tag and USD prices (product + option)", () => {
  const p = normalizeProductInput({
    name: "Vial",
    price: 1500,
    market: "both",
    usdPrice: "30",
    usdDiscountPrice: 24,
    variations: [{ name: "5mg", price: 1500, usdPrice: 30 }, { name: "10mg", price: 2500, usdPrice: "" }],
  });
  assert.equal(p.market, "both");
  assert.equal(p.usdPrice, 30);
  assert.equal(p.usdDiscountPrice, 24);
  assert.equal(p.variations?.[0].usdPrice, 30);
  assert.equal("usdPrice" in (p.variations?.[1] ?? {}), false, "a blank option price is not stored");
});

check("an untagged save stores no market key (existing products stay as they are)", () => {
  const p = normalizeProductInput({ name: "Vial", price: 1500, market: "local" });
  assert.equal(p.market, undefined);
  const w = productToDbWrite(p, "PHP", "₱");
  assert.equal("market" in w.metadata, false);
  assert.equal("usdPrice" in w.metadata, false);
});

check("DB round trip: write → read gives the same market + USD prices", () => {
  const p = normalizeProductInput({
    name: "Vial",
    price: 1500,
    market: "international",
    usdPrice: 30,
    variations: [{ name: "5mg", price: 1500, usdPrice: 30 }],
  });
  const w = productToDbWrite(p, "PHP", "₱");
  const back = dbProductToStorefront(
    { id: "x", slug: null, name: w.name, description: w.description, priceCents: w.priceCents, currency: "PHP", stock: 1, status: "active", images: [], metadata: w.metadata } as never,
    "₱",
  );
  assert.equal(back.market, "international");
  assert.equal(back.usdPrice, 30);
  assert.equal(back.variations?.[0].usdPrice, 30);
  assert.equal(back.price, 1500, "the peso price is untouched");
});

// ── Checkout config ─────────────────────────────────────────────────────────
console.log("\nintl-market — the International checkout view");

check("dual market needs the layout; the switch defaults on", () => {
  assert.equal(isDualMarket({ homeLayout: "intl-local" }), true);
  assert.equal(isDualMarket({ homeLayout: "intl-local", intlMarket: { enabled: false } }), false);
  assert.equal(isDualMarket({ homeLayout: "showcase" }), false);
});

check("payment methods: absent ticks = local only; QR PH is never international", () => {
  assert.deepEqual(methodMarkets(method({ id: "g" })), { local: true, international: false });
  assert.equal(methodSellsIn(method({ id: "g" }), "international"), false);
  assert.equal(methodSellsIn(method({ id: "p", markets: { local: false, international: true } }), "international"), true);
  assert.equal(methodSellsIn(method({ id: "p", markets: { local: false, international: true } }), "local"), false);
  assert.equal(methodSellsIn(method({ id: "q", qrph: true, markets: { local: true, international: true } }), "international"), false);
  assert.equal(normalizeMethodMarkets({ local: true, international: false }), undefined, "the default isn't persisted");
});

check("admin fee: fixed needs a USD amount, percentage applies as-is", () => {
  const fixed = { enabled: true, label: "Fee", mode: "fixed", amount: 50, percent: 0 };
  assert.equal(activeAdminFee(intlAdminFee(fixed), 100), null, "a peso amount is never charged in USD");
  assert.equal(activeAdminFee(intlAdminFee({ ...fixed, usdAmount: 2 }), 100)?.amount, 2);
  const pct = { enabled: true, label: "Fee", mode: "percentage", amount: 0, percent: 10 };
  assert.equal(activeAdminFee(intlAdminFee(pct), 100)?.amount, 10);
});

check("admin fee: the USD amount survives normalizeAdminFee (the save path)", () => {
  assert.equal((normalizeAdminFee({ enabled: true, amount: 50, usdAmount: 2 }) as { usdAmount?: number }).usdAmount, 2);
});

check("promo codes: % codes keep working; fixed codes need a USD value", () => {
  const codes: PromoCode[] = [
    { id: "1", code: "TEN", type: "percent", value: 10, minPurchase: 2000, usageLimit: null, used: 0, expiry: null, active: true, usdMinPurchase: 40 },
    { id: "2", code: "P100", type: "fixed", value: 100, minPurchase: 0, usageLimit: null, used: 0, expiry: null, active: true },
    { id: "3", code: "U5", type: "fixed", value: 250, minPurchase: 1000, usageLimit: null, used: 0, expiry: null, active: true, usdValue: 5 },
  ];
  const out = intlPromoCodes(codes);
  assert.deepEqual(out.map((c) => [c.code, c.value, c.minPurchase]), [["TEN", 10, 40], ["U5", 5, 0]]);
});

check("promo codes: the USD fields survive normalizePromoCodes (the save path)", () => {
  const [c] = normalizePromoCodes([{ id: "3", code: "U5", type: "fixed", value: 250, usdValue: 5, usdMinPurchase: 20, active: true }]);
  assert.equal(c.usdValue, 5);
  assert.equal(c.usdMinPurchase, 20);
});

check("the International view: USD shipping, intl methods, no group buy, $", () => {
  const cfg = {
    currency: "₱",
    shippingLocations: [{ id: "mnl", courierId: "", code: "MNL", name: "Manila", price: 150, active: true }],
    intlMarket: { shippingLocations: [{ id: "us", name: "United States", code: "US", price: 25 }] },
    paymentMethods: [method({ id: "gcash" }), method({ id: "paypal", markets: { local: false, international: true } })],
    groupBuyBanner: { id: "r1" },
  };
  const intl = applyMarketConfig(cfg, "international");
  assert.equal(intl.currency, "$");
  assert.deepEqual((intl.shippingLocations as { id: string }[]).map((l) => l.id), ["us"]);
  assert.deepEqual((intl.paymentMethods as PaymentMethod[]).map((m) => m.id), ["paypal"]);
  assert.equal(intl.groupBuyBanner, null);
  const local = applyMarketConfig(cfg, "local");
  assert.deepEqual((local.paymentMethods as PaymentMethod[]).map((m) => m.id), ["gcash"]);
  assert.equal(local.currency, "₱");
  assert.deepEqual((local.shippingLocations as { id: string }[]).map((l) => l.id), ["mnl"]);
  assert.equal(cfg.paymentMethods.length, 2, "the input is never mutated");
});

check("intl shipping list is normalized (unnamed rows dropped, blank price = no fee)", () => {
  const m = normalizeIntlMarket({ shippingLocations: [{ name: "" }, { name: "Canada", price: "" }, { name: "UK", price: "18.5" }] });
  assert.deepEqual(m.shippingLocations.map((l) => [l.name, l.price]), [["Canada", undefined], ["UK", 18.5]]);
});

// ── Orders ──────────────────────────────────────────────────────────────────
console.log("\nmarkets — orders print and total in their own currency");

check("legacy orders (no currency) print in the store's symbol and are not foreign", () => {
  assert.equal(orderCurrencySymbol({}, "₱"), "₱");
  assert.equal(orderCurrencySymbol({ currency: "" }, "SAR"), "SAR");
  assert.equal(isForeignCurrencyOrder({}, "₱"), false);
});

check("a USD order prints $ and is kept out of peso totals; a PHP order isn't", () => {
  assert.equal(orderCurrencySymbol({ currency: "USD" }, "₱"), "$");
  assert.equal(isForeignCurrencyOrder({ currency: "USD" }, "₱"), true);
  assert.equal(orderCurrencySymbol({ currency: "PHP" }, "₱"), "₱");
  assert.equal(isForeignCurrencyOrder({ currency: "php" }, "₱"), false);
});

check("the checkout can name its market but never its currency", () => {
  const o = normalizeOrderInput({ id: "x", market: "international", currency: "JPY", items: [] });
  assert.equal(o.market, "international");
  assert.equal(o.currency, undefined, "currency is server-stamped only");
  assert.equal(normalizeOrderInput({ id: "x", market: "mars" }).market, undefined);
});

check("International checkout asks for a country, not a barangay", () => {
  const intl = checkoutFields({}, "international").map((f) => f.key);
  assert.ok(intl.includes("country"));
  assert.ok(!intl.includes("barangay"));
  const local = checkoutFields({}).map((f) => f.key);
  assert.ok(local.includes("barangay") && !local.includes("country"), "the local form is unchanged");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
