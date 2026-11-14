/**
 * Tests for the promo engine — the 11.11 toolkit:
 *   • lib/storefront/sale-campaign.ts   (one window that switches sales on/off)
 *   • lib/storefront/voucher-ladder.ts  (cart spend targets + auto-apply)
 *   • lib/storefront/free-shipping.ts   (free shipping over a minimum)
 * plus how they reach the charge: the sale rule (sale.ts → checkout.unitPrice),
 * promo validity (promo.ts → promoCodeError), and structural guards that the
 * storefront render, the price refresh and order placement all apply the same
 * stamps and checks.
 *
 * The invariant, as everywhere in pricing: THE PRICE ON SCREEN IS THE PRICE THE
 * ORDER IS CHARGED, and every campaign-only piece fails CLOSED — no grant, no
 * campaign or a clock outside the window means list price, no code, normal
 * shipping.
 *
 *   npm run test:mega-sale
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  campaignPhase,
  campaignSaleOpen,
  campaignWindow,
  isWindowLive,
  normalizeSaleCampaign,
  saleCampaignError,
  stampCampaignWindow,
  type CampaignWindow,
} from "../src/lib/storefront/sale-campaign";
import {
  freeShippingProgress,
  intlFreeShippingThreshold,
  normalizeFreeShippingThreshold,
  qualifiesForFreeShipping,
} from "../src/lib/storefront/free-shipping";
import { bestAutoVoucher, buildVoucherLadder, nextVoucherTarget } from "../src/lib/storefront/voucher-ladder";
import { normalizePromoCodes, promoCodeError } from "../src/lib/storefront/promo";
import { resolveSaleView } from "../src/lib/storefront/sale";
import { makeVariationEntry, unitPrice } from "../src/storefront/checkout";
import type { Product, PromoCode } from "../src/storefront/types";

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
const section = (t: string) => console.log(`\n${t}`);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Date.parse("2026-11-11T00:00:00+08:00");
const END = Date.parse("2026-11-12T00:00:00+08:00");
const WINDOW: CampaignWindow = { startsAt: new Date(START).toISOString(), endsAt: new Date(END).toISOString() };
const DURING = START + 2 * HOUR;
const BEFORE = START - 2 * HOUR;
const AFTER = END + HOUR;

const CAMPAIGN_ON = normalizeSaleCampaign({
  enabled: true,
  name: "11.11 Mega Sale",
  startsAt: WINDOW.startsAt,
  endsAt: WINDOW.endsAt,
  teaser: true,
  teaserDays: 2,
});

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Tirzepatide 10mg",
    price: 2000,
    currency: "₱",
    discountEnabled: true,
    discountPrice: 1500,
    ...over,
  } as Product;
}

/** Run `fn` with Date.now() pinned to `when` (the sale rule reads the clock). */
function at<T>(when: number, fn: () => T): T {
  const real = Date.now;
  Date.now = () => when;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

function code(over: Partial<PromoCode>): PromoCode {
  return normalizePromoCodes([
    { id: over.code ?? "c", code: "C", type: "fixed", value: 100, minPurchase: 0, usageLimit: null, used: 0, expiry: null, active: true, ...over },
  ])[0];
}

// ─────────────────────────────── sale campaign ──────────────────────────────
section("Sale campaign — config + window");

check("an 'on' campaign with missing or backwards dates is saved OFF", () => {
  assert.equal(normalizeSaleCampaign({ enabled: true, startsAt: WINDOW.startsAt }).enabled, false);
  assert.equal(
    normalizeSaleCampaign({ enabled: true, startsAt: WINDOW.endsAt, endsAt: WINDOW.startsAt }).enabled,
    false,
  );
  assert.ok(saleCampaignError({ enabled: true, startsAt: WINDOW.endsAt, endsAt: WINDOW.startsAt }));
  assert.equal(saleCampaignError({ enabled: false }), null);
});

check("name defaults, teaser days clamp to 1–30", () => {
  const c = normalizeSaleCampaign({ enabled: true, name: "   ", ...WINDOW, teaserDays: 999 });
  assert.equal(c.name, "Mega Sale");
  assert.equal(c.teaserDays, 30);
  assert.equal(normalizeSaleCampaign({ teaserDays: -3 }).teaserDays, 3);
});

check("no window without the grant, or with the campaign off", () => {
  assert.equal(campaignWindow(CAMPAIGN_ON, false), null);
  assert.equal(campaignWindow({ ...CAMPAIGN_ON, enabled: false }, true), null);
  assert.deepEqual(campaignWindow(CAMPAIGN_ON, true), WINDOW);
});

check("window is start-inclusive, end-exclusive", () => {
  assert.equal(isWindowLive(WINDOW, START), true);
  assert.equal(isWindowLive(WINDOW, END), false);
  assert.equal(isWindowLive(null, DURING), false);
});

check("phase walks off → teaser → live → ended", () => {
  assert.equal(campaignPhase(CAMPAIGN_ON, true, START - 3 * DAY), "off");
  assert.equal(campaignPhase(CAMPAIGN_ON, true, START - DAY), "teaser");
  assert.equal(campaignPhase(CAMPAIGN_ON, true, DURING), "live");
  assert.equal(campaignPhase(CAMPAIGN_ON, true, AFTER), "ended");
  assert.equal(campaignPhase({ ...CAMPAIGN_ON, teaser: false }, true, START - DAY), "off");
  assert.equal(campaignPhase(CAMPAIGN_ON, false, DURING), "off");
});

section("Sale campaign — the stamp");

check("only campaign-only products get the window; stale stamps are cleared", () => {
  const stale = { ...product({ id: "x" }), campaignWindow: WINDOW };
  const out = stampCampaignWindow([product({ saleCampaignOnly: true }), stale], WINDOW);
  assert.deepEqual(out[0].campaignWindow, WINDOW);
  assert.equal(out[1].campaignWindow, undefined);
  assert.deepEqual(stale.campaignWindow, WINDOW, "the input was mutated");
});

check("a null window strips every stamp (no grant → nothing can be live)", () => {
  const out = stampCampaignWindow([{ ...product({ saleCampaignOnly: true }), campaignWindow: WINDOW }], null);
  assert.equal(out[0].campaignWindow, undefined);
  assert.equal(campaignSaleOpen(out[0], DURING), false);
});

section("Sale campaign — what the cart charges");

const [stamped] = stampCampaignWindow([product({ saleCampaignOnly: true })], WINDOW);

check("campaign-only sale charges the markdown DURING the window", () => {
  assert.equal(at(DURING, () => unitPrice(stamped)), 1500);
});

check("…and the list price before and after it", () => {
  assert.equal(at(BEFORE, () => unitPrice(stamped)), 2000);
  assert.equal(at(AFTER, () => unitPrice(stamped)), 2000);
});

check("unstamped (no grant / no campaign) → list price, fail closed", () => {
  assert.equal(at(DURING, () => unitPrice(product({ saleCampaignOnly: true }))), 2000);
});

check("an ordinary sale is untouched by the campaign", () => {
  assert.equal(at(AFTER, () => unitPrice(product())), 1500);
});

check("the card advertises exactly what the cart charges", () => {
  for (const when of [BEFORE, DURING, AFTER]) {
    const view = at(when, () => resolveSaleView(stamped, 0));
    assert.equal(view.price, at(when, () => unitPrice(stamped)), `mismatch at ${new Date(when).toISOString()}`);
  }
});

check("a variation's own sale price is gated by the same window", () => {
  const withOptions = {
    ...stamped,
    variations: [{ name: "10mg", price: 2000, salePrice: 1600 }],
  } as Product;
  const clone = makeVariationEntry(withOptions, withOptions.variations![0]);
  assert.equal(at(DURING, () => unitPrice(clone)), 1600);
  assert.equal(at(AFTER, () => unitPrice(clone)), 2000);
  assert.equal(at(AFTER, () => resolveSaleView(withOptions, 0).price), 2000);
  assert.equal(at(DURING, () => resolveSaleView(withOptions, 0).price), 1600);
});

// ─────────────────────────────── promo codes ────────────────────────────────
section("Promo codes — new flags");

check("showInCart / campaignOnly survive normalize; absent stays absent", () => {
  const [a, b] = normalizePromoCodes([
    { id: "a", code: "a", value: 1, showInCart: true, campaignOnly: true },
    { id: "b", code: "b", value: 1 },
  ]);
  assert.equal(a.showInCart, true);
  assert.equal(a.campaignOnly, true);
  assert.equal("showInCart" in b, false);
  assert.equal("campaignOnly" in b, false);
});

check("a campaign-only code works only inside the window", () => {
  const c = code({ code: "MEGA", campaignOnly: true });
  assert.equal(promoCodeError(c, 1000, "₱", new Date(DURING), WINDOW), null);
  assert.ok(promoCodeError(c, 1000, "₱", new Date(AFTER), WINDOW));
  assert.ok(promoCodeError(c, 1000, "₱", new Date(DURING), null), "no window must never unlock it");
});

// ─────────────────────────────── voucher ladder ─────────────────────────────
section("Voucher ladder");

const LADDER: PromoCode[] = [
  code({ id: "l3", code: "SAVE600", value: 600, minPurchase: 5000, showInCart: true }),
  code({ id: "l1", code: "SAVE100", value: 100, minPurchase: 1500, showInCart: true }),
  code({ id: "l2", code: "SAVE300", value: 300, minPurchase: 3000, showInCart: true }),
  code({ id: "hidden", code: "SECRET", value: 999, minPurchase: 0 }),
  code({ id: "off", code: "OFF", value: 50, active: false, showInCart: true }),
  code({ id: "sale", code: "SALE10", type: "percent", value: 10, minPurchase: 0, showInCart: true, campaignOnly: true }),
];
const opts = (now: number, window: CampaignWindow | null = WINDOW) => ({
  currency: "₱",
  campaignWindow: window,
  now: new Date(now),
});

check("rungs are lowest minimum first; hidden, inactive and out-of-sale codes stay off", () => {
  const rungs = buildVoucherLadder(LADDER, 1000, opts(AFTER));
  assert.deepEqual(rungs.map((r) => r.code), ["SAVE100", "SAVE300", "SAVE600"]);
});

check("states + 'to go' amounts", () => {
  const rungs = buildVoucherLadder(LADDER, 3200, { ...opts(AFTER), appliedCode: "SAVE300" });
  assert.deepEqual(rungs.map((r) => r.state), ["unlocked", "applied", "locked"]);
  assert.equal(rungs[2].remaining, 1800);
  assert.equal(nextVoucherTarget(rungs)?.code, "SAVE600");
});

check("auto-apply picks the biggest discount the cart reaches", () => {
  assert.equal(bestAutoVoucher(LADDER, 3200, opts(AFTER))?.code, "SAVE300");
  assert.equal(bestAutoVoucher(LADDER, 999, opts(AFTER)), null);
});

check("during the sale a campaign-only code joins (and can win)", () => {
  assert.equal(bestAutoVoucher(LADDER, 1200, opts(DURING))?.code, "SALE10");
  assert.ok(buildVoucherLadder(LADDER, 1200, opts(DURING)).some((r) => r.code === "SALE10"));
});

check("an auto-applied code is one the server accepts (same validity rule)", () => {
  const best = bestAutoVoucher(LADDER, 5200, opts(AFTER))!;
  assert.equal(promoCodeError(best, 5200, "", new Date(AFTER), WINDOW), null);
});

// ─────────────────────────────── free shipping ──────────────────────────────
section("Free shipping over a minimum");

const on = { entitled: true, campaignWindow: WINDOW };

check("an 'on' rule with no minimum is saved OFF", () => {
  assert.equal(normalizeFreeShippingThreshold({ enabled: true, minSubtotal: 0 }).enabled, false);
});

check("qualifies at the minimum, not below; never without the grant", () => {
  const t = normalizeFreeShippingThreshold({ enabled: true, minSubtotal: 1500 });
  assert.equal(qualifiesForFreeShipping(t, 1500, on), true);
  assert.equal(qualifiesForFreeShipping(t, 1499, on), false);
  assert.equal(qualifiesForFreeShipping(t, 5000, { ...on, entitled: false }), false);
});

check("campaign-only rule follows the window", () => {
  const t = normalizeFreeShippingThreshold({ enabled: true, minSubtotal: 1500, campaignOnly: true });
  assert.equal(qualifiesForFreeShipping(t, 2000, { ...on, now: DURING }), true);
  assert.equal(qualifiesForFreeShipping(t, 2000, { ...on, now: AFTER }), false);
  assert.equal(qualifiesForFreeShipping(t, 2000, { entitled: true, campaignWindow: null, now: DURING }), false);
});

check("progress bar numbers", () => {
  const t = normalizeFreeShippingThreshold({ enabled: true, minSubtotal: 2000 });
  const p = freeShippingProgress(t, 1500, on)!;
  assert.equal(p.remaining, 500);
  assert.equal(p.fraction, 0.75);
  assert.equal(freeShippingProgress(t, 2500, on)!.reached, true);
  assert.equal(freeShippingProgress(t, 1500, { ...on, entitled: false }), null);
});

check("International uses the USD minimum, or is off without one", () => {
  assert.equal(intlFreeShippingThreshold({ enabled: true, minSubtotal: 1500 }).enabled, false);
  const t = intlFreeShippingThreshold({ enabled: true, minSubtotal: 1500, usdMinSubtotal: 40 });
  assert.equal(t.enabled, true);
  assert.equal(t.minSubtotal, 40);
});

// ─────────────────────────────── structural guards ──────────────────────────
section("Every pricing surface applies the same rules");

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const orders = read("src/actions/orders.ts");
const brandLoader = read("src/lib/storefront/storefront-brand.ts");
const refresh = read("src/actions/products.ts");
const productInput = read("src/lib/storefront/product-input.ts");
const cart = read("src/storefront/components/CartCheckout.tsx");
const intl = read("src/lib/storefront/intl-market.ts");

check("placement stamps the catalog (live + demo) with the campaign window", () => {
  assert.ok((orders.match(/stampCampaignWindow\(/g) ?? []).length >= 2);
  assert.ok((orders.match(/resolvePromoEngine\(/g) ?? []).length >= 2);
});

check("placement waives shipping by the threshold and gates codes by the window", () => {
  assert.ok(orders.includes("qualifiesForFreeShipping(promo.freeShipping, itemsSubtotal(p.items)"));
  assert.ok(orders.includes("promoCodeError(promo, subtotal, \"\", new Date(), campaignWindow)"));
  assert.ok(!/stampDiscount\(config, p\)/.test(orders), "a stampDiscount call skips the campaign window");
  assert.ok(!/stampShipping\(config, p, [a-zA-Z]+\)/.test(orders), "a stampShipping call skips the free-shipping rule");
});

check("the render and the public price refresh stamp the same window", () => {
  assert.ok(brandLoader.includes("stampCampaignWindow(products"));
  assert.ok((refresh.match(/stampCampaignWindow\(/g) ?? []).length >= 2);
});

check("admin saves round-trip saleCampaignOnly and never persist the transient stamp", () => {
  assert.ok(productInput.includes("saleCampaignOnly: o.saleCampaignOnly === true"));
  assert.ok(!/campaignWindow:/.test(productInput));
});

check("the cart orders the code it displays (typed or automatic)", () => {
  assert.ok(cart.includes("const activePromo = appliedPromo ?? autoPromo"));
  assert.ok(cart.includes("code: activePromo.code"));
  assert.ok(!/discountAmount\s*=\s*useMemo\(\s*\(\)\s*=>\s*promoDiscountAmount\(appliedPromo/.test(cart));
});

check("the International market view projects the free-shipping rule", () => {
  assert.ok(intl.includes("freeShippingThreshold: intlFreeShippingThreshold(config.freeShippingThreshold)"));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
