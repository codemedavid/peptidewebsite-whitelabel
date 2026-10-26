/**
 * Paid Access — the PURE core (no DB, no Next runtime): settings + presets, the
 * step-order rules, the membership state machine, refunds and the stepper the
 * customer sees. Everything else in the module is plumbing around these rules.
 *
 *   src/modules/paid-access/core/*
 *
 * The transition matrix below is spelled out BY HAND per preset (not derived
 * from the module), so the test is an independent oracle: every one of the
 * 10×10 status pairs is checked as allowed or forbidden for every preset.
 * Postgres enforces the same graph (test:paid-access-db).
 *
 *   npm run test:paid-access-core
 */

import assert from "node:assert";

import {
  PAID_ACCESS_PRESET_IDS,
  PAID_ACCESS_STATUSES,
  COPY_LIMITS,
  EMPTY_COPY,
  OPEN_SETTINGS,
  applyPreset,
  detectPreset,
  edgeAllowed,
  firstStatus,
  parseAmountCents,
  parseFormAnswers,
  parseProofSubmission,
  planRefund,
  planRefundTransition,
  planTransition,
  presetSettings,
  readCopy,
  previewSteps,
  requiresJoin,
  stepperView,
  validateSettings,
  validateStepOrder,
  type PaidAccessActor,
  type PaidAccessSettings,
  type PaidAccessStatus,
  type PaidAccessStep,
} from "../src/modules/paid-access/core";

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

const CTX = { onlinePaymentsAvailable: false };
const CTX_ONLINE = { onlinePaymentsAvailable: true };

/** A preset made valid: payment presets get a price, the form preset keeps its default question. */
function ready(id: (typeof PAID_ACCESS_PRESET_IDS)[number]): PaidAccessSettings {
  const s = presetSettings(id);
  return { ...s, payment: { ...s.payment, amountCents: 50000 } };
}
const withSteps = (steps: PaidAccessStep[]): PaidAccessSettings => ({
  ...ready("pay_then_approve"),
  steps,
  form: { questions: [{ id: "q1", label: "Why do you want to join?", kind: "long", required: true, options: [] }] },
});

const errorsOf = (r: ReturnType<typeof validateSettings>) => (r.ok ? [] : r.errors);
const CUSTOMER: PaidAccessActor = { kind: "customer", id: "cust_1" };
const ADMIN: PaidAccessActor = { kind: "admin", id: "owner" };
const SYSTEM: PaidAccessActor = { kind: "system", id: "system" };
const WEBHOOK: PaidAccessActor = { kind: "webhook", id: "fake" };

console.log("\nPresets");

test("there are exactly the five presets the store needs", () => {
  assert.deepStrictEqual([...PAID_ACCESS_PRESET_IDS], ["open", "pay_to_join", "pay_then_approve", "approve_then_pay", "apply_then_approve"]);
});

test("each preset has the step order it promises", () => {
  assert.deepStrictEqual(presetSettings("open").steps, []);
  assert.deepStrictEqual(presetSettings("pay_to_join").steps, ["payment"]);
  assert.deepStrictEqual(presetSettings("pay_then_approve").steps, ["payment", "approval"]);
  assert.deepStrictEqual(presetSettings("approve_then_pay").steps, ["approval", "payment"]);
  assert.deepStrictEqual(presetSettings("apply_then_approve").steps, ["form", "approval"]);
});

test("every preset validates once a price is set (payment presets)", () => {
  for (const id of PAID_ACCESS_PRESET_IDS) {
    const r = validateSettings(ready(id), CTX);
    assert.ok(r.ok, `${id}: ${JSON.stringify(errorsOf(r))}`);
  }
});

test("a payment preset without a price is refused with a readable message", () => {
  const r = validateSettings(presetSettings("pay_then_approve"), CTX);
  assert.ok(!r.ok);
  const e = errorsOf(r).find((x) => x.path === "payment.amountCents");
  assert.ok(e, "error points at the amount");
  assert.match(e!.message, /amount/i);
});

test("free presets need no price, and carry no refund", () => {
  for (const id of ["open", "apply_then_approve"] as const) {
    const s = presetSettings(id);
    assert.ok(validateSettings(s, CTX).ok, id);
    assert.strictEqual(s.refundOnReject, "none");
  }
});

