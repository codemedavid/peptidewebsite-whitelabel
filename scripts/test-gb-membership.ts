/**
 * Pure core for paid group-buy access (no DB, no Next runtime). A customer pays
 * a per-round join fee by manual receipt, a store admin approves or rejects,
 * and only an approved membership opens the round.
 *
 *   - src/lib/storefront/gb-membership.ts
 *       statuses / blocking set / hasGroupBuyAccess
 *       planMembershipTransition — the lifecycle + who may drive each step
 *       parseReceiptSubmission — customer input at the boundary (no amount)
 *       parseJoinFeeCents — owner's peso input → integer centavos
 *       membershipStatusView — customer-facing status copy
 *
 * The same lifecycle is enforced again by Postgres (prisma/group-buy-memberships.sql,
 * npm run test:gb-membership-db); this file is the readable rulebook.
 *
 *   npm run test:gb-membership
 */

import assert from "node:assert";

import {
  GB_MEMBERSHIP_STATUSES,
  GB_MEMBERSHIP_BLOCKING_STATUSES,
  isGbMembershipStatus,
  hasGroupBuyAccess,
  planMembershipTransition,
  parseReceiptSubmission,
  parseJoinFeeCents,
  membershipStatusView,
  type MembershipActor,
} from "../src/lib/storefront/gb-membership";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const customer: MembershipActor = { kind: "customer", id: "cus_1", email: "ana@example.com" };
const owner: MembershipActor = { kind: "owner", id: "owner", email: "shop@example.com" };
const staff: MembershipActor = { kind: "staff", id: "stf_1", email: "staff@example.com" };
const membership = { customerId: "cus_1", customerEmail: "ana@example.com" };

console.log("statuses");

test("the six lifecycle statuses, in order", () => {
  assert.deepStrictEqual(
    [...GB_MEMBERSHIP_STATUSES],
    ["pending_payment", "paid_pending_approval", "approved", "rejected", "refunded", "revoked"],
  );
});

test("isGbMembershipStatus rejects anything else", () => {
  assert.ok(isGbMembershipStatus("approved"));
  assert.ok(!isGbMembershipStatus("APPROVED"));
  assert.ok(!isGbMembershipStatus("cancelled"));
  assert.ok(!isGbMembershipStatus(null));
});

test("a live request (or a revoke) blocks paying again; rejected/refunded do not", () => {
  assert.deepStrictEqual(
    [...GB_MEMBERSHIP_BLOCKING_STATUSES].sort(),
    ["approved", "paid_pending_approval", "pending_payment", "revoked"],
  );
});

test("only approved opens the round", () => {
  for (const s of GB_MEMBERSHIP_STATUSES) assert.strictEqual(hasGroupBuyAccess(s), s === "approved", s);
  assert.strictEqual(hasGroupBuyAccess(undefined), false);
  assert.strictEqual(hasGroupBuyAccess("garbage"), false);
});

console.log("lifecycle");

test("customer submits a receipt: pending_payment → paid_pending_approval", () => {
  const r = planMembershipTransition({ from: "pending_payment", to: "paid_pending_approval", actor: customer, membership });
  assert.ok(r.ok, !r.ok ? r.error : "");
});

test("a customer cannot submit for someone else's request", () => {
  const other: MembershipActor = { kind: "customer", id: "cus_2", email: "bea@example.com" };
  const r = planMembershipTransition({ from: "pending_payment", to: "paid_pending_approval", actor: other, membership });
  assert.ok(!r.ok);
});

test("owner and staff can approve a paid request", () => {
  for (const actor of [owner, staff]) {
    const r = planMembershipTransition({ from: "paid_pending_approval", to: "approved", actor, membership });
    assert.ok(r.ok, actor.kind);
  }
});

test("a customer can never approve, reject, refund or revoke", () => {
  for (const [from, to] of [
    ["paid_pending_approval", "approved"],
    ["paid_pending_approval", "rejected"],
    ["rejected", "refunded"],
    ["approved", "revoked"],
  ] as const) {
    const r = planMembershipTransition({ from, to, actor: customer, membership, reason: "x" });
    assert.ok(!r.ok, `${from}→${to}`);
  }
});

