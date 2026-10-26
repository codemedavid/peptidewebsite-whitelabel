import "server-only";

// The store admin's half: check proofs, approve, reject (with the snapshot's
// refund policy), mark refunds done, revoke, and the review queue. Callers
// pass the ADMIN they authenticated; anything else (a customer, junk) is
// refused here as well, and an admin is never allowed to review their own
// membership. Every write is conditional on the status that was read.

import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import { planTransition, type PaidAccessEvent } from "../core/machine";
import { planRefund, planRefundTransition } from "../core/refund";
import type { PaidAccessRefundStatus, PaidAccessStatus } from "../core/types";
import { asAdmin, currencyOf, fail, ID_RE, later, money, sameEmail, storeConfig, type Admin, type Fail } from "./context";
import { notifyMember, type MemberNotice } from "./notify";
import { providerByName, receiptUrl } from "./payments";
import {
  countByStatus,
  duplicateReferences,
  historyOf,
  listMemberships,
  lockFlow,
  logEvents,
  membershipById,
  moveMembership,
  movePayment,
  paymentById,
  paymentsOf,
  readSettings,
  type EventInput,
  type MembershipRow,
  type PaymentRow,
} from "./repo";
import { holdFor, settleSlots } from "./slots";

type Ok = { ok: true; membershipId: string; status: PaidAccessStatus };
export type DecisionResult = Ok | Fail;

const NOT_ADMIN = fail("forbidden", "Only a store admin can do that.");
const NOT_FOUND = fail("not_found", "We couldn't find that member.");
const RACED = fail("conflict", "That changed just now — please refresh.");

/** Thrown inside a transaction to roll it back with a readable refusal. */
class Refusal extends Error {
  constructor(readonly result: Fail) {
    super(result.message);
  }
}

type Effects = { notices: { id: string; notice: MemberNotice }[]; refund?: { provider: string; ref: string; amountCents: number; membershipId: string } };

async function run(tenantId: string, body: (db: TenantTx, effects: Effects) => Promise<Ok>): Promise<DecisionResult> {
  const effects: Effects = { notices: [] };
  let result: Ok;
  try {
    result = await withTenant(tenantId, (db) => body(db, effects));
  } catch (e) {
    if (e instanceof Refusal) return e.result;
    throw e;
  }
  if (effects.refund) await requestProviderRefund(tenantId, effects.refund);
  for (const n of effects.notices) later(() => notifyMember(tenantId, n.id, n.notice));
  return result;
}

const NO_EMAIL = fail("forbidden", "Your admin account needs an email address before it can review members.");

/** Self-review is matched by email, so an admin without one can't prove they
 *  aren't the member — refuse (fail closed). */
function refuseSelfReview(m: MembershipRow, admin: Admin): void {
  if (!admin.email.trim()) throw new Refusal(NO_EMAIL);
  if (sameEmail(admin.email, m.customerEmail)) {
    throw new Refusal(fail("forbidden", "You can't review your own membership — ask another admin."));
  }
}

/** Plan an admin event on a membership, refusing self-review. */
function planAdmin(m: MembershipRow, event: PaidAccessEvent, admin: Admin, reason?: unknown) {
  if (!admin.email.trim()) throw new Refusal(NO_EMAIL);
  const plan = planTransition({
    from: m.status as PaidAccessStatus,
    event,
    actor: { kind: "admin", id: admin.id },
    snapshot: readSettings(m.settingsSnapshot),
    reason,
    selfReview: sameEmail(admin.email, m.customerEmail),
  });
  if (!plan.ok) throw new Refusal(fail(/your own/i.test(plan.error) ? "forbidden" : "conflict", plan.error));
  return plan;
}

async function loadMember(db: TenantTx, membershipId: unknown): Promise<MembershipRow> {
  if (typeof membershipId !== "string" || !ID_RE.test(membershipId)) throw new Refusal(NOT_FOUND);
  const m = await membershipById(db, membershipId);
  if (!m) throw new Refusal(NOT_FOUND);
  return m;
}

const event = (m: MembershipRow, admin: Admin, e: Partial<EventInput> & Pick<EventInput, "kind">): EventInput => ({
  groupBuyId: m.groupBuyId,
  membershipId: m.id,
  actorKind: "admin",
  actorId: admin.id,
  ...e,
});

