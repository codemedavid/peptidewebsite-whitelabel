// The International market's CHECKOUT settings, and the projection that turns
// a store's (peso) checkout config into its International (USD) view.
//
// Same idea as markets.ts does for products: rather than teach every fee,
// shipping and promo function about currencies, the checkout runs on a
// market-specific VIEW of the config, and the existing functions do the rest.
// For International that view has:
//
//   shippingLocations — the store's separate USD rate list (intlMarket)
//   paymentMethods    — only methods ticked "International" (never QR PH)
//   adminFee          — a fixed fee only when it has a USD amount; a
//                       percentage fee applies as-is (it scales with the total)
//   promoCodes        — percentage codes as-is (with their USD minimum);
//                       fixed codes only when they have a USD value
//   groupBuyBanner    — none: group buys are local only
//
// The Local view is the config untouched except for payment methods, which
// drop any method ticked International-only. A store that never touches these
// settings has every method local, so nothing changes for it.
//
// Pure + JSON-safe. The browser checkout and placeStorefrontOrderAction both
// build their view through applyMarketConfig, so the server never trusts the
// client's idea of which fees or methods apply.

import type { PaymentMethod, PromoCode, ShippingLocation } from "@/storefront/types";
import { INTL_CURRENCY, positivePrice, type Market } from "./markets";

/** Stored at branding.config.intlMarket. */
export type IntlMarketConfig = {
  /** The International shop + cart are on (only meaningful on the Intl &
   *  Local layout). Absent = on: picking the layout is opting in. */
  enabled: boolean;
  /** International shipping rates — same shape as the local list, amounts in USD. */
  shippingLocations: ShippingLocation[];
};

const MAX_LOCATIONS = 100;

function normalizeLocation(raw: unknown, i: number): ShippingLocation | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 80) : "";
  if (!name) return null;
  const price = Number(o.price);
  const hasPrice = o.price !== "" && o.price !== null && o.price !== undefined && Number.isFinite(price) && price >= 0;
  return {
    id: typeof o.id === "string" && o.id ? o.id.slice(0, 64) : `intl-${i + 1}`,
    courierId: typeof o.courierId === "string" ? o.courierId.slice(0, 64) : "",
    code: typeof o.code === "string" ? o.code.trim().slice(0, 16) : "",
    name,
    ...(hasPrice ? { price: Math.round(price * 100) / 100 } : {}),
    active: o.active !== false,
  };
}

export function normalizeIntlMarket(input: unknown): IntlMarketConfig {
  const o = (input ?? {}) as Record<string, unknown>;
  const list = Array.isArray(o.shippingLocations) ? o.shippingLocations : [];
  return {
    enabled: o.enabled !== false,
    shippingLocations: list
      .slice(0, MAX_LOCATIONS)
      .map(normalizeLocation)
      .filter((x): x is ShippingLocation => !!x),
  };
}

/** Is the store selling in two markets? Layout + switch, decided server-side. */
export function isDualMarket(config: { homeLayout?: unknown; intlMarket?: unknown }): boolean {
  return config.homeLayout === "intl-local" && normalizeIntlMarket(config.intlMarket).enabled;
}

// ── Payment methods ─────────────────────────────────────────────────────────

export type MethodMarkets = { local: boolean; international: boolean };

/** A method's market ticks. Absent on every existing method = Local only. */
export function methodMarkets(m: Pick<PaymentMethod, "markets">): MethodMarkets {
  const x = (m.markets ?? {}) as Partial<MethodMarkets>;
  return { local: x.local !== false, international: x.international === true };
}

/** Coerce a stored/edited ticks value (for the payment-methods save path).
 *  Persists only a non-default choice, so untouched methods stay untouched. */
export function normalizeMethodMarkets(input: unknown): MethodMarkets | undefined {
  if (!input || typeof input !== "object") return undefined;
  const m = methodMarkets({ markets: input as MethodMarkets });
  return m.local && !m.international ? undefined : m;
}

/** QR PH is a peso rail: it can never be an International method. */
export function methodSellsIn(m: PaymentMethod, market: Market): boolean {
  const ticks = methodMarkets(m);
  return market === "local" ? ticks.local : ticks.international && !m.qrph;
}

// ── Fees + promos ───────────────────────────────────────────────────────────

/** The admin fee as International charges it (see the header). */
export function intlAdminFee(fee: unknown): unknown {
  if (!fee || typeof fee !== "object") return fee;
  const f = fee as Record<string, unknown>;
  if (f.mode === "percentage") return { ...f, oncePerGroupBuy: false };
  const usd = positivePrice(f.usdAmount);
  return usd ? { ...f, amount: usd, oncePerGroupBuy: false } : { ...f, enabled: false };
}

/** The promo codes International honours, re-denominated in USD. */
export function intlPromoCodes(codes: PromoCode[]): PromoCode[] {
  return codes.flatMap((c) => {
    const min = positivePrice(c.usdMinPurchase) ?? 0;
    if (c.type === "percent") return [{ ...c, minPurchase: min }];
    const usd = positivePrice(c.usdValue);
    return usd ? [{ ...c, value: usd, minPurchase: min }] : [];
  });
}

// ── The projection ──────────────────────────────────────────────────────────

type CheckoutConfig = {
  currency?: unknown;
  shippingLocations?: unknown;
  paymentMethods?: unknown;
  adminFee?: unknown;
  promoCodes?: unknown;
  intlMarket?: unknown;
  groupBuyBanner?: unknown;
  gbPayLaterShippingFee?: unknown;
};

/**
 * The checkout config as `market` charges it. Works on the raw branding.config
 * (server) and on the Brand (browser) alike — both carry these keys. Returns a
 * new object; the input is never mutated.
 */
export function applyMarketConfig<T extends CheckoutConfig>(config: T, market: Market): T {
  const methods = Array.isArray(config.paymentMethods) ? (config.paymentMethods as PaymentMethod[]) : [];
  const paymentMethods = methods.filter((m) => methodSellsIn(m, market));
  if (market === "local") return { ...config, paymentMethods };
  const codes = Array.isArray(config.promoCodes) ? (config.promoCodes as PromoCode[]) : [];
  return {
    ...config,
    currency: INTL_CURRENCY.symbol,
    shippingLocations: normalizeIntlMarket(config.intlMarket).shippingLocations,
    paymentMethods,
    adminFee: intlAdminFee(config.adminFee),
    promoCodes: intlPromoCodes(codes),
    groupBuyBanner: null,
    gbPayLaterShippingFee: undefined,
  };
}
