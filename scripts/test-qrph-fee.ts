/**
 * Self-contained test for the QR PH payment processing fee.
 *
 * QR PH settles through the national QR standard, which charges the merchant a
 * percentage of what it collects. The store owner TAGS one of their configured
 * payment methods as QR PH (PaymentMethod.qrph) and the checkout adds the fee
 * whenever the customer pays with it — every other method is untouched.
 *
 *   src/lib/storefront/payment-fee.ts
 *     isQrphMethod(m)                     — reads the owner's tag.
 *     paymentFeeBase(parts)               — the amount the percentage is charged on.
 *     activePaymentFee(methods, name, base, entitled)
 *                                         — {label, amount} | null, the whole rule.
 *     normalizeOrderPaymentFee(input)     — coerce a stored/untrusted blob.
 *     paymentFeeOvercharges(shown, charged)
 *                                         — would we bill MORE than we displayed?
 *
 * Also pins every downstream total surface to the SAME number, because the
 * grand total is computed independently in four places and a fee added to only
 * some of them undercounts revenue silently.
 *
 *   npm run test:qrph-fee
 */

import assert from "node:assert";

import type { Order, PaymentMethod } from "../src/storefront/types";
import {
  QRPH_FEE_PERCENT,
  QRPH_FEE_LABEL,
  isQrphMethod,
  paymentFeeBase,
  activePaymentFee,
  normalizeOrderPaymentFee,
  paymentFeeOvercharges,
} from "../src/lib/storefront/payment-fee";
import { computeOrderTotals } from "../src/storefront/admin/order-detail";
import { orderTotal } from "../src/lib/storefront/admin-dashboard";
import { orderTotal as analyticsOrderTotal } from "../src/lib/analytics/events";
import { buildOrderConfirmation } from "../src/lib/storefront/order-confirmation";

// ──────────────────────────── tiny assertion harness ────────────────────────
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

// ──────────────────────────── fixtures ──────────────────────────────────────

function method(over: Partial<PaymentMethod> = {}): PaymentMethod {
  return {
    id: "pm1",
    name: "GCash",
    account: "JUAN DELA CRUZ",
    number: "09171234567",
    qrImage: "",
    order: 1,
    active: true,
    ...over,
  };
}

/** A tenant's configured set: one tagged QR PH method, two ordinary ones. */
const METHODS: PaymentMethod[] = [
  method({ id: "pm1", name: "GCash", order: 1 }),
  method({ id: "pm2", name: "QR PH", order: 2, qrph: true }),
  method({ id: "pm3", name: "Bank Transfer", order: 3 }),
];

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: "ord_1",
    orderNumber: "PEP-1001",
    status: "new",
    paymentStatus: "paid",
    paymentMethod: "QR PH",
    date: "2026-09-02T02:42:00.000Z",
    customer: { name: "Juan", email: "j@example.com", phone: "0917", contactMethod: "" },
    shipping: {
      address: "1 Main St",
      barangay: "",
      city: "Davao",
      province: "Davao del Sur",
      postal: "8000",
      country: "PH",
      region: "",
      fee: 100,
    },
    courier: "J&T",
    trackingNumber: "",
    shippingNote: "",
    items: [{ name: "Semaglutide", qty: 1, price: 1000 }],
    ...over,
  };
}

console.log("\nQR PH processing fee\n");

// ─── The rate and the arithmetic ────────────────────────────────────────────

check("the configured rate is 2%", () => {
  assert.strictEqual(QRPH_FEE_PERCENT, 2);
});

check("2% of ₱1,000 is exactly ₱20 (spec Test 1)", () => {
  const fee = activePaymentFee(METHODS, "QR PH", 1000, true);
  assert.strictEqual(fee?.amount, 20);
});

check("the fee line names the rate so the customer can check the math", () => {
  const fee = activePaymentFee(METHODS, "QR PH", 1000, true);
  assert.strictEqual(fee?.label, QRPH_FEE_LABEL);
  assert.ok(/2%/.test(QRPH_FEE_LABEL), `label should carry the rate: ${QRPH_FEE_LABEL}`);
});

check("PHP amounts round to two decimals, never a fraction of a centavo", () => {
  // 2% of 1,123 = 22.46 exactly. Naive float math gives 22.459999999999997.
  assert.strictEqual(activePaymentFee(METHODS, "QR PH", 1123, true)?.amount, 22.46);
  // 2% of 1,234.57 = 24.6914 → 24.69
  assert.strictEqual(activePaymentFee(METHODS, "QR PH", 1234.57, true)?.amount, 24.69);
});

// ─── Which methods it applies to ────────────────────────────────────────────

