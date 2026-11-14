import type { ShopFreeShippingProgress, ShopVoucherRung } from "@shop-contract";

/**
 * Copy for the cart's savings meter — the website cart's PromoMeter, word for
 * word. Pure: every number is the server quote's (ShopQuote.vouchers /
 * freeShipping); this only says it. `fmt` formats money in the store currency.
 */

type Fmt = (amount: number) => string;

export function freeShippingLine(p: ShopFreeShippingProgress, fmt: Fmt): string {
  return p.reached ? "You've got free shipping." : `Add ${fmt(p.remaining)} more for free shipping`;
}

/** The next locked rung — what the nudge talks about — or null. */
export function nextVoucherTarget(rungs: readonly ShopVoucherRung[]): ShopVoucherRung | null {
  return rungs.find((r) => r.state === "locked") ?? null;
}

export function voucherHeadline(rungs: readonly ShopVoucherRung[], fmt: Fmt): string {
  const next = nextVoucherTarget(rungs);
  if (next) return `Spend ${fmt(next.remaining)} more to get ${next.offLabel}`;
  const applied = rungs.find((r) => r.state === "applied");
  return applied ? `Best voucher applied: ${applied.offLabel}` : "Every voucher unlocked";
}

/** 0–1 progress toward the next locked rung, or null when there is none to show. */
export function voucherProgress(rungs: readonly ShopVoucherRung[]): number | null {
  const next = nextVoucherTarget(rungs);
  if (!next || next.minPurchase <= 0) return null;
  return Math.max(0, Math.min(1, (next.minPurchase - next.remaining) / next.minPurchase));
}

export function rungCaption(r: ShopVoucherRung, fmt: Fmt): string {
  if (r.state === "applied") return "Applied";
  if (r.state === "unlocked") return "Unlocked";
  return `${fmt(r.remaining)} to go`;
}

export function rungMinimum(r: ShopVoucherRung, fmt: Fmt): string {
  return r.minPurchase > 0 ? `min ${fmt(r.minPurchase)}` : "no minimum";
}

/**
 * The code to send with the order: the one the shopper typed, else the
 * voucher the quote applied automatically — so the order is charged exactly
 * the discount the shopper was shown. "" = no code.
 */
export function orderPromoCode(
  typed: string,
  quote: { autoApplied?: boolean; discount: { code: string } | null } | null | undefined,
): string {
  const t = typed.trim();
  if (t) return t;
  return quote?.autoApplied === true && quote.discount ? quote.discount.code : "";
}
