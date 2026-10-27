/**
 * Admin → Group Buys → Members: the pure view rules behind the tab.
 *   - every member lands in the right bucket, "Needs you" = proofs + approvals;
 *   - each card leads with the ONE move that waits on the store (never one the
 *     member's flow doesn't allow);
 *   - the most urgent, longest-waiting member is on top;
 *   - the round header's words (flow, slots) read right;
 *   - an approved shopper's join page reloads into the round once, never in a loop.
 *
 *   npm run test:paid-access-members
 */

import assert from "node:assert";

import {
  approvesAfterPaying,
  bucketCounts,
  expiredHolds,
  flowSummary,
  formatAmount,
  inBucket,
  matchesSearch,
  primaryMove,
  slotMeter,
  sortForReview,
  timeAgo,
} from "../src/modules/paid-access/ui/member-view";
import { AUTO_OPEN_COOLDOWN_MS, parseAutoOpenMark, roundHomeUrl, shouldAutoOpen } from "../src/modules/paid-access/ui/auto-open";

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

type Row = {
  status: string;
  refundStatus: string;
  steps: string[];
  createdAt: string;
  holdExpiresAt: string | null;
  customerName: string;
  customerEmail: string;
  payment: { status: string; submittedAt: string | null } | null;
};
const row = (over: Partial<Row>): Row => ({
  status: "active",
  refundStatus: "not_applicable",
  steps: ["payment", "approval"],
  createdAt: "2026-10-27T00:00:00.000Z",
  holdExpiresAt: null,
  customerName: "Ana",
  customerEmail: "ana@gmail.com",
  payment: null,
  ...over,
});

console.log("\nBuckets");

check("'Needs you' is proofs to check + approvals, nothing else", () => {
  assert.ok(inBucket(row({ status: "payment_review" }), "needs"));
  assert.ok(inBucket(row({ status: "approval_pending" }), "needs"));
  for (const s of ["payment_pending", "form_pending", "waitlisted", "active", "rejected"]) assert.ok(!inBucket(row({ status: s }), "needs"), s);
});

check("joining = part-way through; refunds = rejected with money still owed", () => {
  assert.ok(inBucket(row({ status: "payment_pending" }), "joining"));
  assert.ok(inBucket(row({ status: "form_pending" }), "joining"));
  assert.ok(inBucket(row({ status: "rejected", refundStatus: "pending" }), "refunds"));
  assert.ok(inBucket(row({ status: "rejected", refundStatus: "processing" }), "refunds"));
  assert.ok(!inBucket(row({ status: "rejected", refundStatus: "refunded" }), "refunds"));
});

check("counts add up per bucket and 'all' counts everyone", () => {
  const c = bucketCounts([row({ status: "payment_review" }), row({ status: "active" }), row({ status: "waitlisted" }), row({ status: "active" })]);
  assert.deepEqual(c, { needs: 1, joining: 0, waitlist: 1, refunds: 0, in: 2, all: 4 });
});

console.log("\nThe one move each card leads with");

check("a proof to check in a pay-then-approve flow leads with confirm & let in", () => {
  assert.equal(primaryMove(row({ status: "payment_review", payment: { status: "submitted", submittedAt: null } })), "confirm_and_approve");
});

check("a proof in a pay-only flow leads with confirm payment (no approval step to skip)", () => {
  assert.equal(primaryMove(row({ status: "payment_review", steps: ["payment"], payment: { status: "submitted", submittedAt: null } })), "confirm_payment");
});

check("approve-then-pay never offers confirm & approve", () => {
  assert.equal(approvesAfterPaying(["approval", "payment"]), false);
  assert.equal(primaryMove(row({ status: "payment_review", steps: ["approval", "payment"], payment: { status: "submitted", submittedAt: null } })), "confirm_payment");
});

check("approval waiting → approve; refund owed → mark refunded; settled → nothing", () => {
  assert.equal(primaryMove(row({ status: "approval_pending" })), "approve");
  assert.equal(primaryMove(row({ status: "rejected", refundStatus: "pending" })), "refund");
  for (const s of ["active", "waitlisted", "payment_pending", "expired", "cancelled", "revoked"]) assert.equal(primaryMove(row({ status: s })), null, s);
});

check("a proof already handled (not 'submitted') has no confirm button", () => {
  assert.equal(primaryMove(row({ status: "payment_review", payment: { status: "confirmed", submittedAt: null } })), null);
});

console.log("\nOrder + search");