type Input = { tenantId: string; membershipId: unknown; admin: unknown; now?: Date };

export async function approve(input: Input): Promise<DecisionResult> {
  const admin = asAdmin(input.admin);
  if (!admin) return NOT_ADMIN;
  const now = input.now ?? new Date();
  return run(input.tenantId, async (db, effects) => {
    const m = await loadMember(db, input.membershipId);
    const plan = planAdmin(m, "approve", admin);
    const snapshot = readSettings(m.settingsSnapshot);
    if (!(await moveMembership(db, m.id, "approval_pending", { status: plan.to, decidedAt: now, decidedBy: admin.id, holdExpiresAt: holdFor(snapshot, plan.to, now) }))) {
      throw new Refusal(RACED);
    }
    await logEvents(db, input.tenantId, [event(m, admin, { kind: "transition", fromStatus: m.status, toStatus: plan.to })]);
    effects.notices.push({ id: m.id, notice: "approved" });
    return { ok: true, membershipId: m.id, status: plan.to };
  });
}

/** The money a rejected member may be owed: a confirmed payment, else a proof still under review. */
function moneyIn(payments: PaymentRow[]): PaymentRow | null {
  return payments.find((p) => p.status === "confirmed") ?? payments.find((p) => p.status === "submitted") ?? null;
}

export async function reject(input: Input & { reason: unknown }): Promise<DecisionResult> {
  const admin = asAdmin(input.admin);
  if (!admin) return NOT_ADMIN;
  const now = input.now ?? new Date();
  return run(input.tenantId, async (db, effects) => {
    const m = await loadMember(db, input.membershipId);
    const plan = planAdmin(m, "reject", admin, input.reason);
    const snapshot = readSettings(m.settingsSnapshot);
    await lockFlow(db, m.flowId);
    const paid = moneyIn(await paymentsOf(db, m.id));
    const provider = paid ? (paid.provider === "manual" ? "manual" : "online") : null;
    const refundStatus: PaidAccessRefundStatus = planRefund(snapshot.refundOnReject, { paid: !!paid, provider });
    if (paid?.status === "submitted") await movePayment(db, paid.id, "submitted", { status: "rejected", rejectReason: plan.reason });
    if (!(await moveMembership(db, m.id, m.status as PaidAccessStatus, {
      status: "rejected",
      reviewReason: plan.reason,
      decidedAt: now,
      decidedBy: admin.id,
      holdExpiresAt: null,
      refundStatus,
    }))) {
      throw new Refusal(RACED);
    }
    await logEvents(db, input.tenantId, [
      event(m, admin, { kind: "transition", fromStatus: m.status, toStatus: "rejected", reason: plan.reason }),
      event(m, admin, { kind: "refund", fromStatus: "none", toStatus: refundStatus, data: { policy: snapshot.refundOnReject, paymentId: paid?.id ?? null } }),
    ]);
    const { promoted } = await settleSlots(db, input.tenantId, m.groupBuyId, m.flowId, now);
    effects.notices.push({ id: m.id, notice: "rejected" }, ...promoted.map((id) => ({ id, notice: "promoted" as const })));
    if (refundStatus === "processing" && paid?.providerRef) {
      effects.refund = { provider: paid.provider, ref: paid.providerRef, amountCents: paid.amountCents, membershipId: m.id };
    }
    return { ok: true, membershipId: m.id, status: "rejected" };
  });
}

/** Auto refund: ask the provider. If it refuses, the refund falls back to the admin. */
async function requestProviderRefund(tenantId: string, r: NonNullable<Effects["refund"]>): Promise<void> {
  const provider = providerByName(r.provider);
  const res = provider ? await provider.refund({ ref: r.ref, amountCents: r.amountCents }).catch(() => ({ ok: false as const, error: "provider error" })) : { ok: false as const, error: "provider not connected" };
  if (res.ok) return;
  await withTenant(tenantId, async (db) => {
    const m = await membershipById(db, r.membershipId);
    if (!m || m.refundStatus !== "processing") return;
    await moveMembership(db, m.id, "rejected", { refundStatus: "pending" });
    await logEvents(db, tenantId, [
      { groupBuyId: m.groupBuyId, membershipId: m.id, kind: "refund", fromStatus: "processing", toStatus: "pending", actorKind: "system", actorId: "system", reason: `Automatic refund failed (${res.error}) — refund manually` },
    ]);
  });
}

