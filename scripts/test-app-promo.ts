/**
 * The promo engine IN THE APP — the 11.11 toolkit (Sale Campaign countdown,
 * voucher ladder, free shipping over ₱X) as the Pepweb app's shop and store
 * admin see it. Runs the real modules, no DB / network:
 *
 *   • src/lib/mobile/shop-promo.ts           — catalog window + quote extras
 *   • mobile/src/features/shop/lib/campaign   — the phone's clock (parity with the web)
 *   • mobile/src/features/shop/lib/promo-meter + checkout — the cart copy + order code
 *   • mobile/src/features/admin/setup/promo-engine — the owner's editor
 *
 * plus structural guards that the app's quote, catalog, bridge and product
 * editor stay wired to the website's rules.
 *
 *   npm run test:app-promo
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  campaignCountdownParts,
  campaignPhase as webPhase,
  normalizeSaleCampaign,
  saleCampaignError,
} from "../src/lib/storefront/sale-campaign";
import { normalizeFreeShippingThreshold } from "../src/lib/storefront/free-shipping";
import { autoVoucherCode, shopPromoContext, shopQuotePromo, toShopSaleCampaign } from "../src/lib/mobile/shop-promo";
import { campaignBar, campaignPhase as appPhase, countdownText } from "../mobile/src/features/shop/lib/campaign";
import {
  freeShippingLine,
  orderPromoCode,
  rungCaption,
  voucherHeadline,
  voucherProgress,
} from "../mobile/src/features/shop/lib/promo-meter";
import { emptyForm, orderRequest, quoteRequest } from "../mobile/src/features/shop/lib/checkout";
import {
  campaignDraftError,
  campaignDraftFrom,
  campaignPayload,
  freeShippingDraftError,
  freeShippingDraftFrom,
  freeShippingPayload,
  fromLocalInput,
  savedCampaignStatus,
  toLocalInput,
} from "../mobile/src/features/admin/setup/promo-engine";
import type { ShopCheckoutConfig, ShopQuote } from "../src/lib/mobile/shop-contract";

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
const DURING = START + 2 * HOUR;
const BEFORE = START - 2 * HOUR;
const AFTER = END + HOUR;

const CAMPAIGN = normalizeSaleCampaign({
  enabled: true,
  name: "11.11 Mega Sale",
  startsAt: new Date(START).toISOString(),
  endsAt: new Date(END).toISOString(),
  teaser: true,
  teaserDays: 3,
  showBar: true,
});

const CODES = [
  { id: "a", code: "SAVE100", type: "fixed", value: 100, minPurchase: 1000, usageLimit: null, used: 0, expiry: null, active: true, showInCart: true },
  { id: "b", code: "SAVE300", type: "fixed", value: 300, minPurchase: 2500, usageLimit: null, used: 0, expiry: null, active: true, showInCart: true },
  { id: "c", code: "SALE500", type: "fixed", value: 500, minPurchase: 2500, usageLimit: null, used: 0, expiry: null, active: true, showInCart: true, campaignOnly: true },
  { id: "d", code: "SECRET", type: "percent", value: 50, minPurchase: 0, usageLimit: null, used: 0, expiry: null, active: true },
];

const CONFIG = {
  currency: "₱",
  promoCodes: CODES,
  saleCampaign: CAMPAIGN,
  freeShippingThreshold: { enabled: true, minSubtotal: 1500, campaignOnly: false },
};
const ALL = { ladder: true, freeShipping: true, campaign: true };

// ── catalog: the Sale Campaign window ─────────────────────────────────────────
section("catalog: Sale Campaign window");

check("the catalog carries the campaign only with the grant and a runnable campaign", () => {
  assert.deepEqual(toShopSaleCampaign(CAMPAIGN, true), {
    name: "11.11 Mega Sale",
    startsAt: CAMPAIGN.startsAt,
    endsAt: CAMPAIGN.endsAt,
    teaser: true,
    teaserDays: 3,
    showBar: true,
  });
  assert.equal(toShopSaleCampaign(CAMPAIGN, false), null, "no grant → no bar");
  assert.equal(toShopSaleCampaign({ ...CAMPAIGN, enabled: false }, true), null, "switched off → no bar");
  assert.equal(toShopSaleCampaign(normalizeSaleCampaign({ enabled: true, startsAt: "", endsAt: "" }), true), null);
  assert.equal(toShopSaleCampaign(null, true), null);
});

check("the phone's phase matches the website's at every boundary", () => {
  const shop = toShopSaleCampaign(CAMPAIGN, true)!;
  const noTeaser = { ...CAMPAIGN, teaser: false };
  const times = [START - 4 * DAY, START - 3 * DAY, START - 3 * DAY - 1, BEFORE, START - 1, START, DURING, END - 1, END, AFTER];
  for (const now of times) {
    assert.equal(appPhase(shop, now), webPhase(CAMPAIGN, true, now), `at ${new Date(now).toISOString()}`);
    assert.equal(appPhase({ ...shop, teaser: false }, now), webPhase(noTeaser, true, now), `no teaser at ${now}`);
  }
});

check("the countdown reads the same clock the website shows", () => {
  for (const [target, now] of [[START, BEFORE], [END, DURING], [START, START - 2 * DAY - 61_000], [END, END + 5]] as const) {
    const p = campaignCountdownParts(new Date(target).toISOString(), now);
    const pad = (n: number) => String(n).padStart(2, "0");
    const hms = `${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}`;
    assert.equal(countdownText(new Date(target).toISOString(), now), p.days > 0 ? `${p.days}d ${hms}` : hms);
  }
});

check("the bar: teaser counts to the start, live counts to the end, hidden otherwise", () => {
  const shop = toShopSaleCampaign(CAMPAIGN, true)!;
  assert.deepEqual(campaignBar(shop, BEFORE), { phase: "teaser", label: "starts in", clock: "02:00:00", target: shop.startsAt });
  assert.equal(campaignBar(shop, DURING)?.phase, "live");
  assert.equal(campaignBar(shop, DURING)?.target, shop.endsAt);
  assert.equal(campaignBar(shop, AFTER), null, "ended");
  assert.equal(campaignBar(shop, START - 4 * DAY), null, "before the teaser");
  assert.equal(campaignBar({ ...shop, showBar: false }, DURING), null, "owner hid the bar");
  assert.equal(campaignBar(null, DURING), null);
});

// ── quote: voucher ladder + free shipping ────────────────────────────────────
section("quote: voucher ladder + free shipping");

check("only the owner's 'Show in cart' codes reach the phone, and none without the grant", () => {
  const ctx = shopPromoContext(CONFIG, ALL);
  assert.deepEqual(ctx.ladderCodes.map((c) => c.code).sort(), ["SALE500", "SAVE100", "SAVE300"]);
  assert.equal(shopPromoContext(CONFIG, { ...ALL, ladder: false }).ladderCodes.length, 0);
  assert.equal(shopPromoContext({}, ALL).currency, "₱");
});

check("the best voucher is applied when nothing is typed; a typed code always wins", () => {
  const ctx = shopPromoContext(CONFIG, ALL);
  const outside = new Date(BEFORE);
  assert.equal(autoVoucherCode(ctx, 900, "", outside), null, "below every minimum");
  assert.equal(autoVoucherCode(ctx, 1200, "", outside), "SAVE100");
  assert.equal(autoVoucherCode(ctx, 3000, "", outside), "SAVE300", "campaign-only code stays shut outside the sale");
  assert.equal(autoVoucherCode(ctx, 3000, "", new Date(DURING)), "SALE500", "…and wins during it");
  assert.equal(autoVoucherCode(ctx, 3000, "SECRET", new Date(DURING)), null, "typed code wins");
  assert.equal(autoVoucherCode(shopPromoContext(CONFIG, { ...ALL, ladder: false }), 3000, ""), null, "no grant");
});

check("a campaign-only voucher fails closed without the campaign grant", () => {
  const ctx = shopPromoContext(CONFIG, { ...ALL, campaign: false });
  assert.equal(autoVoucherCode(ctx, 3000, "", new Date(DURING)), "SAVE300");
});

check("ladder rungs are the website's, lowest minimum first, with the applied one marked", () => {
  const ctx = shopPromoContext(CONFIG, ALL);
  const { vouchers } = shopQuotePromo(ctx, 1200, "SAVE100", new Date(BEFORE));
  assert.deepEqual(
    vouchers.map((r) => [r.code, r.state, r.remaining]),
    [["SAVE100", "applied", 0], ["SAVE300", "locked", 1300]],
    "SALE500 is off the ladder outside the sale",
  );
  const during = shopQuotePromo(ctx, 1200, "SAVE100", new Date(DURING)).vouchers.map((r) => r.code);
  assert.ok(during.includes("SALE500"), "on the ladder during the sale");
  assert.deepEqual(shopQuotePromo(shopPromoContext(CONFIG, { ...ALL, ladder: false }), 1200, null).vouchers, []);
});

check("free-shipping bar: progress, reached, and off without the grant or outside a sale-only rule", () => {
  const ctx = shopPromoContext(CONFIG, ALL);
  assert.deepEqual(shopQuotePromo(ctx, 900, null).freeShipping, { threshold: 1500, remaining: 600, reached: false, fraction: 0.6 });
  assert.equal(shopQuotePromo(ctx, 1500, null).freeShipping?.reached, true);
  assert.equal(shopQuotePromo(shopPromoContext(CONFIG, { ...ALL, freeShipping: false }), 900, null).freeShipping, null);
  const saleOnly = shopPromoContext({ ...CONFIG, freeShippingThreshold: { enabled: true, minSubtotal: 1500, campaignOnly: true } }, ALL);
  assert.equal(shopQuotePromo(saleOnly, 900, null, new Date(BEFORE)).freeShipping, null);
  assert.ok(shopQuotePromo(saleOnly, 900, null, new Date(DURING)).freeShipping);
});

// ── the cart's copy + the order it places ────────────────────────────────────
section("app cart: copy + placed code");

const fmt = (n: number) => `₱${n.toLocaleString()}`;

check("the meter says what the website cart says", () => {
  assert.equal(freeShippingLine({ threshold: 1500, remaining: 600, reached: false, fraction: 0.6 }, fmt), "Add ₱600 more for free shipping");
  assert.equal(freeShippingLine({ threshold: 1500, remaining: 0, reached: true, fraction: 1 }, fmt), "You've got free shipping.");
  const ctx = shopPromoContext(CONFIG, ALL);
  const { vouchers } = shopQuotePromo(ctx, 1200, "SAVE100", new Date(BEFORE));
  assert.equal(voucherHeadline(vouchers, fmt), "Spend ₱1,300 more to get ₱300 off");
  assert.equal(voucherProgress(vouchers), 1200 / 2500);
  assert.equal(rungCaption(vouchers[0], fmt), "Applied");
  assert.equal(rungCaption(vouchers[1], fmt), "₱1,300 to go");
  const top = shopQuotePromo(ctx, 3000, "SAVE300", new Date(BEFORE)).vouchers;
  assert.equal(voucherHeadline(top, fmt), "Best voucher applied: ₱300 off");
  assert.equal(voucherProgress(top), null);
});

const CHECKOUT: ShopCheckoutConfig = {
  paymentMethods: [],
  requireProofOfPayment: false,
  couriers: [],
  shippingLocations: [],
  note: "",
  title: "",
  customerNoteEnabled: false,
  customerNoteLabel: "",
};
const quote = (over: Partial<ShopQuote>): ShopQuote => ({
  items: [],
  subtotal: 1200,
  shippingFee: 0,
  courier: "",
  adminFee: null,
  paymentFee: null,
  discount: null,
  total: 1200,
  ...over,
});

check("the order carries the voucher the shopper was shown (typed, else automatic)", () => {
  const auto = quote({ autoApplied: true, discount: { code: "SAVE100", label: "Discount · SAVE100", amount: 100 } });
  assert.equal(orderPromoCode("", auto), "SAVE100");
  assert.equal(orderPromoCode(" MINE ", auto), "MINE", "typed wins");
  assert.equal(orderPromoCode("", quote({ discount: { code: "X", label: "", amount: 1 } })), "", "not auto → only what was typed");
  assert.equal(orderPromoCode("", null), "");
  const form = { ...emptyForm({ name: "A" }), address: "1 St", city: "Davao" };
  assert.equal(orderRequest("id", [], form, CHECKOUT, auto).promoCode, "SAVE100");
  assert.equal(orderRequest("id", [], form, CHECKOUT, quote({})).promoCode, undefined);
});

check("this build opts in to auto-applied vouchers on every quote", () => {
  assert.equal(quoteRequest([], null).autoVoucher, true);
  assert.equal(quoteRequest([], { promoCode: "MINE" }).autoVoucher, true);
});

// ── owner editor ─────────────────────────────────────────────────────────────
section("app admin: Sale Campaign + free shipping editor");

check("typed local times round-trip and junk is refused", () => {
  const iso = fromLocalInput("2026-11-11 00:00");
  assert.equal(iso, new Date(2026, 10, 11, 0, 0).toISOString());
  assert.equal(toLocalInput(iso), "2026-11-11 00:00");
  assert.equal(fromLocalInput(""), "");
  assert.equal(fromLocalInput("2026-02-31 10:00"), null, "no roll-over");
  assert.equal(fromLocalInput("11/11/2026"), null);
  assert.equal(fromLocalInput("2026-11-11 24:00"), null);
  assert.equal(toLocalInput(undefined), "");
});

check("the draft refuses exactly what the website's saleCampaignError refuses", () => {
  const good = { ...campaignDraftFrom(CAMPAIGN) };
  assert.equal(campaignDraftError(good), null);
  assert.equal(saleCampaignError(campaignPayload(good)), null);
  const backwards = { ...good, endsAt: "2026-11-10 00:00" };
  assert.equal(campaignDraftError(backwards), saleCampaignError(campaignPayload(backwards)));
  const blank = { ...good, endsAt: "" };
  assert.equal(campaignDraftError(blank), saleCampaignError(campaignPayload(blank)));
  assert.equal(campaignDraftError({ ...good, enabled: false, endsAt: "" }), null, "off can be saved half-set");
  assert.equal(campaignDraftError({ ...good, startsAt: "soon" }), "Check the start and end times.");
});

check("a saved campaign round-trips through the editor unchanged", () => {
  assert.deepEqual(normalizeSaleCampaign(campaignPayload(campaignDraftFrom(CAMPAIGN))), CAMPAIGN);
  assert.equal(savedCampaignStatus(CAMPAIGN, DURING), "Live now");
  assert.equal(savedCampaignStatus(CAMPAIGN, BEFORE), "Teaser showing");
  assert.equal(savedCampaignStatus(CAMPAIGN, AFTER), "Ended");
  assert.equal(savedCampaignStatus({ ...CAMPAIGN, enabled: false }, DURING), "Off");
});

check("free shipping: an 'on' rule needs a minimum, and the USD minimum survives an app save", () => {
  const saved = normalizeFreeShippingThreshold({ enabled: true, minSubtotal: 1500, usdMinSubtotal: 30, campaignOnly: true });
  const d = freeShippingDraftFrom(saved);
  assert.deepEqual(normalizeFreeShippingThreshold(freeShippingPayload(d)), saved);
  assert.equal(freeShippingDraftError({ ...d, minSubtotal: "" }), "Set the minimum order amount for free shipping.");
  assert.equal(freeShippingDraftError({ ...d, enabled: false, minSubtotal: "" }), null);
});

// ── wiring ───────────────────────────────────────────────────────────────────
section("wiring");

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

check("the app quote runs the promo engine and re-prices the auto voucher through the website", () => {
  const flow = read("src/lib/mobile/shop-flow.ts");
  assert.ok(flow.includes("withPromoEngine(store.tenantId, first.quote, typed, run, body.autoVoucher === true)"));
  assert.ok(flow.includes("const auto = autoVoucher ? autoVoucherCode("), "older app builds are never auto-discounted");
  assert.ok(flow.includes("FEATURES.STORE_VOUCHER_LADDER"));
  assert.ok(flow.includes("const again = await run(auto)"), "the discount comes from the website's own stampDiscount");
});

check("the app catalog ships the campaign window", () => {
  assert.ok(read("src/lib/mobile/shop-catalog.ts").includes("saleCampaign: toShopSaleCampaign(brand.saleCampaign, brand.saleCampaignEntitled === true)"));
});

check("the admin bridge allows the two promo-engine saves", () => {
  const bridge = read("src/lib/mobile/admin-bridge.ts");
  assert.ok(bridge.includes("saveSaleCampaignAction: promoEngine.saveSaleCampaignAction"));
  assert.ok(bridge.includes("saveFreeShippingThresholdAction: promoEngine.saveFreeShippingThresholdAction"));
});

check("app saves never drop the campaign-only / show-in-cart flags", () => {
  const form = read("mobile/src/features/admin/catalog/product-form.ts");
  assert.ok(form.includes("saleCampaignOnly: p?.saleCampaignOnly === true"));
  assert.ok(form.includes("saleCampaignOnly: d.saleCampaignOnly"));
  const promo = read("mobile/src/app/(app)/manage/promo.tsx");
  assert.ok(promo.includes("showInCart: (grants.ladder ? showInCart : start.showInCart) || undefined"));
  assert.ok(promo.includes("campaignOnly: (grants.campaign ? campaignOnly : start.campaignOnly) || undefined"));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
