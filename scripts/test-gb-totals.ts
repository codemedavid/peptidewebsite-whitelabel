/**
 * Re-totalling an order after Ligwak (src/lib/orders/gb-totals.ts).
 *
 *   npm run test:gb-totals
 *
 * items    = Σ successQty × price, less the promo PRORATED to what survived
 * fees     = shipping + admin fee, kept only while a line survives; the QR PH
 *            fee is ALWAYS kept as charged (QR PH doesn't return it — owner,
 *            2026-10-27), so a refund covers items + shipping only
 * newTotal = items + fees
 * pay_later → amountDue; pay_first → refundDue, never more than was paid.
 * With nothing cancelled the new total must equal today's computeOrderTotals.
 */
import assert from "node:assert";

import { recalculateOrder, type TotalsOrder } from "../src/lib/orders/gb-totals";
import { computeOrderTotals } from "../src/storefront/admin/order-detail";
import type { Order } from "../src/storefront/types";

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

function base(extra: Partial<TotalsOrder> = {}): TotalsOrder {
  return {
    items: [
      { name: "Tirz — 15mg", qty: 5, price: 100, productId: "tirz", variation: "15mg" },
      { name: "Bac", qty: 2, price: 50, productId: "bac" },
    ],
    shipping: { fee: 150 },
    ...extra,
  };
}

console.log("\nnothing cancelled\n");

check("new total equals today's computeOrderTotals, for every fee combination", () => {
  const variants: TotalsOrder[] = [
    base(),
    base({ discount: { code: "X", label: "X", amount: 60 } }),
    base({ adminFee: { label: "Admin", amount: 25 } }),
    base({ paymentFee: { label: "QR PH (2%)", amount: 13.3 } }),
    base({ discount: { code: "X", label: "X", amount: 60 }, adminFee: { label: "A", amount: 25 }, paymentFee: { label: "Q", amount: 12.3 } }),
  ];
  for (const o of variants) {
    const r = recalculateOrder(o, {}, "pay_later", 0);
    const today = computeOrderTotals(o as unknown as Order).total;
    assert.equal(r.originalTotal, today, JSON.stringify(o));
    assert.equal(r.newTotal, today, JSON.stringify(o));
    assert.equal(r.cancelledAll, false);
  }
});

console.log("\npartial and full cancellation\n");

check("3 of 5 vials ligwak'd → only the 2 kept are charged, shipping stays", () => {
  const r = recalculateOrder(base(), { 0: { cancelledQty: 3 } }, "pay_later", 0);
  assert.deepEqual([r.successSubtotal, r.shipping, r.newTotal, r.originalTotal], [300, 150, 450, 750]);
  assert.equal(r.amountDue, 450);
  assert.equal(r.refundDue, 0);
  assert.equal(r.nextAction, "collect");
});
check("every line cancelled → nothing to pay, shipping + admin fee dropped, order cancelled", () => {
  const o = base({ adminFee: { label: "A", amount: 25 } });
  const r = recalculateOrder(o, { 0: { cancelledQty: 5 }, 1: { cancelledQty: 2 } }, "pay_later", 0);
  assert.deepEqual([r.newTotal, r.shipping, r.adminFee, r.paymentFee, r.amountDue], [0, 0, 0, 0, 0]);
  assert.equal(r.cancelledAll, true);
  assert.equal(r.nextAction, "none");
});
check("every line cancelled on a QR PH order → the fee stays, the rest is refunded", () => {
  const o = base({ adminFee: { label: "A", amount: 25 }, paymentFee: { label: "Q", amount: 10 } });
  const r = recalculateOrder(o, { 0: { cancelledQty: 5 }, 1: { cancelledQty: 2 } }, "pay_first", 785);
  assert.deepEqual([r.newTotal, r.shipping, r.adminFee, r.paymentFee], [10, 0, 0, 10]);
  assert.deepEqual([r.refundDue, r.cancelledAll, r.nextAction], [775, true, "refund"]);
});
check("a cancelledQty above the line's qty is clamped", () => {
  const r = recalculateOrder(base(), { 0: { cancelledQty: 99 } }, "pay_later", 0);
  assert.equal(r.successSubtotal, 100);
});
check("outcomes for lines that don't exist are ignored", () => {
  const r = recalculateOrder(base(), { 7: { cancelledQty: 1 } }, "pay_later", 0);
  assert.equal(r.newTotal, r.originalTotal);
});

console.log("\npromo proration\n");