test("an admin whose email is the customer's cannot approve their own request", () => {
  const selfStaff: MembershipActor = { kind: "staff", id: "stf_9", email: "  ANA@example.com " };
  const r = planMembershipTransition({ from: "paid_pending_approval", to: "approved", actor: selfStaff, membership });
  assert.ok(!r.ok);
  assert.match(r.ok ? "" : r.error, /own/i);
});

test("no skipping: pending_payment cannot jump to approved", () => {
  const r = planMembershipTransition({ from: "pending_payment", to: "approved", actor: owner, membership });
  assert.ok(!r.ok);
});

test("every illegal pair is refused, every legal pair is allowed (for the right actor)", () => {
  const legal = new Set([
    "pending_payment>paid_pending_approval",
    "paid_pending_approval>approved",
    "paid_pending_approval>rejected",
    "rejected>refunded",
    "approved>revoked",
  ]);
  for (const from of GB_MEMBERSHIP_STATUSES) {
    for (const to of GB_MEMBERSHIP_STATUSES) {
      const actor = from === "pending_payment" ? customer : owner;
      const r = planMembershipTransition({ from, to, actor, membership, reason: "because", refundReference: "RF-1" });
      assert.strictEqual(r.ok, legal.has(`${from}>${to}`), `${from}→${to}`);
    }
  }
});

test("reject needs a reason; whitespace is not a reason", () => {
  assert.ok(!planMembershipTransition({ from: "paid_pending_approval", to: "rejected", actor: owner, membership }).ok);
  assert.ok(!planMembershipTransition({ from: "paid_pending_approval", to: "rejected", actor: owner, membership, reason: "   " }).ok);
  const r = planMembershipTransition({ from: "paid_pending_approval", to: "rejected", actor: owner, membership, reason: "  Receipt amount is ₱500, fee is ₱1,000  " });
  assert.ok(r.ok);
  assert.strictEqual(r.ok && r.patch.reviewReason, "Receipt amount is ₱500, fee is ₱1,000");
});

test("revoke needs a reason too", () => {
  assert.ok(!planMembershipTransition({ from: "approved", to: "revoked", actor: owner, membership }).ok);
  assert.ok(planMembershipTransition({ from: "approved", to: "revoked", actor: owner, membership, reason: "Shared the group-buy prices" }).ok);
});

test("approve stamps who and when; refund stamps the refund reference", () => {
  const at = new Date("2026-10-25T10:00:00Z");
  const a = planMembershipTransition({ from: "paid_pending_approval", to: "approved", actor: staff, membership, at });
  assert.ok(a.ok);
  assert.deepStrictEqual(a.ok && a.patch, { status: "approved", decidedAt: at, decidedBy: "staff:stf_1" });

  const r = planMembershipTransition({ from: "rejected", to: "refunded", actor: owner, membership, at, refundReference: " GC-998877 " });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.ok && r.patch, { status: "refunded", refundedAt: at, refundReference: "GC-998877" });
});

test("an unknown status on either side is refused, never thrown", () => {
  assert.ok(!planMembershipTransition({ from: "weird", to: "approved", actor: owner, membership }).ok);
  assert.ok(!planMembershipTransition({ from: "paid_pending_approval", to: "weird", actor: owner, membership }).ok);
});

console.log("receipt submission (customer input)");

test("reference is required, trimmed, and a sane length", () => {
  assert.ok(!parseReceiptSubmission({ reference: "" }).ok);
  assert.ok(!parseReceiptSubmission({ reference: "12" }).ok);
  assert.ok(!parseReceiptSubmission({ reference: "x".repeat(65) }).ok);
  const r = parseReceiptSubmission({ reference: "  1023 4567 8901  ", method: "GCash" });
  assert.ok(r.ok);
  assert.strictEqual(r.ok && r.value.reference, "1023 4567 8901");
});