check("only the owner's TAGGED method is QR PH", () => {
  assert.strictEqual(isQrphMethod(METHODS[1]), true);
  assert.strictEqual(isQrphMethod(METHODS[0]), false);
  assert.strictEqual(isQrphMethod(METHODS[2]), false);
});

check("an untagged method named 'QR PH' charges nothing — the tag is the rule", () => {
  const untagged = [method({ id: "pm9", name: "QR PH" })];
  assert.strictEqual(activePaymentFee(untagged, "QR PH", 1000, true), null);
});

check("paying by GCash charges no processing fee (spec Test 2)", () => {
  assert.strictEqual(activePaymentFee(METHODS, "GCash", 1000, true), null);
});

check("a blank or unknown method charges nothing", () => {
  assert.strictEqual(activePaymentFee(METHODS, "", 1000, true), null);
  assert.strictEqual(activePaymentFee(METHODS, "Coins.ph", 1000, true), null);
});

check("the method name matches case- and whitespace-insensitively", () => {
  // The order stores the NAME the checkout displayed; the server re-derives the
  // fee from it. Casing drift must not silently drop the charge.
  assert.strictEqual(activePaymentFee(METHODS, "  qr ph  ", 1000, true)?.amount, 20);
});

check("a missing or malformed config charges nothing rather than throwing", () => {
  assert.strictEqual(activePaymentFee(undefined, "QR PH", 1000, true), null);
  assert.strictEqual(activePaymentFee(null, "QR PH", 1000, true), null);
  assert.strictEqual(activePaymentFee([null, 42, "x"], "QR PH", 1000, true), null);
  assert.strictEqual(activePaymentFee({ nope: true }, "QR PH", 1000, true), null);
});

// ─── Switching methods: the fee must never accumulate (spec Tests 2 & 3) ────

check("switching QR PH → other → QR PH → other → QR PH never accumulates", () => {
  const picks = ["QR PH", "GCash", "QR PH", "Bank Transfer", "QR PH"];
  const amounts = picks.map((p) => activePaymentFee(METHODS, p, 1000, true)?.amount ?? 0);
  assert.deepStrictEqual(amounts, [20, 0, 20, 0, 20]);
});

check("the fee is derived, so re-asking a hundred times gives one fee", () => {
  for (let i = 0; i < 100; i++) {
    assert.strictEqual(activePaymentFee(METHODS, "QR PH", 1000, true)?.amount, 20);
  }
});

check("the fee is never charged on itself", () => {
  const base = 1000;
  const first = activePaymentFee(METHODS, "QR PH", base, true)!;
  // Feeding the grand total back in would compound (2% of 1,020 = 20.40).
  const second = activePaymentFee(METHODS, "QR PH", base, true)!;
  assert.strictEqual(first.amount, second.amount);
  assert.strictEqual(first.amount, 20);
});

// ─── The base the percentage is charged on ──────────────────────────────────

check("the base is what the store actually collects: items − discount + shipping + admin fee", () => {
  assert.strictEqual(
    paymentFeeBase({ subtotal: 1000, discount: 0, shipping: 100, adminFee: 0 }),
    1100,
  );
  assert.strictEqual(
    paymentFeeBase({ subtotal: 1000, discount: 150, shipping: 100, adminFee: 50 }),
    1000,
  );
});

check("₱1,000 + ₱100 delivery is charged ₱22 (the spec's worked example)", () => {
  const base = paymentFeeBase({ subtotal: 1000, shipping: 100 });
  assert.strictEqual(activePaymentFee(METHODS, "QR PH", base, true)?.amount, 22);
});

check("an over-large discount floors the base at zero instead of going negative", () => {
  assert.strictEqual(paymentFeeBase({ subtotal: 100, discount: 500 }), 0);
});

check("a zero base charges no fee at all — no ₱0.00 line at checkout", () => {
  assert.strictEqual(activePaymentFee(METHODS, "QR PH", 0, true), null);
  assert.strictEqual(activePaymentFee(METHODS, "QR PH", -50, true), null);
});

// ─── The entitlement gate (feature management, default OFF) ─────────────────

check("an unentitled tenant is charged nothing, tag or no tag", () => {
  assert.strictEqual(activePaymentFee(METHODS, "QR PH", 1000, false), null);
});

check("revoking the feature leaves the owner's tag intact for later", () => {
  // The gate is a read-time decision, never a write: the config is untouched.
  activePaymentFee(METHODS, "QR PH", 1000, false);
  assert.strictEqual(METHODS[1].qrph, true);
});

// ─── Server authority over a tampered client (spec Test 4) ──────────────────