test("the paid presets refund manually by default (online isn't connected)", () => {
  for (const id of ["pay_to_join", "pay_then_approve", "approve_then_pay"] as const) {
    assert.strictEqual(presetSettings(id).refundOnReject, "manual", id);
    assert.strictEqual(presetSettings(id).payment.method, "manual", id);
  }
});

test("the Open preset is OPEN_SETTINGS and needs no join at all", () => {
  assert.deepStrictEqual(presetSettings("open"), OPEN_SETTINGS);
  assert.strictEqual(requiresJoin(OPEN_SETTINGS), false);
});

test("Open with a slot limit still needs a (one-click) join to claim a slot", () => {
  assert.strictEqual(requiresJoin({ ...OPEN_SETTINGS, capacity: { maxSlots: 10, waitlist: false } }), true);
  assert.strictEqual(requiresJoin(ready("pay_to_join")), true);
});

test("picking a preset keeps the admin's fine-tuning (price, slots, dates, questions)", () => {
  const tuned: PaidAccessSettings = {
    ...ready("pay_then_approve"),
    payment: { amountMode: "deposit", amountCents: 99900, method: "manual", windowMinutes: 30 },
    capacity: { maxSlots: 40, waitlist: true },
    schedule: { opensAt: "2026-11-01T00:00:00.000Z", closesAt: "2026-11-10T00:00:00.000Z" },
  };
  const next = applyPreset("approve_then_pay", tuned);
  assert.deepStrictEqual(next.steps, ["approval", "payment"]);
  assert.deepStrictEqual(next.payment, tuned.payment);
  assert.deepStrictEqual(next.capacity, tuned.capacity);
  assert.deepStrictEqual(next.schedule, tuned.schedule);
  assert.deepStrictEqual(tuned.steps, ["payment", "approval"], "the input is not mutated");
});

test("picking a free preset after a paid one turns the refund off", () => {
  assert.strictEqual(applyPreset("open", ready("pay_then_approve")).refundOnReject, "none");
});

test("the form preset starts with one question so it is valid out of the box", () => {
  const s = presetSettings("apply_then_approve");
  assert.ok(s.form.questions.length >= 1);
});

test("detectPreset names each preset back, and anything else is custom", () => {
  for (const id of PAID_ACCESS_PRESET_IDS) assert.strictEqual(detectPreset(ready(id)), id);
  assert.strictEqual(detectPreset(withSteps(["form", "payment", "approval"])), "custom");
});

console.log("\nStep order");

const ALLOWED_ORDERS: PaidAccessStep[][] = [
  [],
  ["payment"],
  ["payment", "approval"],
  ["approval", "payment"],
  ["approval"],
  ["form"],
  ["form", "approval"],
  ["form", "payment"],
  ["form", "payment", "approval"],
  ["form", "approval", "payment"],
];

test("every sensible step order is accepted", () => {
  for (const steps of ALLOWED_ORDERS) {
    assert.strictEqual(validateStepOrder(steps), null, JSON.stringify(steps));
    const r = validateSettings(withSteps(steps), CTX);
    assert.ok(r.ok, `${JSON.stringify(steps)}: ${JSON.stringify(errorsOf(r))}`);
  }
});

test("a repeated step is refused", () => {
  assert.match(validateStepOrder(["payment", "payment"]) ?? "", /only once/i);
  assert.match(validateStepOrder(["approval", "payment", "approval"]) ?? "", /only once/i);
});

test("an application form after payment or approval is refused, with the reason", () => {
  for (const steps of [["payment", "form"], ["approval", "form"], ["payment", "approval", "form"]] as PaidAccessStep[][]) {
    assert.match(validateStepOrder(steps) ?? "", /form.*first/i, JSON.stringify(steps));
  }
});

test("unknown steps and too many steps are refused", () => {
  assert.match(validateStepOrder(["shipping" as PaidAccessStep]) ?? "", /unknown step/i);
  assert.ok(validateStepOrder(["form", "payment", "approval", "payment"]));
});

test("an invalid step order surfaces as a settings error on `steps`", () => {
  const r = validateSettings(withSteps(["payment", "form"]), CTX);
  assert.ok(!r.ok);
  assert.ok(errorsOf(r).some((e) => e.path === "steps"));
});

console.log("\nSettings rules");

