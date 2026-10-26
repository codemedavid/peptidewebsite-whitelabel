import "server-only";

// Paid Access's data access — the ONLY file that names the paid_access_* tables
// (npm run test:paid-access-boundary fails the build otherwise). Every function
// takes the tenant-scoped transaction it runs in; the service decides WHAT to
// write, this file only knows HOW. Status writes are conditional on the
// status the caller read (`moveMembership(…, from)`), so a double click or a
// racing admin turns into "0 rows" instead of a second transition.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { TenantTx } from "@/lib/db/tenant-client";
import { readCopy } from "../core/copy";
import { OPEN_SETTINGS } from "../core/presets";
import { PAID_ACCESS_TERMINAL_STATUSES, type PaidAccessSettings, type PaidAccessStatus } from "../core/types";

export const MEMBERSHIP_SELECT = {
  id: true,
  flowId: true,
  groupBuyId: true,
  customerId: true,
  customerName: true,
  customerEmail: true,
  status: true,
  settingsSnapshot: true,
  settingsVersion: true,
  holdExpiresAt: true,
  formAnswers: true,
  reviewReason: true,
  decidedAt: true,
  decidedBy: true,
  refundStatus: true,
  refundReference: true,
  refundedAt: true,
  createdAt: true,
} as const;
export type MembershipRow = Prisma.PaidAccessMembershipGetPayload<{ select: typeof MEMBERSHIP_SELECT }>;

export const PAYMENT_SELECT = {
  id: true,
  membershipId: true,
  provider: true,
  providerRef: true,
  amountCents: true,
  currency: true,
  kind: true,
  status: true,
  reference: true,
  method: true,
  receiptFilePath: true,
  paidAt: true,
  submittedAt: true,
  confirmedAt: true,
  confirmedBy: true,
  rejectReason: true,
  creditedOrderId: true,
  createdAt: true,
} as const;
export type PaymentRow = Prisma.PaidAccessPaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

export type FlowRow = { id: string; groupBuyId: string; settings: PaidAccessSettings; version: number; maxSlots: number | null; slotsTaken: number };

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Stored settings JSON → settings. Written only after validation, so this is
 *  a defensive merge, not a second validator. */
export function readSettings(raw: unknown): PaidAccessSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<PaidAccessSettings>;
  return {
    ...OPEN_SETTINGS,
    ...o,
    steps: Array.isArray(o.steps) ? o.steps : [],
    form: { questions: Array.isArray(o.form?.questions) ? o.form!.questions : [] },
    payment: { ...OPEN_SETTINGS.payment, ...(o.payment ?? {}) },
    capacity: { ...OPEN_SETTINGS.capacity, ...(o.capacity ?? {}) },
    schedule: { ...OPEN_SETTINGS.schedule, ...(o.schedule ?? {}) },
    notify: { ...OPEN_SETTINGS.notify, ...(o.notify ?? {}) },
    copy: readCopy(o.copy),
  };
}

// ── Flows ────────────────────────────────────────────────────────────────────

const toFlow = (f: { id: string; groupBuyId: string; settings: unknown; version: number; maxSlots: number | null; slotsTaken: number }): FlowRow => ({
  ...f,
  settings: readSettings(f.settings),
});

export async function findFlow(db: TenantTx, groupBuyId: string): Promise<FlowRow | null> {
  const f = await db.paidAccessFlow.findFirst({
    where: { groupBuyId },
    select: { id: true, groupBuyId: true, settings: true, version: true, maxSlots: true, slotsTaken: true },
  });
  return f ? toFlow(f) : null;
}

/** Row-lock the flow for the rest of the transaction: every slot decision
 *  (join, release, promotion) serialises here, and reads the counter fresh. */