export async function markRefunded(input: Input & { reference: unknown }): Promise<DecisionResult> {
  const admin = asAdmin(input.admin);
  if (!admin) return NOT_ADMIN;
  const now = input.now ?? new Date();
  return run(input.tenantId, async (db, effects) => {
    const m = await loadMember(db, input.membershipId);
    refuseSelfReview(m, admin);
    const plan = planRefundTransition({ from: m.refundStatus as PaidAccessRefundStatus, to: "refunded", actor: { kind: "admin", id: admin.id }, reference: input.reference });
    if (!plan.ok) throw new Refusal(fail(/reference/i.test(plan.error) ? "invalid_input" : "conflict", plan.error));
    if (m.status !== "rejected") throw new Refusal(fail("conflict", "Only a rejected member can be refunded."));
    if (!(await moveMembership(db, m.id, "rejected", { refundStatus: "refunded", refundReference: plan.reference, refundedAt: now }))) {
      throw new Refusal(RACED);
    }
    const confirmed = (await paymentsOf(db, m.id)).find((p) => p.status === "confirmed");
    if (confirmed) await movePayment(db, confirmed.id, "confirmed", { status: "refunded" });
    await logEvents(db, input.tenantId, [event(m, admin, { kind: "refund", fromStatus: m.refundStatus, toStatus: "refunded", data: { reference: plan.reference } })]);
    effects.notices.push({ id: m.id, notice: "refunded" });
    return { ok: true, membershipId: m.id, status: "rejected" };
  });
}

export async function revoke(input: Input & { reason: unknown }): Promise<DecisionResult> {
  const admin = asAdmin(input.admin);
  if (!admin) return NOT_ADMIN;
  const now = input.now ?? new Date();
  return run(input.tenantId, async (db, effects) => {
    const m = await loadMember(db, input.membershipId);
    const plan = planAdmin(m, "revoke", admin, input.reason);
    await lockFlow(db, m.flowId);
    if (!(await moveMembership(db, m.id, "active", { status: "revoked", reviewReason: plan.reason, decidedAt: now, decidedBy: admin.id }))) {
      throw new Refusal(RACED);
    }
    await logEvents(db, input.tenantId, [event(m, admin, { kind: "transition", fromStatus: "active", toStatus: "revoked", reason: plan.reason })]);
    const { promoted } = await settleSlots(db, input.tenantId, m.groupBuyId, m.flowId, now);
    effects.notices.push({ id: m.id, notice: "revoked" }, ...promoted.map((id) => ({ id, notice: "promoted" as const })));
    return { ok: true, membershipId: m.id, status: "revoked" };
  });
}

// ── Manual proofs ────────────────────────────────────────────────────────────

type PaymentInput = { tenantId: string; paymentId: unknown; admin: unknown; now?: Date };

async function loadProof(db: TenantTx, paymentId: unknown): Promise<{ p: PaymentRow; m: MembershipRow }> {
  if (typeof paymentId !== "string" || !ID_RE.test(paymentId)) throw new Refusal(fail("not_found", "We couldn't find that payment."));
  const p = await paymentById(db, paymentId);
  if (!p) throw new Refusal(fail("not_found", "We couldn't find that payment."));
  if (p.provider !== "manual") throw new Refusal(fail("forbidden", "Online payments are confirmed by the payment provider, not by hand."));
  if (p.status !== "submitted") throw new Refusal(fail("conflict", "This payment was already checked."));
  const m = await membershipById(db, p.membershipId);
  if (!m) throw new Refusal(NOT_FOUND);
  return { p, m };
}