test("reference rejects markup / control characters", () => {
  assert.ok(!parseReceiptSubmission({ reference: "<script>1234" }).ok);
  assert.ok(!parseReceiptSubmission({ reference: "1234\n5678" }).ok);
});

test("any amount the client sends is ignored — the value has no amount field", () => {
  const r = parseReceiptSubmission({ reference: "ABC-12345", amountCents: 1, amount: "1", method: "GCash" });
  assert.ok(r.ok);
  assert.ok(r.ok && !("amountCents" in r.value) && !("amount" in r.value));
});

test("method is free text but bounded; blank becomes empty", () => {
  const r = parseReceiptSubmission({ reference: "ABC-12345", method: "  BPI bank transfer  " });
  assert.strictEqual(r.ok && r.value.method, "BPI bank transfer");
  const long = parseReceiptSubmission({ reference: "ABC-12345", method: "m".repeat(200) });
  assert.strictEqual(long.ok && long.value.method.length, 60);
  const blank = parseReceiptSubmission({ reference: "ABC-12345" });
  assert.strictEqual(blank.ok && blank.value.method, "");
});

test("paidAt: valid ISO kept, garbage dropped, future refused", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  const ok = parseReceiptSubmission({ reference: "ABC-12345", paidAt: "2026-10-25T08:00:00Z" }, now);
  assert.strictEqual(ok.ok && ok.value.paidAt?.toISOString(), "2026-10-25T08:00:00.000Z");
  const junk = parseReceiptSubmission({ reference: "ABC-12345", paidAt: "yesterday" }, now);
  assert.strictEqual(junk.ok && junk.value.paidAt, null);
  assert.ok(!parseReceiptSubmission({ reference: "ABC-12345", paidAt: "2026-11-30T00:00:00Z" }, now).ok);
});

test("non-object input is a clean refusal", () => {
  assert.ok(!parseReceiptSubmission(null).ok);
  assert.ok(!parseReceiptSubmission("ABC-12345").ok);
});

console.log("join fee (owner input)");

test("pesos → integer centavos", () => {
  assert.deepStrictEqual(parseJoinFeeCents("500"), { ok: true, value: 50000 });
  assert.deepStrictEqual(parseJoinFeeCents("1,499.50"), { ok: true, value: 149950 });
  assert.deepStrictEqual(parseJoinFeeCents(250), { ok: true, value: 25000 });
  assert.deepStrictEqual(parseJoinFeeCents(" ₱ 99.9 "), { ok: true, value: 9990 });
});

test("no float drift: 0.1 + 0.2 style inputs round to the centavo", () => {
  assert.deepStrictEqual(parseJoinFeeCents("19.99"), { ok: true, value: 1999 });
  assert.deepStrictEqual(parseJoinFeeCents(0.3), { ok: true, value: 30 });
});

test("zero, negative, too many decimals, huge and junk are refused", () => {
  for (const v of ["0", "-5", "1.234", "1000001", "abc", "", null, NaN, Infinity]) {
    assert.ok(!parseJoinFeeCents(v).ok, String(v));
  }
});

console.log("customer status copy");

test("each status has the customer-facing line from the spec", () => {
  assert.strictEqual(membershipStatusView("pending_payment").title, "Awaiting payment");
  assert.strictEqual(membershipStatusView("paid_pending_approval").title, "Payment received – waiting for admin approval");
  assert.strictEqual(membershipStatusView("approved").title, "Approved");
});

test("rejected shows the reason and says the store refunds directly", () => {
  const v = membershipStatusView("rejected", "Wrong amount");
  assert.strictEqual(v.title, "Rejected: Wrong amount – refund in progress");
  assert.match(v.detail, /refund you directly/);
});

test("refunded and revoked have their own lines; unknown is treated as no request", () => {
  assert.match(membershipStatusView("refunded").title, /Refunded/);
  assert.match(membershipStatusView("revoked", "Rule break").title, /Access removed: Rule break/);
  assert.strictEqual(membershipStatusView("??").title, "Join this group buy");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