export async function lockFlow(db: TenantTx, flowId: string): Promise<{ slotsTaken: number; maxSlots: number | null }> {
  const rows = await db.$queryRaw<{ slotsTaken: number; maxSlots: number | null }[]>`
    SELECT "slotsTaken", "maxSlots" FROM paid_access_flows WHERE id = ${flowId} FOR UPDATE`;
  if (!rows[0]) throw new Error("PAID_ACCESS_FLOW_MISSING");
  return { slotsTaken: Number(rows[0].slotsTaken), maxSlots: rows[0].maxSlots === null ? null : Number(rows[0].maxSlots) };
}

export async function saveFlow(
  db: TenantTx,
  input: { tenantId: string; groupBuyId: string; settings: PaidAccessSettings },
): Promise<FlowRow> {
  const maxSlots = input.settings.capacity.maxSlots;
  const existing = await db.paidAccessFlow.findFirst({ where: { groupBuyId: input.groupBuyId }, select: { id: true } });
  const select = { id: true, groupBuyId: true, settings: true, version: true, maxSlots: true, slotsTaken: true } as const;
  const row = existing
    ? await db.paidAccessFlow.update({
        where: { id: existing.id },
        data: { settings: json(input.settings), maxSlots, version: { increment: 1 } },
        select,
      })
    : await db.paidAccessFlow.create({
        data: { tenantId: input.tenantId, groupBuyId: input.groupBuyId, settings: json(input.settings), maxSlots },
        select,
      });
  return toFlow(row);
}

/** Every flow of the store, for the storefront's cached gate policies. */
export async function listFlows(db: TenantTx): Promise<FlowRow[]> {
  const rows = await db.paidAccessFlow.findMany({
    select: { id: true, groupBuyId: true, settings: true, version: true, maxSlots: true, slotsTaken: true },
  });
  return rows.map(toFlow);
}

// ── Memberships ──────────────────────────────────────────────────────────────

export function latestMembership(db: TenantTx, groupBuyId: string, customerId: string): Promise<MembershipRow | null> {
  return db.paidAccessMembership.findFirst({
    where: { groupBuyId, customerId },
    orderBy: { createdAt: "desc" },
    select: MEMBERSHIP_SELECT,
  });
}

export function membershipById(db: TenantTx, id: string): Promise<MembershipRow | null> {
  return db.paidAccessMembership.findFirst({ where: { id }, select: MEMBERSHIP_SELECT });
}

export async function createMembership(
  db: TenantTx,
  data: {
    tenantId: string;
    flowId: string;
    groupBuyId: string;
    customer: { id: string; name: string; email: string };
    status: PaidAccessStatus;
    snapshot: PaidAccessSettings;
    version: number;
    holdExpiresAt: Date | null;
  },
): Promise<MembershipRow> {
  return db.paidAccessMembership.create({
    data: {
      tenantId: data.tenantId,
      flowId: data.flowId,
      groupBuyId: data.groupBuyId,
      customerId: data.customer.id,
      customerName: data.customer.name.slice(0, 120),
      customerEmail: data.customer.email,
      status: data.status,
      settingsSnapshot: json(data.snapshot),
      settingsVersion: data.version,
      holdExpiresAt: data.holdExpiresAt,
    },
    select: MEMBERSHIP_SELECT,
  });
}

export type MembershipPatch = {
  status?: PaidAccessStatus;
  holdExpiresAt?: Date | null;
  formAnswers?: Record<string, string>;
  reviewReason?: string;
  decidedAt?: Date;
  decidedBy?: string;
  refundStatus?: string;
  refundReference?: string;
  refundedAt?: Date;
};

/** Apply a patch only if the membership is still `from`. False = someone got there first. */
export async function moveMembership(db: TenantTx, id: string, from: PaidAccessStatus, patch: MembershipPatch): Promise<boolean> {
  const { formAnswers, ...rest } = patch;
  const res = await db.paidAccessMembership.updateMany({
    where: { id, status: from },
    data: { ...rest, ...(formAnswers ? { formAnswers: json(formAnswers) } : {}) },
  });
  return res.count === 1;
}

