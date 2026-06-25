// Promo / discount codes — the shared, pure logic behind the store-admin's
// Promo Codes manager and the checkout "Discount code" field. Codes are created
// by the store owner (AdminPromoCodes) and persisted server-side in
// branding.config.promoCodes (same mechanism as couriers / categories), so every
// customer on every device sees the same set. Checkout applies a code optimistically
// and placeStorefrontOrderAction re-derives the discount from the SAME stored
// codes, so a tampered or stale client can never grant itself a bigger discount.
//
// This module is intentionally framework-free (no "use server", no DB) so both the
// client checkout and the server placement can import the exact same validity +
// amount math and never disagree on what a code is worth.

import type { PromoCode } from "@/storefront/types";

/** Coerce untrusted client/config input into clean PromoCode rows. */
export function normalizePromoCodes(input: unknown): PromoCode[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: PromoCode[] = [];
  for (const c of input.slice(0, 200)) {
    const o = (c ?? {}) as Record<string, unknown>;
    const id = String(o.id ?? "").slice(0, 64).trim();
    const code = String(o.code ?? "").slice(0, 64).trim().toUpperCase();
    if (!id || !code || seen.has(id)) continue;
    seen.add(id);
    const usageLimit =
      o.usageLimit === null || o.usageLimit === undefined || o.usageLimit === ""
        ? null
        : Math.max(0, Math.round(Number(o.usageLimit) || 0));
    out.push({
      id,
      code,
      type: o.type === "percent" ? "percent" : "fixed",
      value: Math.max(0, Number(o.value) || 0),
      minPurchase: Math.max(0, Number(o.minPurchase) || 0),
      usageLimit,
      used: Math.max(0, Math.round(Number(o.used) || 0)),
      expiry: typeof o.expiry === "string" && o.expiry ? o.expiry.slice(0, 40) : null,
      active: o.active !== false,
    });
  }
  return out;
}

/** Find a promo by its code (case-insensitive), or null. */
export function findPromoCode(codes: PromoCode[], code: string): PromoCode | null {
  const c = (code ?? "").trim().toUpperCase();
  if (!c) return null;
  return codes.find((p) => p.code.toUpperCase() === c) ?? null;
}

/** Whether the code's expiry date has passed. */
export function promoExpired(promo: PromoCode, now = new Date()): boolean {
  return !!promo.expiry && new Date(promo.expiry) < now;
}

/**
 * The discount this promo takes off a given items subtotal, in the store's
 * currency units — a percentage of, or a flat amount off, the subtotal. Rounded
 * to a whole unit and clamped to [0, subtotal] so a discount can never exceed the
 * cart or go negative.
 */
export function promoDiscountAmount(promo: PromoCode | null, subtotal: number): number {
  if (!promo) return 0;
  const raw = promo.type === "percent" ? (subtotal * promo.value) / 100 : promo.value;
  return Math.max(0, Math.min(subtotal, Math.round(raw)));
}

/**
 * Why a code can't be applied to `subtotal`, as a customer-facing message, or
 * null when it's valid. Shared by the checkout apply button and the server-side
 * stamp so both agree on validity. The `currency` symbol is only used to render
 * the min-purchase hint.
 */
export function promoCodeError(
  promo: PromoCode | null,
  subtotal: number,
  currency = "",
  now = new Date(),
): string | null {
  if (!promo) return "That code isn't valid.";
  if (!promo.active) return "That code is no longer active.";
  if (promoExpired(promo, now)) return "That code has expired.";
  if (promo.usageLimit !== null && promo.used >= promo.usageLimit) {
    return "That code has reached its usage limit.";
  }
  if (promo.minPurchase > 0 && subtotal < promo.minPurchase) {
    return `Spend at least ${currency}${promo.minPurchase.toLocaleString()} to use this code.`;
  }
  if (promoDiscountAmount(promo, subtotal) <= 0) return "That code isn't valid.";
  return null;
}

/** A short human label for an applied code, e.g. "Discount · SAVE100". */
export function promoLabel(code: string): string {
  return `Discount · ${code}`;
}