/** The admin checked a proof and the money is there. Pay-then-approve can approve in the same step. */
export async function confirmPayment(input: PaymentInput & { alsoApprove?: boolean }): Promise<DecisionResult> {
  const admin = asAdmin(input.admin);
  if (!admin) return NOT_ADMIN;
  const now = input.now ?? new Date();
  return run(input.tenantId, async (db, effects) => {
    const { p, m } = await loadProof(db, input.paymentId);
    const plan = planAdmin(m, "confirm_proof", admin);
    const snapshot = readSettings(m.settingsSnapshot);
    if (!(await movePayment(db, p.id, "submitted", { status: "confirmed", confirmedAt: now, confirmedBy: admin.id }))) throw new Refusal(RACED);
    if (!(await moveMembership(db, m.id, "payment_review", { status: plan.to, holdExpiresAt: holdFor(snapshot, plan.to, now) }))) throw new Refusal(RACED);
    const events = [event(m, admin, { kind: "payment", fromStatus: "payment_review", toStatus: plan.to, data: { paymentId: p.id } })];
    let status = plan.to;
    if (input.alsoApprove && plan.to === "approval_pending") {
      const approval = planAdmin({ ...m, status: "approval_pending" }, "approve", admin);
      if (!(await moveMembership(db, m.id, "approval_pending", { status: approval.to, decidedAt: now, decidedBy: admin.id, holdExpiresAt: holdFor(snapshot, approval.to, now) }))) {
        throw new Refusal(RACED);
      }
      events.push(event(m, admin, { kind: "transition", fromStatus: "approval_pending", toStatus: approval.to }));
      status = approval.to;
    }
    await logEvents(db, input.tenantId, events);
    effects.notices.push({ id: m.id, notice: status !== plan.to ? "approved" : "paid" });
    return { ok: true, membershipId: m.id, status };
  });
}

/** The proof doesn't check out: back to the payment step with a reason (and a fresh window). */
export async function rejectPayment(input: PaymentInput & { reason: unknown }): Promise<DecisionResult> {
  const admin = asAdmin(input.admin);
  if (!admin) return NOT_ADMIN;
  const now = input.now ?? new Date();
  return run(input.tenantId, async (db, effects) => {
    const { p, m } = await loadProof(db, input.paymentId);
    const plan = planAdmin(m, "reject_proof", admin, input.reason);
    const snapshot = readSettings(m.settingsSnapshot);
    if (!(await movePayment(db, p.id, "submitted", { status: "rejected", rejectReason: plan.reason }))) throw new Refusal(RACED);
    if (!(await moveMembership(db, m.id, "payment_review", { status: "payment_pending", holdExpiresAt: holdFor(snapshot, "payment_pending", now) }))) {
      throw new Refusal(RACED);
    }
    await logEvents(db, input.tenantId, [event(m, admin, { kind: "payment", fromStatus: "payment_review", toStatus: "payment_pending", reason: plan.reason, data: { paymentId: p.id } })]);
    effects.notices.push({ id: m.id, notice: "proof_rejected" });
    return { ok: true, membershipId: m.id, status: "payment_pending" };
  });
}

// ── The queue ────────────────────────────────────────────────────────────────

export type QueueTab = "payments" | "approvals" | "refunds" | "waitlist" | "all";

export type QueueRow = {
  id: string;
  groupBuyId: string;
  customerName: string;
  customerEmail: string;
  status: string;
  refundStatus: string;
  refundReference: string;
  reviewReason: string;
  steps: string[];
  settingsVersion: number;
  createdAt: string;
  holdExpiresAt: string | null;
  formAnswers: { question: string; answer: string }[];
  payment: {
    id: string;
    provider: string;
    status: string;
    amountCents: number;
    amountLabel: string;
    kind: string;
    reference: string;
    method: string;
    paidAt: string | null;
    submittedAt: string | null;
    hasReceipt: boolean;
    duplicateReference: boolean;
  } | null;
};

export type QueueCounts = { payments: number; approvals: number; refunds: number; waitlist: number; active: number; total: number };

const TAB_FILTER: Record<QueueTab, { statuses?: PaidAccessStatus[]; refundStatuses?: string[] }> = {
  payments: { statuses: ["payment_review"] },
  approvals: { statuses: ["approval_pending"] },
  refunds: { refundStatuses: ["pending", "processing"] },
  waitlist: { statuses: ["waitlisted"] },
  all: {},
};

const QUEUE_LIMIT = 200;