check("a client that displayed a smaller fee than we'd charge is rejected", () => {
  // Charging more than the customer was shown is the one outcome we never allow.
  assert.strictEqual(paymentFeeOvercharges(0, 20), true);
  assert.strictEqual(paymentFeeOvercharges(10, 20), true);
});

check("charging the customer the same or less than shown is allowed through", () => {
  assert.strictEqual(paymentFeeOvercharges(20, 20), false);
  assert.strictEqual(paymentFeeOvercharges(20, 0), false);
  assert.strictEqual(paymentFeeOvercharges(20, 19.5), false);
});

check("sub-centavo float drift does not reject a legitimate order", () => {
  assert.strictEqual(paymentFeeOvercharges(22.46, 22.460000000001), false);
});

check("a legacy client that sent no fee at all is not treated as a claim of zero", () => {
  // Absent means "this checkout predates the feature", not "the customer was
  // shown ₱0" — the server stamps its own value without rejecting.
  assert.strictEqual(paymentFeeOvercharges(null, 20), false);
  assert.strictEqual(paymentFeeOvercharges(undefined, 20), false);
});

// ─── Persisting the snapshot ────────────────────────────────────────────────

check("a stored fee blob is coerced into a clean snapshot", () => {
  assert.deepStrictEqual(normalizeOrderPaymentFee({ label: "QR PH processing fee (2%)", amount: 20 }), {
    label: "QR PH processing fee (2%)",
    amount: 20,
  });
});

check("a zero, negative or garbage fee reads back as no fee", () => {
  assert.strictEqual(normalizeOrderPaymentFee({ label: "x", amount: 0 }), undefined);
  assert.strictEqual(normalizeOrderPaymentFee({ label: "x", amount: -5 }), undefined);
  assert.strictEqual(normalizeOrderPaymentFee(null), undefined);
  assert.strictEqual(normalizeOrderPaymentFee("20"), undefined);
  assert.strictEqual(normalizeOrderPaymentFee({ amount: "abc" }), undefined);
});

check("a stored fee with a blank label falls back to the standard line name", () => {
  assert.strictEqual(normalizeOrderPaymentFee({ label: "", amount: 20 })?.label, QRPH_FEE_LABEL);
});

// ─── Every total surface agrees (the undercount trap) ───────────────────────

check("an order carries BOTH an admin fee and a processing fee", () => {
  const order = makeOrder({
    adminFee: { label: "Admin fee", amount: 50 },
    paymentFee: { label: QRPH_FEE_LABEL, amount: 23 },
  });
  // items 1000 − discount 0 + shipping 100 + admin 50 + processing 23
  assert.strictEqual(orderTotal(order), 1173);
});

check("all four independent total formulas produce the same number", () => {
  const order = makeOrder({
    items: [{ name: "Semaglutide", qty: 2, price: 500 }],
    discount: { code: "SAVE10", label: "10% off", amount: 100 },
    adminFee: { label: "Admin fee", amount: 50 },
    paymentFee: { label: QRPH_FEE_LABEL, amount: 21 },
  });
  // 1000 − 100 + 100 + 50 + 21 = 1071
  const expected = 1071;

  assert.strictEqual(orderTotal(order), expected, "admin-dashboard.orderTotal");
  assert.strictEqual(analyticsOrderTotal(order), expected, "analytics/events.orderTotal");
  assert.strictEqual(computeOrderTotals(order).total, expected, "order-detail.computeOrderTotals");
  assert.strictEqual(
    buildOrderConfirmation(order, [], { currency: "₱" }).totals.total,
    expected,
    "order-confirmation.buildOrderConfirmation",
  );
});

check("the order-detail breakdown exposes the processing fee as its own line", () => {
  const totals = computeOrderTotals(
    makeOrder({ paymentFee: { label: QRPH_FEE_LABEL, amount: 22 } }),
  );
  assert.strictEqual(totals.paymentFee, 22);
});

check("the confirmation screen shows the processing fee with its label", () => {
  const view = buildOrderConfirmation(
    makeOrder({ paymentFee: { label: QRPH_FEE_LABEL, amount: 22 } }),
    [],
    { currency: "₱" },
  );
  assert.strictEqual(view.totals.paymentFee, 22);
  assert.strictEqual(view.totals.paymentFeeLabel, QRPH_FEE_LABEL);
});

check("an order without a processing fee totals exactly as it always did", () => {
  const order = makeOrder({ adminFee: { label: "Admin fee", amount: 50 } });
  assert.strictEqual(orderTotal(order), 1150);
  assert.strictEqual(analyticsOrderTotal(order), 1150);
  assert.strictEqual(computeOrderTotals(order).total, 1150);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
