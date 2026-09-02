// The QR PH payment processing fee.
//
// QR PH settles through the national QR standard, which charges the MERCHANT a
// percentage of what it collects. Every other method the storefront offers
// (GCash, Maya, a bank transfer) costs the store nothing, so the fee is not a
// property of checkout — it is a property of ONE payment method, and the store
// owner is the only one who knows which of their methods that is. They tag it
// (PaymentMethod.qrph) in the store admin, and that tag is the whole rule.
//
// Deliberately NOT name matching. A tenant may call the method "QR PH",
// "QRPh", "QR Ph Scan" or "Bank QR"; matching on the string would charge some
// stores and quietly skip others, and would start charging the day an owner
// renamed an unrelated method. The tag is explicit, survives renames, and shows
// the owner exactly which method is affected.
//
// The fee is DERIVED, never stored in component state: the checkout recomputes
// it from (selected method, current base) on each render, so switching methods
// back and forth cannot accumulate it and there is no stale value to clear.
// The server re-derives the same way at placement and snapshots the result onto
// the order, so a later config change never rewrites what an order was charged.

import type { PaymentMethod } from "@/storefront/types";

/** The rate QR PH charges the merchant. One place, so the label and the
 *  arithmetic can never disagree about what the customer was told. */
export const QRPH_FEE_PERCENT = 2;

/** The checkout line name. Carries the rate so a customer can check the math. */
export const QRPH_FEE_LABEL = `QR PH processing fee (${QRPH_FEE_PERCENT}%)`;

/** What an order actually charged (Order.paymentFee) — a snapshot at placement,
 *  the same shape as Order.adminFee. */
export type OrderPaymentFee = { label: string; amount: number };

/** The money the percentage is charged on. */
export type PaymentFeeBaseParts = {
  subtotal: number;
  discount?: number;
  shipping?: number;
  adminFee?: number;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Has the store owner tagged this method as QR PH? Absent/false on every
 *  method that predates the tag, so no existing store starts charging. */
export function isQrphMethod(method: unknown): boolean {
  return (method as { qrph?: unknown } | null)?.qrph === true;
}

/**
 * The amount the 2% is charged on: everything the store actually collects —
 * items, less any discount, plus shipping and the admin fee. QR PH takes its
 * cut of the whole transaction, not of the goods alone, which is why the
 * shipping and admin lines are in the base.
 *
 * Floored at zero so an over-large discount can never produce a negative base
 * (and therefore never a negative fee that would pay the customer).
 */
export function paymentFeeBase(parts: PaymentFeeBaseParts): number {
  const gross =
    num(parts.subtotal) - num(parts.discount) + num(parts.shipping) + num(parts.adminFee);
  return Math.max(0, gross);
}

/** Round to whole centavos. `base * percent / 100` in one step would leave
 *  float dust (2% of ₱1,123 → 22.459999999999997); rounding the numerator
 *  first is the same trick the admin fee's percentage mode uses. */
function toCentavos(base: number): number {
  return Math.round(base * QRPH_FEE_PERCENT) / 100;
}

/** The tenant's configured methods, defensively. */
function methodList(input: unknown): PaymentMethod[] {
  return Array.isArray(input) ? (input.filter((m) => m && typeof m === "object") as PaymentMethod[]) : [];
}

/** Normalize a method name for comparison. The ORDER stores the name the
 *  checkout displayed and the server re-derives the fee from it, so casing or
 *  padding drift must not silently drop a charge the customer was shown. */
function key(name: unknown): string {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

/**
 * The processing fee this order owes, or null when none applies — the single
 * rule the checkout, the order pipeline and the tests all read.
 *
 * Null (no fee, and no ₱0.00 line at checkout) when: the tenant isn't entitled,
 * no configured method matches the chosen name, the matched method carries no
 * QR PH tag, or the base is zero. Matching ignores `active` deliberately: if
 * the owner deactivates the method while a customer is checking out, the
 * customer was still SHOWN the fee, and re-deriving it keeps the charge equal
 * to the display.
 */
export function activePaymentFee(
  methods: unknown,
  methodName: string,
  base: number,
  entitled: boolean,
): OrderPaymentFee | null {
  if (!entitled) return null;
  const wanted = key(methodName);
  if (!wanted) return null;
  const method = methodList(methods).find((m) => key(m.name) === wanted);
  if (!method || !isQrphMethod(method)) return null;
  const amount = toCentavos(Math.max(0, num(base)));
  if (amount <= 0) return null;
  return { label: QRPH_FEE_LABEL, amount };
}

/**
 * Coerce a stored/untrusted fee blob into the order's fee, or undefined when
 * none was charged. Mirrors normalizeOrderFee for the admin fee: checkout never
 * trusts this — placeStorefrontOrderAction re-stamps it from config.
 */
export function normalizeOrderPaymentFee(input: unknown): OrderPaymentFee | undefined {
  if (!input || typeof input !== "object") return undefined;
  const x = input as Record<string, unknown>;
  const amount = Math.max(0, num(x.amount));
  if (amount <= 0) return undefined;
  const label = typeof x.label === "string" ? x.label.trim().slice(0, 80) : "";
  return { label: label || QRPH_FEE_LABEL, amount };
}

/** A centavo. Float arithmetic on either side can land a hair apart without
 *  anyone being overcharged, so comparisons carry this tolerance. */
const CENTAVO = 0.01;

/**
 * Would stamping `charged` bill the customer MORE than the checkout displayed?
 *
 * The server is authoritative and always stamps its own figure, so this is not
 * how the fee is decided — it is the one outcome we refuse to ship silently.
 * Charging the same or LESS than was shown is always allowed through (a price
 * drop mid-checkout is not a reason to reject an order), which is why this is
 * one-sided rather than an equality check: a two-sided check would reject
 * honest orders every time a product's price moved while someone shopped.
 *
 * A client that sent nothing at all (legacy, or a checkout from before the
 * feature) makes no claim about what it displayed, so it never rejects.
 */
export function paymentFeeOvercharges(shown: unknown, charged: number): boolean {
  if (shown == null) return false;
  const displayed =
    typeof shown === "object" ? num((shown as Record<string, unknown>).amount) : num(shown);
  return num(charged) - displayed > CENTAVO;
}