/** Payment-window sweep: unpaid holds past their deadline, oldest first. */
export function staleHolds(db: TenantTx, flowId: string, now: Date): Promise<MembershipRow[]> {
  return db.paidAccessMembership.findMany({
    where: { flowId, status: "payment_pending", holdExpiresAt: { lt: now } },
    orderBy: { createdAt: "asc" },
    select: MEMBERSHIP_SELECT,
  });
}

/** Stale holds across every store (the cron sweep). Privileged read: ids only. */
export async function staleHoldsEverywhere(now: Date, take: number): Promise<{ tenantId: string; groupBuyId: string }[]> {
  const rows = await prisma.paidAccessMembership.findMany({
    where: { status: "payment_pending", holdExpiresAt: { lt: now } },
    distinct: ["tenantId", "groupBuyId"],
    select: { tenantId: true, groupBuyId: true },
    take,
  });
  return rows;
}

export function waitlisted(db: TenantTx, flowId: string, take: number): Promise<MembershipRow[]> {
  return db.paidAccessMembership.findMany({
    where: { flowId, status: "waitlisted" },
    orderBy: { createdAt: "asc" },
    take,
    select: MEMBERSHIP_SELECT,
  });
}

export type QueueFilter = { groupBuyId?: string; statuses?: PaidAccessStatus[]; refundStatuses?: string[] };

