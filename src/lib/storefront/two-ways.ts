// "Two ways to order" storefront core (kglow).
//
// The K Glow storefront presents two order paths side by side: ON-HAND (regular
// stocked items that ship now) and GROUP BUY (items sold under a live buying
// window at a lower gbPrice). Products carry the split intrinsically via
// `productType` ("gb" = group-buy listing, anything else = on-hand); the live
// Group Buy MODULE round supplies the window chrome (countdown, delivery ETA,
// slot-goal progress). This module is the pure, presentation-agnostic core that
// both the storefront layout and its tests share — no React, no DB, no alias
// imports, so it stays trivially testable (npm run test:two-ways).

/** The fields two-ways needs off a product. Generic so callers keep their own
 *  concrete product type through the split (e.g. the storefront's Product). */
export type TwoWaysInput = {
  price: number;
  gbPrice?: number;
  productType?: "gb" | "onhand";
};

/** A resolved group-buy catalog line: the product plus its regular vs GB price. */
export type GroupBuyLine<T extends TwoWaysInput = TwoWaysInput> = {
  product: T;
  /** The on-hand / list price (product.price). */
  regularPrice: number;
  /** The price actually charged in the group buy — equals regularPrice when no
   *  valid gbPrice is set, so a line never advertises a phantom saving. */
  gbPrice: number;
  /** regularPrice − gbPrice, never negative. */
  savings: number;
  hasSavings: boolean;
};

/** The two order paths, split from one catalog. */
export type TwoWaysCatalog<T extends TwoWaysInput = TwoWaysInput> = {
  onHand: T[];
  groupBuy: GroupBuyLine<T>[];
};

/** Is this a group-buy listing? `productType === "gb"` is the explicit tag;
 *  "onhand" and absent both read as on-hand (the historical default). */
export function isGroupBuyProduct(p: Pick<TwoWaysInput, "productType">): boolean {
  return p.productType === "gb";
}

/** Resolve a product's group-buy pricing. `gbPrice` applies only when it is a
 *  positive number strictly below the regular price; otherwise the regular price
 *  stands and the line shows no saving. Guards against a misconfigured GB price
 *  at or above list (which would otherwise render a negative "saving"). */
export function groupBuyLine<T extends TwoWaysInput>(product: T): GroupBuyLine<T> {
  const regularPrice = Math.max(0, product.price || 0);
  const candidate =
    typeof product.gbPrice === "number" && product.gbPrice > 0 ? product.gbPrice : regularPrice;
  const gbPrice = candidate > 0 && candidate < regularPrice ? candidate : regularPrice;
  const savings = Math.max(0, regularPrice - gbPrice);
  return { product, regularPrice, gbPrice, savings, hasSavings: savings > 0 };
}

/** Split a catalog into the on-hand and group-buy paths, preserving order within
 *  each. Pure — the input array and its elements are never mutated; on-hand
 *  products pass through by reference so the caller's concrete type is kept. */
export function splitTwoWays<T extends TwoWaysInput>(products: T[]): TwoWaysCatalog<T> {
  const onHand: T[] = [];
  const groupBuy: GroupBuyLine<T>[] = [];
  for (const p of products) {
    if (isGroupBuyProduct(p)) groupBuy.push(groupBuyLine(p));
    else onHand.push(p);
  }
  return { onHand, groupBuy };
}

/** The slot-goal progress bar for a live round ("18 of 30 slots filled · 60%").
 *  Disabled when the goal is off (unset / ≤ 0) — the owner can turn the progress
 *  bar off per round by clearing the goal. `filled` is clamped ≥ 0 and floored;
 *  `pct` is capped at 100 so an over-subscribed round never overflows the bar. */
export type SlotProgress = {
  enabled: boolean;
  goal: number;
  filled: number;
  pct: number; // 0..100 integer
  pctLabel: string; // "60%"
  pctWidth: string; // "60%" — clamped bar width
};

export function slotProgress(goal: number | null | undefined, filled: number): SlotProgress {
  const g = typeof goal === "number" && Number.isFinite(goal) ? Math.floor(goal) : 0;
  const f = Math.max(0, Math.floor(Number.isFinite(filled) ? filled : 0));
  if (g <= 0) {
    return { enabled: false, goal: 0, filled: f, pct: 0, pctLabel: "0%", pctWidth: "0%" };
  }
  const pct = Math.min(100, Math.round((f / g) * 100));
  return { enabled: true, goal: g, filled: f, pct, pctLabel: `${pct}%`, pctWidth: `${pct}%` };
}