test("online payment is refused while no provider is connected — and allowed once one is", () => {
  const s: PaidAccessSettings = { ...ready("pay_to_join"), payment: { ...ready("pay_to_join").payment, method: "online" } };
  const r = validateSettings(s, CTX);
  assert.ok(!r.ok);
  assert.match(errorsOf(r).find((e) => e.path === "payment.method")!.message, /online payments/i);
  assert.ok(validateSettings(s, CTX_ONLINE).ok);
  assert.ok(validateSettings({ ...s, payment: { ...s.payment, method: "either" } }, CTX_ONLINE).ok);
});

test("automatic refunds need online payments", () => {
  const s: PaidAccessSettings = { ...ready("pay_then_approve"), refundOnReject: "auto" };
  const r = validateSettings(s, CTX_ONLINE);
  assert.ok(!r.ok);
  assert.match(errorsOf(r).find((e) => e.path === "refundOnReject")!.message, /automatic refunds/i);
  assert.ok(validateSettings({ ...s, payment: { ...s.payment, method: "either" } }, CTX_ONLINE).ok);
});

test("a waitlist needs a slot limit", () => {
  const r = validateSettings({ ...ready("open"), capacity: { maxSlots: null, waitlist: true } }, CTX);
  assert.ok(!r.ok);
  assert.match(errorsOf(r).find((e) => e.path === "capacity.waitlist")!.message, /slot limit/i);
});

test("slot limits must be whole numbers from 1", () => {
  for (const maxSlots of [0, -3, 2.5]) {
    assert.ok(!validateSettings({ ...ready("open"), capacity: { maxSlots, waitlist: false } }, CTX).ok, String(maxSlots));
  }
  assert.ok(validateSettings({ ...ready("open"), capacity: { maxSlots: 1, waitlist: false } }, CTX).ok);
});

test("the close date must come after the open date", () => {
  const r = validateSettings(
    { ...ready("open"), schedule: { opensAt: "2026-11-10T00:00:00.000Z", closesAt: "2026-11-01T00:00:00.000Z" } },
    CTX,
  );
  assert.ok(!r.ok);
  assert.match(errorsOf(r).find((e) => e.path === "schedule.closesAt")!.message, /after/i);
});

test("the payment window is 5 minutes to 7 days, or off", () => {
  const base = ready("pay_to_join");
  for (const windowMinutes of [0, 4, 10081, 7.5]) {
    assert.ok(!validateSettings({ ...base, payment: { ...base.payment, windowMinutes } }, CTX).ok, String(windowMinutes));
  }
  for (const windowMinutes of [null, 5, 30, 10080]) {
    assert.ok(validateSettings({ ...base, payment: { ...base.payment, windowMinutes } }, CTX).ok, String(windowMinutes));
  }
});

test("a form step needs at least one question; a choice question needs two options", () => {
  const none = validateSettings({ ...withSteps(["form", "approval"]), form: { questions: [] } }, CTX);
  assert.ok(!none.ok);
  assert.ok(errorsOf(none).some((e) => e.path === "form.questions"));
  const choice = validateSettings(
    { ...withSteps(["form"]), form: { questions: [{ id: "q", label: "Size?", kind: "choice", required: true, options: ["S"] }] } },
    CTX,
  );
  assert.ok(!choice.ok);
});

test("form questions are ignored (not validated) when there is no form step", () => {
  assert.ok(validateSettings({ ...ready("pay_to_join"), form: { questions: [] } }, CTX).ok);
});

test("junk input is refused without throwing; unknown keys are dropped", () => {
  for (const junk of [null, 42, "x", [], { steps: "payment" }]) assert.ok(!validateSettings(junk, CTX).ok);
  const r = validateSettings({ ...ready("open"), hacker: true }, CTX);
  assert.ok(r.ok && !("hacker" in r.settings));
});

test("money is parsed digit-by-digit into centavos", () => {
  assert.deepStrictEqual(parseAmountCents("1,499.50"), { ok: true, value: 149950 });
  assert.deepStrictEqual(parseAmountCents("₱ 500"), { ok: true, value: 50000 });
  assert.deepStrictEqual(parseAmountCents(99.9), { ok: true, value: 9990 });
  for (const bad of ["0", "-5", "abc", "1.234", ""]) assert.ok(!parseAmountCents(bad).ok, bad);
});

console.log("\nState machine — status × status, per preset");

