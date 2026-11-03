// The two MARKETS a dual-currency storefront sells in — Local (the store's own
// currency, ₱ for this platform's stores) and International (USD) — and the one
// rule for which products each sells and at what price.
//
// Only stores on the Intl & Local layout with dual-currency switched on use it
// (brand.dualMarket, stamped server-side). Every other store never calls it and
// sells exactly as before.
//
// The design keeps the existing pricing code untouched: an international
// product is PROJECTED into a USD view — its `price`, sale price and variation
// prices replaced by their USD twins, peso-only pricing (group buy, reseller,
// wholesale MOQ) stripped — and that projected Product flows through the very
// same cart, sale, variation and checkout functions as a local one. The server
// applies the same projection before it re-prices an order, so the browser can
// never choose its own currency or price.
//
// Pure + JSON-safe (no React, no DB): shared by the storefront, the store admin
// and the order actions, and covered by test:markets.

import type { Product } from "@/storefront/types";
import { normalizeCurrency } from "./currency";

export const MARKETS = ["local", "international"] as const;
export type Market = (typeof MARKETS)[number];

/** Where a product is sold. Absent on every pre-existing product = "local". */
export const PRODUCT_MARKETS = ["local", "international", "both"] as const;
export type ProductMarket = (typeof PRODUCT_MARKETS)[number];

/** The international market's currency code and display symbol. */
export const INTL_CURRENCY = { code: "USD", symbol: "$" } as const;

export function isMarket(v: unknown): v is Market {
  return v === "local" || v === "international";
}

export function normalizeProductMarket(v: unknown): ProductMarket {
  return v === "international" || v === "both" ? v : "local";
}

/** A positive finite price, or undefined (absent / blank / 0 = not set). */
export function positivePrice(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
}

/** Does the product (or any of its options) have a USD price to sell at? */
export function hasUsdPrice(p: Pick<Product, "usdPrice" | "variations">): boolean {
  return (p.usdPrice ?? 0) > 0 || (p.variations ?? []).some((v) => (v.usdPrice ?? 0) > 0);
}

/**
 * Is this product sold in `market`? Local keeps every product that isn't
 * international-only. International needs the tag AND a USD price — a product
 * tagged International with no USD price is simply not listed, rather than
 * shown at a peso number with a dollar sign. Group-buy listings are local only.
 */
export function sellsIn(p: Product, market: Market): boolean {
  const tag = normalizeProductMarket(p.market);
  if (market === "local") return tag !== "international";
  return tag !== "local" && p.productType !== "gb" && hasUsdPrice(p);
}

/**
 * The product as `market` sells it. Local is the product itself (marked with
 * its selling market). International is the USD view described above. Never
 * mutates the input.
 */
export function toMarketProduct(p: Product, market: Market): Product {
  if (market === "local") return { ...p, sellMarket: "local" };
  const variations = (p.variations ?? []).flatMap((v) =>
    (v.usdPrice ?? 0) > 0 ? [{ ...v, price: v.usdPrice as number, gbPrice: undefined, salePrice: undefined }] : [],
  );
  // A product priced only per option leads with its cheapest option, which is
  // what the card's "from" price shows.
  const price = (p.usdPrice ?? 0) > 0 ? (p.usdPrice as number) : Math.min(...variations.map((v) => v.price));
  const sale = p.discountEnabled && (p.usdDiscountPrice ?? 0) > 0 && (p.usdDiscountPrice as number) < price;
  return {
    ...p,
    price,
    currency: INTL_CURRENCY.symbol,
    discountEnabled: !!sale,
    discountPrice: sale ? (p.usdDiscountPrice as number) : 0,
    variations,
    productType: "onhand",
    gbPrice: 0,
    reseller: undefined,
    wholesale: undefined,
    sellMarket: "international",
  };
}

/** The catalog one market lists: filtered, then projected. */
export function marketCatalog(products: Product[], market: Market): Product[] {
  return products.filter((p) => sellsIn(p, market)).map((p) => toMarketProduct(p, market));
}

/** Which market a cart entry belongs to. Anything unmarked is local. */
export function cartMarketOf(p: Pick<Product, "sellMarket">): Market {
  return p.sellMarket === "international" ? "international" : "local";
}

/** The currency symbol a market prices in. */
export function marketCurrencySymbol(market: Market, storeSymbol: string): string {
  return market === "international" ? INTL_CURRENCY.symbol : storeSymbol;
}

/** The currency code an order in `market` is recorded in. Local keeps the
 *  store's own code, so a SAR store's local orders stay SAR. */
export function marketCurrencyCode(market: Market, storeCode: string): string {
  return market === "international" ? INTL_CURRENCY.code : storeCode;
}

// ── Orders ──────────────────────────────────────────────────────────────────

/**
 * The symbol to print an ORDER's money in. Orders from dual-currency stores
 * carry the currency they were charged in; every other order (and every order
 * before dual markets) has none and prints in the store's own symbol.
 */
export function orderCurrencySymbol(order: { currency?: string }, storeSymbol: string | undefined): string {
  const code = (order.currency ?? "").trim();
  const store = normalizeCurrency(storeSymbol);
  if (!code || code.toUpperCase() === store.code) return storeSymbol || store.symbol;
  return normalizeCurrency(code).symbol;
}

/**
 * Was this order charged in a currency OTHER than the store's own? Such orders
 * must never be summed into the store's revenue figures — ₱1,000 + $30 is not
 * a number — so totals skip them and report them on their own line.
 */
export function isForeignCurrencyOrder(order: { currency?: string }, storeSymbol: string | undefined): boolean {
  const code = (order.currency ?? "").trim().toUpperCase();
  return !!code && code !== normalizeCurrency(storeSymbol).code;
}
