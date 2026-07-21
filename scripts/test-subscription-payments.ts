/**
 * Self-contained test for the pure subscription-payment core (no DB, no Next
 * runtime). This is the domain half of the tenant Billing feature: a tenant
 * uploads a proof-of-payment screenshot for a subscription term, the operator
 * reviews it (confirm / reject), and the Billing page derives lifetime metrics
 * from the confirmed payments.
 *
 * Sibling of test:subscription-state (reads the operator-set window) and
 * test:billing-cycle (computes the due date). Where those own the *window*,
 * this owns the *ledger* of payments made against it.
 *
 *   - src/lib/subscription/payments.ts
 *       SUBSCRIPTION_PAYMENT_STATUSES / labels / tone, isSubscriptionPaymentStatus
 *       canConfirm / canReject / applyReview — operator review transitions
 *       parsePaymentAmountCents — peso string → centavos (validation boundary)
 *       normalizePaymentMethod — free text → known method label
 *       subscriptionInvoiceCode — Date → "INV-YYYYMM" display code
 *       summarizeSubscriptionPayments — ledger → lifetime metrics
 *
 *   npm run test:subscription-payments
 */

import assert from "node:assert";

import {
  SUBSCRIPTION_PAYMENT_STATUSES,
  SUBSCRIPTION_PAYMENT_STATUS_LABELS,
  SUBSCRIPTION_PAYMENT_STATUS_TONE,
  isSubscriptionPaymentStatus,
  canConfirm,
  canReject,
  applyReview,
  parsePaymentAmountCents,
  normalizePaymentMethod,
  subscriptionInvoiceCode,
  summarizeSubscriptionPayments,
  buildPaymentsView,
  type SubscriptionPaymentStatus,
} from "../src/lib/subscription/payments";

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

console.log("\nSubscription payments — pure core\n");

// ─────────────────────────── status catalogue ───────────────────────────────
check("SUBSCRIPTION_PAYMENT_STATUSES lists pending, confirmed, failed", () => {
  assert.deepStrictEqual(SUBSCRIPTION_PAYMENT_STATUSES, ["pending", "confirmed", "failed"]);
});

check("every status has a human label and a badge tone", () => {
  for (const s of SUBSCRIPTION_PAYMENT_STATUSES) {
    assert.ok(SUBSCRIPTION_PAYMENT_STATUS_LABELS[s], `label for ${s}`);
    assert.ok(["success", "warn", "danger"].includes(SUBSCRIPTION_PAYMENT_STATUS_TONE[s]), `tone for ${s}`);
  }
  assert.strictEqual(SUBSCRIPTION_PAYMENT_STATUS_TONE.confirmed, "success");
  assert.strictEqual(SUBSCRIPTION_PAYMENT_STATUS_TONE.pending, "warn");
  assert.strictEqual(SUBSCRIPTION_PAYMENT_STATUS_TONE.failed, "danger");
});

check("isSubscriptionPaymentStatus narrows known values and rejects junk", () => {
  assert.strictEqual(isSubscriptionPaymentStatus("confirmed"), true);
  assert.strictEqual(isSubscriptionPaymentStatus("pending"), true);
  assert.strictEqual(isSubscriptionPaymentStatus("failed"), true);
  assert.strictEqual(isSubscriptionPaymentStatus("paid"), false);
  assert.strictEqual(isSubscriptionPaymentStatus(""), false);
  assert.strictEqual(isSubscriptionPaymentStatus(null), false);
  assert.strictEqual(isSubscriptionPaymentStatus(42), false);
});

// ─────────────────────────── review transitions ─────────────────────────────
check("a pending payment can be confirmed or rejected", () => {
  assert.strictEqual(canConfirm("pending"), true);
  assert.strictEqual(canReject("pending"), true);
});

check("a confirmed payment is terminal — no confirm, no reject", () => {
  assert.strictEqual(canConfirm("confirmed"), false);
  assert.strictEqual(canReject("confirmed"), false);
});

check("a failed payment can be re-confirmed but not re-rejected", () => {
  assert.strictEqual(canConfirm("failed"), true);
  assert.strictEqual(canReject("failed"), false);
});

check("applyReview returns the next status for a legal transition", () => {
  assert.strictEqual(applyReview("pending", "confirm"), "confirmed");
  assert.strictEqual(applyReview("pending", "reject"), "failed");
  assert.strictEqual(applyReview("failed", "confirm"), "confirmed");
});

check("applyReview returns null for an illegal transition", () => {
  assert.strictEqual(applyReview("confirmed", "confirm"), null);
  assert.strictEqual(applyReview("confirmed", "reject"), null);
  assert.strictEqual(applyReview("failed", "reject"), null);
});

// ─────────────────────────── amount parsing ─────────────────────────────────
check("parsePaymentAmountCents accepts plain and formatted peso amounts", () => {
  assert.strictEqual(parsePaymentAmountCents("1499"), 149900);
  assert.strictEqual(parsePaymentAmountCents("1499.00"), 149900);
  assert.strictEqual(parsePaymentAmountCents("₱1,499.50"), 149950);
  assert.strictEqual(parsePaymentAmountCents(" 15000 "), 1500000);
});