// Hand-written oracle: every edge a preset allows. Anything not listed is forbidden.
const EXPECTED: Record<string, { steps: PaidAccessStep[]; edges: string[] }> = {
  open: {
    steps: [],
    edges: ["waitlisted>active", "waitlisted>rejected", "waitlisted>cancelled", "active>revoked"],
  },
  pay_to_join: {
    steps: ["payment"],
    edges: [
      "waitlisted>payment_pending", "waitlisted>rejected", "waitlisted>cancelled",
      "payment_pending>payment_review", "payment_pending>active", "payment_pending>rejected", "payment_pending>expired", "payment_pending>cancelled",
      "payment_review>active", "payment_review>payment_pending", "payment_review>rejected",
      "active>revoked",
    ],
  },
  pay_then_approve: {
    steps: ["payment", "approval"],
    edges: [
      "waitlisted>payment_pending", "waitlisted>rejected", "waitlisted>cancelled",
      "payment_pending>payment_review", "payment_pending>approval_pending", "payment_pending>rejected", "payment_pending>expired", "payment_pending>cancelled",
      "payment_review>approval_pending", "payment_review>payment_pending", "payment_review>rejected",
      // already paid → no self-cancel (the store refunds through reject)
      "approval_pending>active", "approval_pending>rejected",
      "active>revoked",
    ],
  },
  approve_then_pay: {
    steps: ["approval", "payment"],
    edges: [
      "waitlisted>approval_pending", "waitlisted>rejected", "waitlisted>cancelled",
      "approval_pending>payment_pending", "approval_pending>rejected", "approval_pending>cancelled",
      "payment_pending>payment_review", "payment_pending>active", "payment_pending>rejected", "payment_pending>expired", "payment_pending>cancelled",
      "payment_review>active", "payment_review>payment_pending", "payment_review>rejected",
      "active>revoked",
    ],
  },
  apply_then_approve: {
    steps: ["form", "approval"],
    edges: [
      "waitlisted>form_pending", "waitlisted>rejected", "waitlisted>cancelled",
      "form_pending>approval_pending", "form_pending>rejected", "form_pending>cancelled",
      "approval_pending>active", "approval_pending>rejected", "approval_pending>cancelled",
      "active>revoked",
    ],
  },
  form_pay_approve: {
    steps: ["form", "payment", "approval"],
    edges: [
      "waitlisted>form_pending", "waitlisted>rejected", "waitlisted>cancelled",
      "form_pending>payment_pending", "form_pending>rejected", "form_pending>cancelled",
      "payment_pending>payment_review", "payment_pending>approval_pending", "payment_pending>rejected", "payment_pending>expired", "payment_pending>cancelled",
      "payment_review>approval_pending", "payment_review>payment_pending", "payment_review>rejected",
      "approval_pending>active", "approval_pending>rejected",
      "active>revoked",
    ],
  },
};

for (const [name, { steps, edges }] of Object.entries(EXPECTED)) {
  test(`${name}: exactly the expected ${edges.length} of ${PAID_ACCESS_STATUSES.length ** 2} edges are allowed`, () => {
    const snapshot = withSteps(steps);
    const allowed = new Set(edges);
    for (const from of PAID_ACCESS_STATUSES) {
      for (const to of PAID_ACCESS_STATUSES) {
        const key = `${from}>${to}`;
        assert.strictEqual(edgeAllowed(from, to, snapshot), allowed.has(key), `${key} should be ${allowed.has(key) ? "allowed" : "forbidden"}`);
      }
    }
  });
}

test("a new member starts at the preset's first step (Open = straight in)", () => {
  assert.strictEqual(firstStatus([]), "active");
  assert.strictEqual(firstStatus(["payment", "approval"]), "payment_pending");
  assert.strictEqual(firstStatus(["approval", "payment"]), "approval_pending");
  assert.strictEqual(firstStatus(["form", "approval"]), "form_pending");
});

test("terminal statuses go nowhere", () => {
  for (const from of ["rejected", "expired", "cancelled", "revoked"] as PaidAccessStatus[]) {
    for (const to of PAID_ACCESS_STATUSES) assert.strictEqual(edgeAllowed(from, to, ready("pay_then_approve")), false, `${from}>${to}`);
  }
});

console.log("\nState machine — events and actors");