check("the discount shrinks in proportion to what survived", () => {
  const o: TotalsOrder = {
    items: [{ name: "T", qty: 10, price: 100 }],
    shipping: { fee: 0 },
    discount: { code: "X", label: "X", amount: 100 },
  };
  const r = recalculateOrder(o, { 0: { cancelledQty: 5 } }, "pay_later", 0);
  assert.deepEqual([r.successSubtotal, r.discount, r.newTotal], [500, 50, 450]);
});
check("proration rounds to whole centavos", () => {
  const o: TotalsOrder = {
    items: [{ name: "T", qty: 3, price: 333.33 }],
    shipping: { fee: 0 },
    discount: { code: "X", label: "X", amount: 100 },
  };
  const r = recalculateOrder(o, { 0: { cancelledQty: 1 } }, "pay_later", 0);
  assert.deepEqual([r.successSubtotal, r.discount, r.newTotal], [666.66, 66.67, 599.99]);
});
check("a 100%-off order that still has lines keeps its shipping", () => {
  const o: TotalsOrder = {
    items: [{ name: "T", qty: 4, price: 100 }],
    shipping: { fee: 150 },
    discount: { code: "FREE", label: "FREE", amount: 400 },
  };
  const r = recalculateOrder(o, { 0: { cancelledQty: 2 } }, "pay_later", 0);
  assert.deepEqual([r.discount, r.shipping, r.newTotal], [200, 150, 150]);
});
check("a discount larger than the subtotal never goes negative", () => {
  const o: TotalsOrder = { items: [{ name: "T", qty: 1, price: 100 }], shipping: { fee: 0 }, discount: { code: "X", label: "X", amount: 500 } };
  assert.equal(recalculateOrder(o, {}, "pay_later", 0).newTotal, 0);
});

console.log("\nfees\n");

check("a fixed admin fee is kept as charged while a line survives", () => {
  const r = recalculateOrder(base({ adminFee: { label: "A", amount: 25 } }), { 0: { cancelledQty: 3 } }, "pay_later", 0);
  assert.equal(r.adminFee, 25);
});
check("a percentage admin fee is re-charged on what survived", () => {
  const r = recalculateOrder(base({ adminFee: { label: "A", amount: 37.5 } }), { 0: { cancelledQty: 3 } }, "pay_later", 0, {
    adminFeePercent: 5,
  });
  assert.equal(r.adminFee, 15);
});
check("the QR PH fee is kept as charged — the refund covers items + shipping only", () => {
  const o = base({ paymentFee: { label: "QR PH (2%)", amount: 18 } });
  const r = recalculateOrder(o, { 0: { cancelledQty: 3 } }, "pay_first", 918);
  // 300 items + 150 shipping + the 18.00 fee as charged; refund = the 3 vials
  assert.deepEqual([r.paymentFee, r.newTotal, r.refundDue], [18, 468, 450]);
});
check("no QR PH fee on the order → none is added", () => {
  assert.equal(recalculateOrder(base(), { 0: { cancelledQty: 3 } }, "pay_first", 750).paymentFee, 0);
});

console.log("\npaid vs due\n");

check("pay_first: refund due = paid − new total", () => {
  const r = recalculateOrder(base(), { 0: { cancelledQty: 3 } }, "pay_first", 750);
  assert.deepEqual([r.refundDue, r.amountDue, r.nextAction], [300, 0, "refund"]);
});
check("pay_first: the refund never exceeds what was paid", () => {
  const r = recalculateOrder(base(), { 0: { cancelledQty: 5 }, 1: { cancelledQty: 2 } }, "pay_first", 100);
  assert.equal(r.refundDue, 100);
});
check("pay_first: an order the store grew past what was paid has an amount due", () => {
  const r = recalculateOrder(base(), {}, "pay_first", 500);
  assert.deepEqual([r.amountDue, r.refundDue, r.nextAction], [250, 0, "collect"]);
});
check("pay_later: a partly paid order owes the rest", () => {
  const r = recalculateOrder(base(), {}, "pay_later", 200);
  assert.equal(r.amountDue, 550);
});
check("junk amounts paid read as zero", () => {
  assert.equal(recalculateOrder(base(), {}, "pay_later", Number.NaN).amountDue, 750);
  assert.equal(recalculateOrder(base(), {}, "pay_later", -5).amountDue, 750);
});
check("never mutates the order or the outcomes", () => {
  const o = Object.freeze(base());
  const outcomes = Object.freeze({ 0: Object.freeze({ cancelledQty: 3 }) });
  const before = JSON.stringify(o);
  recalculateOrder(o, outcomes, "pay_later", 0);
  assert.equal(JSON.stringify(o), before);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
