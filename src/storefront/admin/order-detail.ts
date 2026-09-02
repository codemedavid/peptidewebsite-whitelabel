// Pure presentation helpers for the store-admin Order Detail screen
// (AdminOrderDetail.tsx). Extracted from the component so the layout can be
// re-skinned without changing what the screen computes — and so the math /
// formatting can be unit-tested without a React or DB runtime.
// See scripts/test-order-detail.ts (npm run test:order-detail).

import type { Order } from "../types";
import { formatMoney } from "@/lib/storefront/currency";

/** The store operates in the Philippines; order timestamps are stored as ISO
 *  UTC strings (orders.ts) but should read in the store's local time. */
const STORE_TIMEZONE = "Asia/Manila";

/**
 * Order money at full precision: "₱1,200.00", "SAR 1,200.00". Coerces
 * NaN/undefined to zero rather than printing "NaN" beside a customer's total.
 *
 * Takes the store's currency because an order detail is the tenant's OWN money
 * — this was `formatPHP` and hardcoded the peso, so a store trading in riyals
 * read every order it had ever taken in the wrong currency.
 */
export function formatOrderMoney(n: number, currency?: unknown): string {
  return formatMoney(n, currency);
}

/** Format an order's ISO timestamp for the "Placed …" header line, e.g.
 *  "Jun 28, 2026 · 10:42 AM", rendered in the store's timezone. Empty input
 *  returns ""; an unparseable string is returned verbatim. */
export function formatOrderDate(date: string): string {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `${day} · ${time}`;
}

/** Blank / whitespace / nullish → an em dash; otherwise the trimmed value.
 *  Used for optional address rows (barangay, region) so an empty cell still
 *  reads as intentionally empty rather than collapsing. */
export function orEmDash(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v === "" ? "—" : v;
}

/** One-line shipping address for pasting into a courier booking form. Skips
 *  blank parts and prefixes the barangay with "Brgy." when present. */
export function buildAddressLine(shipping: Order["shipping"] | undefined): string {
  if (!shipping) return "";
  return [
    shipping.address,
    shipping.barangay ? `Brgy. ${shipping.barangay}` : "",
    shipping.city,
    shipping.province,
    shipping.postal,
    shipping.country,
  ]
    .filter(Boolean)
    .join(", ");
}

/** "City, Province Postal" for the address table's combined row. Drops missing
 *  pieces without leaving stray separators. */
export function cityProvinceLine(shipping: Order["shipping"] | undefined): string {
  if (!shipping) return "";
  const cityProvince = [shipping.city, shipping.province].filter(Boolean).join(", ");
  return [cityProvince, shipping.postal].filter(Boolean).join(" ").trim();
}

/** A single copy-paste block with everything a courier booking needs, so the
 *  whole parcel can be booked with one copy → paste. */
export function buildBookingText(order: Order): string {
  return [
    `Name: ${order.customer?.name || ""}`,
    `Phone: ${order.customer?.phone || ""}`,
    `Address: ${buildAddressLine(order.shipping)}`,
    order.shipping?.region ? `Region: ${order.shipping.region}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export type OrderTotals = {
  subtotal: number;
  discount: number;
  shipping: number;
  fee: number;
  /** QR PH processing fee — 0 when the customer paid by any other method. */
  paymentFee: number;
  total: number;
};

/** Order money breakdown. Mirrors checkout: Total = items − discount + shipping
 *  + adminFee + paymentFee, floored at 0. */
export function computeOrderTotals(order: Order): OrderTotals {
  const subtotal = (order.items || []).reduce(
    (s, i) => s + (i.price || 0) * (i.qty || 1),
    0,
  );
  const shipping = order.shipping?.fee || 0;
  const fee = order.adminFee?.amount || 0;
  // QR PH processing fee — its own line, because an order can carry both it and
  // the admin fee and the customer was shown them separately.
  const paymentFee = order.paymentFee?.amount || 0;
  const discount = order.discount?.amount || 0;
  const total = Math.max(0, subtotal - discount + shipping + fee + paymentFee);
  return { subtotal, discount, shipping, fee, paymentFee, total };
}

/** True only when a real, non-blank payment-proof URL is present. Governs both
 *  the clickable thumbnail (vs the "no proof" empty state) and whether the
 *  full-screen viewer may open — so a whitespace-only string never renders a
 *  broken <img> or an empty lightbox. */
export function hasPaymentProof(proof: string | null | undefined): boolean {
  return (proof ?? "").trim() !== "";
}

/** Total units across all lines, for the "Order Items (N)" count pill. */
export function itemCount(order: Order): number {
  return (order.items || []).reduce((s, i) => s + (i.qty || 1), 0);
}