const PTA = ready("pay_then_approve");
const ATP = ready("approve_then_pay");
const plan = (from: PaidAccessStatus, event: Parameters<typeof planTransition>[0]["event"], actor: PaidAccessActor, snapshot = PTA, extra = {}) =>
  planTransition({ from, event, actor, snapshot, ...extra });

test("pay then approve walks payment → review → approval → active", () => {
  const a = plan("payment_pending", "submit_proof", CUSTOMER);
  assert.ok(a.ok && a.to === "payment_review");
  const b = plan("payment_review", "confirm_proof", ADMIN);
  assert.ok(b.ok && b.to === "approval_pending");
  const c = plan("approval_pending", "approve", ADMIN);
  assert.ok(c.ok && c.to === "active");
});

test("pay to join: a confirmed payment is access — no approval stop", () => {
  const r = plan("payment_review", "confirm_proof", ADMIN, ready("pay_to_join"));
  assert.ok(r.ok && r.to === "active");
  const w = plan("payment_pending", "payment_succeeded", WEBHOOK, ready("pay_to_join"));
  assert.ok(w.ok && w.to === "active");
});

test("approve then pay: no paying before approval; approval opens the payment step", () => {
  const early = plan("approval_pending", "submit_proof", CUSTOMER, ATP);
  assert.ok(!early.ok);
  assert.match(early.error, /approv/i);
  const ok = plan("approval_pending", "approve", ADMIN, ATP);
  assert.ok(ok.ok && ok.to === "payment_pending");
  const paid = plan("payment_review", "confirm_proof", ADMIN, ATP);
  assert.ok(paid.ok && paid.to === "active");
});

test("a customer can never approve, reject, confirm a payment or revoke — not even their own", () => {
  for (const [from, event] of [
    ["approval_pending", "approve"],
    ["approval_pending", "reject"],
    ["payment_review", "confirm_proof"],
    ["payment_review", "reject_proof"],
    ["active", "revoke"],
  ] as const) {
    const r = plan(from, event, CUSTOMER, PTA, { reason: "x" });
    assert.ok(!r.ok, `${event} by customer`);
    assert.match(r.error, /admin/i);
  }
});

test("an admin cannot review their own membership", () => {
  const r = plan("approval_pending", "approve", ADMIN, PTA, { selfReview: true });
  assert.ok(!r.ok);
  assert.match(r.error, /your own/i);
});

test("only the payment provider's verified webhook can mark an online payment paid", () => {
  assert.ok(!plan("payment_pending", "payment_succeeded", CUSTOMER).ok);
  assert.ok(!plan("payment_pending", "payment_succeeded", ADMIN).ok);
  assert.ok(plan("payment_pending", "payment_succeeded", WEBHOOK).ok);
});

test("rejecting, rejecting a proof and revoking need a reason", () => {
  assert.ok(!plan("approval_pending", "reject", ADMIN).ok);
  assert.ok(!plan("payment_review", "reject_proof", ADMIN, PTA, { reason: "   " }).ok);
  assert.ok(!plan("active", "revoke", ADMIN).ok);
  const r = plan("payment_review", "reject_proof", ADMIN, PTA, { reason: "Blurry receipt" });
  assert.ok(r.ok && r.to === "payment_pending");
});

test("expiry is the system's, only for an unpaid payment step", () => {
  assert.ok(plan("payment_pending", "expire", SYSTEM).ok);
  assert.ok(!plan("payment_pending", "expire", CUSTOMER).ok);
  assert.ok(!plan("payment_review", "expire", SYSTEM).ok, "a submitted proof is never expired");
});

test("a member who already paid cannot cancel themselves out", () => {
  const r = plan("approval_pending", "cancel", CUSTOMER);
  assert.ok(!r.ok);
  assert.ok(plan("payment_pending", "cancel", CUSTOMER).ok);
  assert.ok(plan("approval_pending", "cancel", CUSTOMER, ATP).ok, "approve-then-pay: nothing paid yet");
});

