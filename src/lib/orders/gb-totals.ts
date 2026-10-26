// Re-totalling a group-buy order once some of its vials were cancelled (Ligwak).
//
//   items    = Σ successQty × price, less the promo PRORATED to what survived
//              (discount × successSubtotal / subtotal — the spec's
//              "× total_after_discount / subtotal")
//   fees     = shipping and admin fee — kept while ANY line survives, dropped
//              when nothing does. When vials were cancelled, a percentage admin
//              fee is re-charged on what survived (admin-fee.ts); a fixed one
//              stays as charged. The QR PH fee is ALWAYS kept exactly as
//              charged, even when everything is cancelled: QR PH doesn't return
//              it, so a refund covers items + shipping only (owner, 2026-10-27).
//              Nothing cancelled = every fee exactly as snapshotted.
//   newTotal = items + fees
//
// Money is worked in whole centavos and returned in major units, like every
// other total surface. With nothing cancelled, newTotal equals
// computeOrderTotals (test:gb-totals checks it).

import type { GbPaymentMode } from "@/lib/storefront/gb-kits";
import type { Order } from "@/storefront/types";

/** The order fields a total is made of. */
export type TotalsOrder = Pick<Order, "items" | "discount" | "adminFee" | "paymentFee"> & {
  shipping: Pick<Order["shipping"], "fee">;
};

/** Vials cancelled off one line, by line index (missing = none). */
export type LineOutcomes = Readonly<Record<number, { cancelledQty: number }>>;

export type GbRecalc = {
  subtotal: number;
  successSubtotal: number;
  /** The promo, prorated to what survived. */
  discount: number;
  shipping: number;
  adminFee: number;
  paymentFee: number;
  originalTotal: number;
  newTotal: number;
  /** Every line fully cancelled — the order itself is cancelled. */
  cancelledAll: boolean;
  amountPaid: number;
  amountDue: number;
  refundDue: number;
  /** What the store does next: collect the amount due, refund, or nothing. */
  nextAction: "collect" | "refund" | "none";
  mode: GbPaymentMode;
};

type Fees = { shipping: number; admin: number; payment: number };

const cents = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const major = (c: number): number => c / 100;

function lineCents(order: TotalsOrder, outcomes: LineOutcomes): { all: number; kept: number } {
  let all = 0;
  let kept = 0;
  (order.items ?? []).forEach((item, index) => {
    const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
    const cancelled = Math.min(qty, Math.max(0, Math.floor(Number(outcomes[index]?.cancelledQty) || 0)));
    const price = cents(item.price);
    all += price * qty;
    kept += price * (qty - cancelled);
  });
  return { all, kept };
}

/** The fees exactly as the order was charged. */
function snapshotFees(order: TotalsOrder): Fees {
  return {
    shipping: Math.max(0, cents(order.shipping?.fee)),
    admin: Math.max(0, cents(order.adminFee?.amount)),
    payment: Math.max(0, cents(order.paymentFee?.amount)),
  };
}

/** The fees after a cancellation: the admin fee re-charged on what survived
 *  when it's a percentage; shipping and the QR PH fee as charged. */
function rechargedFees(order: TotalsOrder, kept: number, adminFeePercent?: number): Fees {
  const charged = snapshotFees(order);
  const admin = adminFeePercent != null ? Math.round((kept * adminFeePercent) / 100) : charged.admin;
  return { shipping: charged.shipping, admin, payment: charged.payment };
}

/** Today's total, exactly as computeOrderTotals adds it up. */
function originalCents(order: TotalsOrder, subtotal: number): number {
  const fees = snapshotFees(order);
  return Math.max(0, subtotal - cents(order.discount?.amount) + fees.shipping + fees.admin + fees.payment);
}

/**
 * Re-total one order from its line outcomes. `amountPaid` is what the customer
 * has actually paid (pay_first: usually the original total; pay_later: 0 until
 * Payment time). `adminFeePercent` is set when the store's admin fee is a
 * percentage, so it is re-charged on what survived. Inputs are never mutated.
 */
export function recalculateOrder(
  order: TotalsOrder,
  outcomes: LineOutcomes,
  mode: GbPaymentMode,
  amountPaid: number,
  opts: { adminFeePercent?: number } = {},
): GbRecalc {
  const { all, kept } = lineCents(order, outcomes);
  const discountAll = Math.min(all, Math.max(0, cents(order.discount?.amount)));
  const discount = all > 0 ? Math.round((discountAll * kept) / all) : 0;
  const items = kept - discount;
  const fees: Fees =
    kept <= 0
      ? { shipping: 0, admin: 0, payment: snapshotFees(order).payment }
      : kept === all
        ? snapshotFees(order)
        : rechargedFees(order, kept, opts.adminFeePercent);
  const newTotal = Math.max(0, items + fees.shipping + fees.admin + fees.payment);
  const paid = Math.max(0, cents(amountPaid));
  const amountDue = Math.max(0, newTotal - paid);
  const refundDue = Math.min(paid, Math.max(0, paid - newTotal));
  return {
    subtotal: major(all),
    successSubtotal: major(kept),
    discount: major(discount),
    shipping: major(fees.shipping),
    adminFee: major(fees.admin),
    paymentFee: major(fees.payment),
    originalTotal: major(originalCents(order, all)),
    newTotal: major(newTotal),
    cancelledAll: all > 0 && kept <= 0,
    amountPaid: major(paid),
    amountDue: major(amountDue),
    refundDue: major(refundDue),
    nextAction: amountDue > 0 ? "collect" : refundDue > 0 ? "refund" : "none",
    mode,
  };
}