export function listMemberships(db: TenantTx, filter: QueueFilter, take: number) {
  return db.paidAccessMembership.findMany({
    where: {
      ...(filter.groupBuyId ? { groupBuyId: filter.groupBuyId } : {}),
      ...(filter.statuses ? { status: { in: filter.statuses } } : {}),
      ...(filter.refundStatuses ? { refundStatus: { in: filter.refundStatuses } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take,
    select: { ...MEMBERSHIP_SELECT, payments: { select: PAYMENT_SELECT, orderBy: { createdAt: "desc" } } },
  });
}

export async function countByStatus(db: TenantTx, groupBuyId?: string): Promise<{ status: string; refundStatus: string; n: number }[]> {
  const rows = await db.paidAccessMembership.groupBy({
    by: ["status", "refundStatus"],
    where: groupBuyId ? { groupBuyId } : {},
    _count: { _all: true },
  });
  return rows.map((r) => ({ status: r.status, refundStatus: r.refundStatus, n: r._count._all }));
}

/** Is this membership still in the flow (not finished)? */
export const isLive = (status: string) => !PAID_ACCESS_TERMINAL_STATUSES.has(status as PaidAccessStatus);

// ── Payments ─────────────────────────────────────────────────────────────────

export function paymentById(db: TenantTx, id: string): Promise<PaymentRow | null> {
  return db.paidAccessPayment.findFirst({ where: { id }, select: PAYMENT_SELECT });
}

export function paymentsOf(db: TenantTx, membershipId: string): Promise<PaymentRow[]> {
  return db.paidAccessPayment.findMany({ where: { membershipId }, orderBy: { createdAt: "desc" }, select: PAYMENT_SELECT });
}

export function createPayment(
  db: TenantTx,
  data: {
    tenantId: string;
    membershipId: string;
    provider: string;
    providerRef: string | null;
    amountCents: number;
    kind: string;
    status: "initiated" | "submitted";
    reference?: string;
    method?: string;
    receiptFileId?: string | null;
    receiptFilePath?: string | null;
    paidAt?: Date | null;
    submittedAt?: Date | null;
  },
): Promise<PaymentRow> {
  return db.paidAccessPayment.create({ data, select: PAYMENT_SELECT });
}

export type PaymentPatch = {
  status?: string;
  providerRef?: string;
  confirmedAt?: Date;
  confirmedBy?: string;
  rejectReason?: string;
  creditedOrderId?: string;
  creditedAt?: Date;
};

export async function movePayment(db: TenantTx, id: string, from: string, patch: PaymentPatch): Promise<boolean> {
  const res = await db.paidAccessPayment.updateMany({ where: { id, status: from }, data: patch });
  return res.count === 1;
}

/** Which store a provider charge belongs to — webhooks arrive without one. */
export async function locateProviderPayment(provider: string, providerRef: string): Promise<{ tenantId: string; id: string } | null> {
  return prisma.paidAccessPayment.findUnique({
    where: { provider_providerRef: { provider, providerRef } },
    select: { tenantId: true, id: true },
  });
}

/** Has this webhook event been handled already? */
export async function webhookSeen(db: TenantTx, provider: string, eventId: string): Promise<boolean> {
  const row = await db.paidAccessWebhookEvent.findUnique({ where: { provider_eventId: { provider, eventId } }, select: { id: true } });
  return !!row;
}

/** Record a webhook event in the same transaction as its effects. Two racing
 *  deliveries: the second hits the unique key, its whole transaction rolls
 *  back, and the caller reports it as a duplicate. */
export async function recordWebhookEvent(db: TenantTx, provider: string, eventId: string): Promise<void> {
  await db.paidAccessWebhookEvent.create({ data: { provider, eventId } });
}

/** Manual-proof reference numbers used by more than one payment. */
export async function duplicateReferences(db: TenantTx, references: string[]): Promise<Set<string>> {
  const refs = [...new Set(references.filter(Boolean))];
  if (refs.length === 0) return new Set();
  const rows = await db.paidAccessPayment.groupBy({
    by: ["reference"],
    where: { provider: "manual", reference: { in: refs } },
    _count: { _all: true },
  });
  return new Set(rows.filter((r) => r._count._all > 1).map((r) => r.reference));
}

// ── Audit ────────────────────────────────────────────────────────────────────

export type EventInput = {
  groupBuyId: string;
  membershipId?: string | null;
  kind: "transition" | "payment" | "refund" | "settings";
  fromStatus?: string | null;
  toStatus?: string | null;
  actorKind: string;
  actorId?: string | null;
  reason?: string;
  data?: Record<string, unknown>;
};

export async function logEvents(db: TenantTx, tenantId: string, events: EventInput[]): Promise<void> {
  if (events.length === 0) return;
  await db.paidAccessEvent.createMany({
    data: events.map((e) => ({
      tenantId,
      groupBuyId: e.groupBuyId,
      membershipId: e.membershipId ?? null,
      kind: e.kind,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      actorKind: e.actorKind,
      actorId: e.actorId ?? null,
      reason: e.reason ?? "",
      data: json(e.data ?? {}),
    })),
  });
}

export function historyOf(db: TenantTx, filter: { membershipId?: string; groupBuyId?: string }, take = 200) {
  return db.paidAccessEvent.findMany({
    where: filter,
    orderBy: { createdAt: "asc" },
    take,
    select: { kind: true, fromStatus: true, toStatus: true, actorKind: true, actorId: true, reason: true, data: true, createdAt: true, membershipId: true },
  });
}

// ── Deposits ─────────────────────────────────────────────────────────────────

/** Mark a deposit credited to an order — only if it still isn't. */
export async function creditDeposit(db: TenantTx, paymentId: string, orderId: string, now: Date): Promise<boolean> {
  const res = await db.paidAccessPayment.updateMany({
    where: { id: paymentId, status: "confirmed", kind: "deposit", creditedOrderId: null },
    data: { creditedOrderId: orderId, creditedAt: now },
  });
  return res.count === 1;
}

/** The member's confirmed, not-yet-credited deposit for a round. */
export async function creditableDeposit(db: TenantTx, groupBuyId: string, customerId: string): Promise<PaymentRow | null> {
  return db.paidAccessPayment.findFirst({
    where: {
      kind: "deposit",
      status: "confirmed",
      creditedOrderId: null,
      membership: { groupBuyId, customerId, status: "active" },
    },
    select: PAYMENT_SELECT,
  });
}