test("an event from the wrong status is refused with a readable message, never a throw", () => {
  const r = plan("active", "approve", ADMIN);
  assert.ok(!r.ok);
  assert.match(r.error, /can't|cannot/i);
  const junk = planTransition({ from: "bogus" as PaidAccessStatus, event: "approve", actor: ADMIN, snapshot: PTA });
  assert.ok(!junk.ok);
});

console.log("\nRefunds");

test("refund policy on reject: none / manual / auto (online) / auto falls back for manual proofs", () => {
  assert.strictEqual(planRefund("none", { paid: true, provider: "manual" }), "not_applicable");
  assert.strictEqual(planRefund("manual", { paid: true, provider: "manual" }), "pending");
  assert.strictEqual(planRefund("auto", { paid: true, provider: "online" }), "processing");
  assert.strictEqual(planRefund("auto", { paid: true, provider: "manual" }), "pending");
  assert.strictEqual(planRefund("manual", { paid: false, provider: null }), "not_applicable");
});

test("refund statuses only move forward, and marking refunded needs a reference", () => {
  assert.ok(planRefundTransition({ from: "pending", to: "refunded", actor: ADMIN, reference: "GC-123" }).ok);
  assert.ok(!planRefundTransition({ from: "pending", to: "refunded", actor: ADMIN, reference: "" }).ok);
  assert.ok(!planRefundTransition({ from: "pending", to: "refunded", actor: CUSTOMER, reference: "GC-1" }).ok);
  assert.ok(planRefundTransition({ from: "processing", to: "refunded", actor: WEBHOOK }).ok);
  assert.ok(planRefundTransition({ from: "processing", to: "pending", actor: WEBHOOK }).ok);
  assert.ok(!planRefundTransition({ from: "refunded", to: "pending", actor: ADMIN }).ok);
  assert.ok(!planRefundTransition({ from: "not_applicable", to: "refunded", actor: ADMIN, reference: "x1234" }).ok);
});

console.log("\nCustomer input");

test("proof: reference + method + paid-at; any amount the client sends is dropped", () => {
  const r = parseProofSubmission({ reference: "GC 1234-5678", method: "GCash", paidAt: "2026-10-26T01:00:00Z", amountCents: 1 });
  assert.ok(r.ok);
  assert.ok(!("amountCents" in r.value));
  assert.ok(!parseProofSubmission({ reference: "12" }).ok);
  assert.ok(!parseProofSubmission({ reference: "<script>" }).ok);
});

test("form answers: required questions, length caps, choices must be one of the options", () => {
  const qs = [
    { id: "why", label: "Why?", kind: "long" as const, required: true, options: [] },
    { id: "size", label: "Size", kind: "choice" as const, required: false, options: ["S", "M"] },
  ];
  assert.ok(!parseFormAnswers(qs, {}).ok);
  assert.ok(!parseFormAnswers(qs, { why: "ok", size: "XL" }).ok);
  const r = parseFormAnswers(qs, { why: "  I run a clinic  ", size: "M", extra: "dropped" });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.value, { why: "I run a clinic", size: "M" });
  assert.ok(!parseFormAnswers(qs, { why: "x".repeat(2001) }).ok);
});

console.log("\nWhat the customer sees");

test("the stepper says where they are: 'Step 2 of 3: Waiting for admin approval'", () => {
  const v = stepperView(withSteps(["form", "payment", "approval"]), "approval_pending", { amountLabel: "₱500.00" });
  assert.strictEqual(v.headline, "Step 3 of 3: Waiting for admin approval");
  const p = stepperView(withSteps(["payment", "approval"]), "approval_pending", { amountLabel: "₱500.00" });
  assert.strictEqual(p.headline, "Step 2 of 2: Waiting for admin approval");
  assert.deepStrictEqual(p.steps.map((s) => s.state), ["done", "current"]);
  assert.strictEqual(p.action, null);
});

test("the action button matches the next step", () => {
  assert.strictEqual(stepperView(ready("pay_then_approve"), "payment_pending", { amountLabel: "₱500.00" }).action?.kind, "pay");
  assert.strictEqual(stepperView(withSteps(["form", "approval"]), "form_pending", { amountLabel: "" }).action?.kind, "fill_form");
  assert.strictEqual(stepperView(ready("pay_then_approve"), null, { amountLabel: "₱500.00" }).action?.kind, "join");
  assert.strictEqual(stepperView(ready("pay_then_approve"), "active", { amountLabel: "" }).action, null);
  assert.strictEqual(stepperView(ready("pay_then_approve"), "expired", { amountLabel: "" }).action?.kind, "join");
});