check("parsePaymentAmountCents rejects zero, negative and non-numeric", () => {
  assert.strictEqual(parsePaymentAmountCents("0"), null);
  assert.strictEqual(parsePaymentAmountCents("-5"), null);
  assert.strictEqual(parsePaymentAmountCents(""), null);
  assert.strictEqual(parsePaymentAmountCents("abc"), null);
});

// ─────────────────────────── method normalization ───────────────────────────
check("normalizePaymentMethod maps known methods and trims, falling back to Other", () => {
  assert.strictEqual(normalizePaymentMethod("gcash"), "GCash");
  assert.strictEqual(normalizePaymentMethod("  GCash  "), "GCash");
  assert.strictEqual(normalizePaymentMethod("bank transfer"), "Bank transfer");
  assert.strictEqual(normalizePaymentMethod("maya"), "Maya");
  assert.strictEqual(normalizePaymentMethod(""), "Other");
  assert.strictEqual(normalizePaymentMethod("something else"), "Other");
});

// ─────────────────────────── invoice code ───────────────────────────────────
check("subscriptionInvoiceCode formats a UTC month as INV-YYYYMM", () => {
  assert.strictEqual(subscriptionInvoiceCode(new Date("2026-08-10T00:00:00Z")), "INV-202608");
  assert.strictEqual(subscriptionInvoiceCode(new Date("2026-01-01T00:00:00Z")), "INV-202601");
  assert.strictEqual(subscriptionInvoiceCode(new Date("2025-12-31T23:00:00Z")), "INV-202512");
});

// #6 — two payments in the SAME month must not collide on their invoice code:
// with a per-payment id the code carries a stable suffix that disambiguates them.
check("subscriptionInvoiceCode disambiguates same-month payments by id", () => {
  const date = new Date("2026-08-10T00:00:00Z");
  const a = subscriptionInvoiceCode(date, "ckpaymentaaaa1111");
  const b = subscriptionInvoiceCode(date, "ckpaymentbbbb2222");
  assert.ok(a.startsWith("INV-202608-"), `expected INV-202608-… got ${a}`);
  assert.notStrictEqual(a, b); // distinct payments → distinct codes
  // Stable: same id → same code across calls.
  assert.strictEqual(a, subscriptionInvoiceCode(date, "ckpaymentaaaa1111"));
});
check("subscriptionInvoiceCode without an id keeps the plain month code", () => {
  assert.strictEqual(subscriptionInvoiceCode(new Date("2026-08-10T00:00:00Z")), "INV-202608");
});

// ─────────────────────────── metrics summary ────────────────────────────────
const LEDGER: { amountCents: number; status: SubscriptionPaymentStatus }[] = [
  { amountCents: 149900, status: "confirmed" },
  { amountCents: 149900, status: "confirmed" },
  { amountCents: 149900, status: "confirmed" },
  { amountCents: 149900, status: "pending" },
  { amountCents: 149900, status: "failed" },
];

check("summarizeSubscriptionPayments counts each status", () => {
  const s = summarizeSubscriptionPayments(LEDGER);
  assert.strictEqual(s.total, 5);
  assert.strictEqual(s.confirmedCount, 3);
  assert.strictEqual(s.pendingCount, 1);
  assert.strictEqual(s.failedCount, 1);
});

check("lifetime revenue sums only confirmed payments", () => {
  const s = summarizeSubscriptionPayments(LEDGER);
  assert.strictEqual(s.lifetimeConfirmedCents, 449700); // 3 × 1499.00
});

check("avg monthly value is lifetime ÷ confirmed count, rounded", () => {
  const s = summarizeSubscriptionPayments(LEDGER);
  assert.strictEqual(s.avgMonthlyCents, 149900);
});

check("paid/pending percentages are of the total ledger", () => {
  const s = summarizeSubscriptionPayments(LEDGER);
  assert.strictEqual(s.paidPct, 60);
  assert.strictEqual(s.pendingPct, 20);
});

check("an empty ledger summarizes to all-zero without dividing by zero", () => {
  const s = summarizeSubscriptionPayments([]);
  assert.strictEqual(s.total, 0);
  assert.strictEqual(s.confirmedCount, 0);
  assert.strictEqual(s.lifetimeConfirmedCents, 0);
  assert.strictEqual(s.avgMonthlyCents, 0);
  assert.strictEqual(s.paidPct, 0);
  assert.strictEqual(s.pendingPct, 0);
});

// #2 — the Billing page's lifetime metrics must roll up from the WHOLE ledger,
// even though the invoice table only shows a capped slice. buildPaymentsView
// splits a full ledger into a display slice + a summary computed over ALL rows.
check("buildPaymentsView summarizes the full ledger while capping the display slice", () => {
  const big = Array.from({ length: 65 }, () => ({
    amountCents: 149900,
    status: "confirmed" as SubscriptionPaymentStatus,
  }));
  const view = buildPaymentsView(big, 60);
  assert.strictEqual(view.display.length, 60); // table shows at most 60 rows
  assert.strictEqual(view.summary.confirmedCount, 65); // …but metrics count all 65
  assert.strictEqual(view.summary.lifetimeConfirmedCents, 65 * 149900);
});

check("buildPaymentsView returns the whole ledger when it fits under the cap", () => {
  const view = buildPaymentsView(LEDGER, 60);
  assert.strictEqual(view.display.length, LEDGER.length);
  assert.strictEqual(view.summary.total, LEDGER.length);
});

// ─────────────────────────────── summary ────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