check("members waiting on the store come first, longest wait on top", () => {
  const sorted = sortForReview([
    row({ customerName: "in", status: "active", createdAt: "2026-10-01T00:00:00Z" }),
    row({ customerName: "new proof", status: "payment_review", payment: { status: "submitted", submittedAt: "2026-10-27T08:00:00Z" } }),
    row({ customerName: "old proof", status: "payment_review", payment: { status: "submitted", submittedAt: "2026-10-27T07:00:00Z" } }),
  ]);
  assert.deepEqual(sorted.map((r) => r.customerName), ["old proof", "new proof", "in"]);
});

check("search matches name or email, case-insensitively; blank matches all", () => {
  assert.ok(matchesSearch(row({}), "ANA"));
  assert.ok(matchesSearch(row({}), "gmail"));
  assert.ok(matchesSearch(row({}), "  "));
  assert.ok(!matchesSearch(row({}), "yahoo"));
});

console.log("\nRound header words");

check("the flow reads in order with the price", () => {
  assert.equal(flowSummary(["payment", "approval"], "₱100"), "Pay ₱100 → Admin approval");
  assert.equal(flowSummary(["form", "approval"], "₱0"), "Application → Admin approval");
  assert.equal(flowSummary([], "₱0"), "Open to everyone");
});

check("amounts drop .00 but keep real centavos", () => {
  assert.equal(formatAmount("₱", 10000), "₱100");
  assert.equal(formatAmount("₱", 150050), "₱1,500.5");
});

check("slots meter: taken of max, full, and no limit", () => {
  assert.deepEqual(slotMeter(1, 3), { label: "1 of 3 taken · 2 open", fill: 1 / 3 });
  assert.equal(slotMeter(3, 3).label, "3 of 3 taken · full");
  assert.deepEqual(slotMeter(5, null), { label: "5 taken · no limit", fill: null });
  assert.equal(slotMeter(4, 3).fill, 1);
});

check("only unpaid holds past their deadline count as releasable", () => {
  const now = Date.parse("2026-10-27T08:00:00Z");
  const n = expiredHolds(
    [
      row({ status: "payment_pending", holdExpiresAt: "2026-10-27T07:59:00Z" }),
      row({ status: "payment_pending", holdExpiresAt: "2026-10-27T08:30:00Z" }),
      row({ status: "payment_review", holdExpiresAt: "2026-10-27T07:00:00Z" }),
    ],
    now,
  );
  assert.equal(n, 1);
});

check("time ago reads naturally", () => {
  const now = Date.parse("2026-10-27T08:00:00Z");
  assert.equal(timeAgo("2026-10-27T07:59:40Z", now), "just now");
  assert.equal(timeAgo("2026-10-27T07:45:00Z", now), "15m ago");
  assert.equal(timeAgo("2026-10-27T05:00:00Z", now), "3h ago");
  assert.equal(timeAgo(null, now), "—");
});

console.log("\nApproved shopper: the join page opens the round by itself");

check("first time in → reload into the round", () => {
  assert.equal(shouldAutoOpen(null, "gb1", 1_000_000), true);
});

check("a reload that comes back still locked shows the button, not another reload", () => {
  const now = 1_000_000;
  assert.equal(shouldAutoOpen({ id: "gb1", at: now - 5_000 }, "gb1", now), false);
});

check("the guard is per round and expires", () => {
  const now = 1_000_000;
  assert.equal(shouldAutoOpen({ id: "gb1", at: now - 5_000 }, "gb2", now), true);
  assert.equal(shouldAutoOpen({ id: "gb1", at: now - AUTO_OPEN_COOLDOWN_MS - 1 }, "gb1", now), true);
});

check("a garbled stored mark is ignored", () => {
  assert.equal(parseAutoOpenMark("{nope"), null);
  assert.equal(parseAutoOpenMark(JSON.stringify({ id: 3, at: "x" })), null);
  assert.deepEqual(parseAutoOpenMark(JSON.stringify({ id: "gb1", at: 5 })), { id: "gb1", at: 5 });
});

check("approved → lands on the home catalog, not back on #groupbuy", () => {
  // The home already lists the round's products once they're in; reopening the
  // separate pricing page showed the same products twice.
  assert.equal(roundHomeUrl("/", ""), "/");
  assert.equal(roundHomeUrl("/", "?ref=fb"), "/?ref=fb");
  assert.equal(roundHomeUrl("/shop", "?a=1"), "/shop?a=1");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