export async function listQueue(input: { tenantId: string; groupBuyId?: unknown; tab?: unknown }): Promise<{ ok: true; rows: QueueRow[]; counts: QueueCounts } | Fail> {
  const tab: QueueTab = typeof input.tab === "string" && input.tab in TAB_FILTER ? (input.tab as QueueTab) : "all";
  const groupBuyId = typeof input.groupBuyId === "string" && ID_RE.test(input.groupBuyId) ? input.groupBuyId : undefined;
  if (input.groupBuyId !== undefined && input.groupBuyId !== "" && !groupBuyId) return fail("invalid_input", "Unknown group buy.");
  const currency = currencyOf(await storeConfig(input.tenantId));
  return withTenant(input.tenantId, async (db) => {
    const rows = await listMemberships(db, { groupBuyId, ...TAB_FILTER[tab] }, QUEUE_LIMIT);
    const dupes = await duplicateReferences(db, rows.flatMap((r) => r.payments.map((p) => p.reference)));
    const counts = await countByStatus(db, groupBuyId);
    const n = (pred: (c: { status: string; refundStatus: string }) => boolean) => counts.filter(pred).reduce((s, c) => s + c.n, 0);
    return {
      ok: true as const,
      rows: rows.map((r): QueueRow => {
        const snapshot = readSettings(r.settingsSnapshot);
        const answers = (r.formAnswers ?? {}) as Record<string, string>;
        const p = r.payments.find((x) => x.status === "submitted") ?? r.payments.find((x) => x.status === "confirmed") ?? r.payments[0] ?? null;
        return {
          id: r.id,
          groupBuyId: r.groupBuyId,
          customerName: r.customerName,
          customerEmail: r.customerEmail,
          status: r.status,
          refundStatus: r.refundStatus,
          refundReference: r.refundReference,
          reviewReason: r.reviewReason,
          steps: snapshot.steps,
          settingsVersion: r.settingsVersion,
          createdAt: r.createdAt.toISOString(),
          holdExpiresAt: r.holdExpiresAt?.toISOString() ?? null,
          formAnswers: snapshot.form.questions.filter((q) => answers[q.id]).map((q) => ({ question: q.label, answer: answers[q.id] })),
          payment: p
            ? {
                id: p.id,
                provider: p.provider,
                status: p.status,
                amountCents: p.amountCents,
                amountLabel: money(currency, p.amountCents),
                kind: p.kind,
                reference: p.reference,
                method: p.method,
                paidAt: p.paidAt?.toISOString() ?? null,
                submittedAt: p.submittedAt?.toISOString() ?? null,
                hasReceipt: !!p.receiptFilePath,
                duplicateReference: !!p.reference && dupes.has(p.reference),
              }
            : null,
        };
      }),
      counts: {
        payments: n((c) => c.status === "payment_review"),
        approvals: n((c) => c.status === "approval_pending"),
        refunds: n((c) => c.refundStatus === "pending" || c.refundStatus === "processing"),
        waitlist: n((c) => c.status === "waitlisted"),
        active: n((c) => c.status === "active"),
        total: n(() => true),
      },
    };
  });
}

/** A 10-minute signed link to a payment's proof (store admins only — the caller gates). */
export async function adminReceiptUrl(input: { tenantId: string; paymentId: unknown }): Promise<{ ok: true; url: string } | Fail> {
  if (typeof input.paymentId !== "string" || !ID_RE.test(input.paymentId)) return fail("not_found", "No proof on file.");
  const id = input.paymentId;
  const p = await withTenant(input.tenantId, (db) => paymentById(db, id));
  return p?.receiptFilePath ? { ok: true, url: receiptUrl(p.receiptFilePath) } : fail("not_found", "No proof on file.");
}

export type HistoryEvent = {
  kind: string;
  membershipId: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  actorKind: string;
  actorId: string | null;
  reason: string;
  data: unknown;
  createdAt: string;
};

/** The audit log for a round or one member, oldest first. */
export async function history(input: { tenantId: string; groupBuyId?: unknown; membershipId?: unknown }): Promise<{ ok: true; events: HistoryEvent[] } | Fail> {
  const valid = (v: unknown) => (typeof v === "string" && ID_RE.test(v) ? v : undefined);
  const groupBuyId = valid(input.groupBuyId);
  const membershipId = valid(input.membershipId);
  if (!groupBuyId && !membershipId) return fail("invalid_input", "Pick a group buy or a member.");
  const rows = await withTenant(input.tenantId, (db) => historyOf(db, { ...(groupBuyId ? { groupBuyId } : {}), ...(membershipId ? { membershipId } : {}) }));
  return { ok: true, events: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
}