test("payment review, waitlist, rejection and expiry each have their own copy", () => {
  const ctx = { amountLabel: "₱500.00", reason: "Wrong amount" };
  assert.match(stepperView(PTA, "payment_review", ctx).headline, /checking your payment/i);
  assert.match(stepperView(PTA, "waitlisted", ctx).headline, /waitlist/i);
  assert.match(stepperView(PTA, "rejected", ctx).headline, /Wrong amount/);
  assert.match(stepperView(PTA, "expired", ctx).headline, /expired|released/i);
  assert.strictEqual(stepperView(PTA, "active", ctx).tone, "success");
});

test("Open needs no screens: an active member sees no steps", () => {
  const v = stepperView(OPEN_SETTINGS, "active", { amountLabel: "" });
  assert.strictEqual(v.steps.length, 0);
  assert.strictEqual(v.action, null);
});

test("the admin's live preview lists the steps in order, ending in access", () => {
  assert.deepStrictEqual(previewSteps(ready("approve_then_pay"), "₱500.00"), ["Admin approval", "Pay ₱500.00", "Access"]);
  assert.deepStrictEqual(previewSteps(OPEN_SETTINGS, ""), ["Access"]);
});

console.log("\nJoin page text (copy)");

test("settings saved before copy existed still validate, with blank copy", () => {
  const { copy: _drop, ...old } = ready("pay_then_approve");
  const r = validateSettings(old, CTX);
  assert.ok(r.ok, JSON.stringify(errorsOf(r)));
  assert.deepStrictEqual(r.settings.copy, EMPTY_COPY);
});

test("copy is trimmed, and too-long text is refused on its own field", () => {
  const base = ready("pay_then_approve");
  const ok = validateSettings({ ...base, copy: { ...base.copy, button: "  Join the batch  " } }, CTX);
  assert.ok(ok.ok);
  assert.strictEqual(ok.settings.copy.button, "Join the batch");
  const long = validateSettings({ ...base, copy: { ...base.copy, button: "x".repeat(COPY_LIMITS.button + 1) } }, CTX);
  assert.ok(!long.ok);
  assert.ok(errorsOf(long).some((e) => e.path === "copy.button"), JSON.stringify(errorsOf(long)));
});

test("copy never changes a rule: the same steps, price and gate either way", () => {
  const base = ready("pay_then_approve");
  const worded = { ...base, copy: { ...base.copy, intro: "Hi", steps: { ...base.copy.steps, approval: "We check you" } } };
  const a = validateSettings(base, CTX);
  const b = validateSettings(worded, CTX);
  assert.ok(a.ok && b.ok);
  assert.deepStrictEqual({ ...b.settings, copy: a.settings.copy }, a.settings);
  assert.strictEqual(requiresJoin(b.settings), requiresJoin(a.settings));
});

test("step names: the store's own, {amount} filled in, blanks keep the built-in", () => {
  const copy = { ...EMPTY_COPY, steps: { form: "", payment: "Send {amount}", approval: "", access: "You're in" } };
  assert.deepStrictEqual(previewSteps({ steps: ["payment", "approval"], copy }, "₱100"), ["Send ₱100", "Admin approval", "You're in"]);
  assert.deepStrictEqual(previewSteps({ steps: ["payment", "approval"] }, "₱100"), ["Pay ₱100", "Admin approval", "Access"]);
  const view = stepperView({ steps: ["payment", "approval"] }, "payment_pending", { amountLabel: "₱100", copy });
  assert.deepStrictEqual(view.steps.map((s) => s.label), ["Send ₱100", "Admin approval"]);
  assert.strictEqual(view.accessLabel, "You're in");
  assert.strictEqual(stepperView({ steps: ["approval"] }, null, { amountLabel: "" }).accessLabel, "Access");
});

test("a stored row with junk copy reads back as safe, bounded strings", () => {
  const c = readCopy({ intro: 42, button: "x".repeat(500), steps: { payment: ["no"] } });
  assert.strictEqual(c.intro, "");
  assert.strictEqual(c.button.length, COPY_LIMITS.button);
  assert.strictEqual(c.steps.payment, "");
  assert.deepStrictEqual(readCopy(undefined), EMPTY_COPY);
});

test("switching presets keeps what the store typed", () => {
  const base = ready("pay_then_approve");
  const worded = { ...base, copy: { ...base.copy, button: "Join the batch" } };
  assert.strictEqual(applyPreset("apply_then_approve", worded).copy.button, "Join the batch");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
