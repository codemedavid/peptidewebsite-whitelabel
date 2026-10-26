import "server-only";

// The store-admin half of paid group-buy access: the owner's per-round switch,
// the review queue, decisions and receipt links. Called by the store-admin
// actions in actions/gb-review.ts (website, and the app through the admin
// bridge), which own the permission check and resolve the reviewer. Every read
// and write is tenant-scoped through withTenant, so another store's ids simply
// don't resolve. The lifecycle is gb-membership.planMembershipTransition, and
// Postgres (prisma/group-buy-memberships.sql) enforces it again.

import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-client";
import type { StaffActor } from "@/storefront/admin/staff-permissions";
import { dbGroupBuyToStorefront, type DbGroupBuyRow, type GroupBuy, type GroupBuyCapabilities } from "./group-buy";
import { loadGroupBuys, revalidateGroupBuys } from "./group-buy-server";
import { privateReceiptUrl } from "./gb-join.server";
import {
  GB_MEMBERSHIP_STATUSES,
  isGbMembershipStatus,
  parseJoinFeeCents,
  planMembershipTransition,
  type GbMembershipStatus,
  type MembershipActor,
} from "./gb-membership";

type Err = { error: string };
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_LISTED = 200;

const ACTIONS = { approve: "approved", reject: "rejected", refund: "refunded", revoke: "revoked" } as const;
type ReviewAction = keyof typeof ACTIONS;

export type JoinRequestEvent = { fromStatus: string | null; toStatus: string; actorKind: string; actorId: string | null; reason: string; at: string };

export type JoinRequestRow = {
  id: string;
  groupBuyId: string;
  roundName: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string;
  status: string;
  amountCents: number;
  currency: string;
  method: string;
  reference: string;
  paidAt: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  reviewReason: string;
  refundReference: string;
  refundedAt: string | null;
  hasReceipt: boolean;
  /** Another request in this store carries the same reference number. */
  duplicateReference: boolean;
  createdAt: string;
  history: JoinRequestEvent[];
};

export type JoinRequestCounts = Record<GbMembershipStatus, number>;

/** The reviewer as the lifecycle sees them, email included (self-review check). */
export async function reviewerFor(tenantId: string, actor: StaffActor): Promise<MembershipActor> {
  if (actor.kind === "owner") {
    const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { storeAdminEmail: true } });
    return { kind: "owner", id: "owner", email: t?.storeAdminEmail ?? "" };
  }
  const s = await prisma.storefrontStaff.findFirst({ where: { id: actor.id, tenantId }, select: { email: true } });
  return { kind: "staff", id: actor.id, email: s?.email ?? "" };
}

// ── The owner's switch ──────────────────────────────────────────────────────

/**
 * Turn paid join on/off for one round and set its fee. Its own write, touching
 * ONLY these two columns: the general round save never carries them, so a
 * client that predates the fields can't switch paid join off by saving a round.
 * Existing requests keep the amount they were created with.
 */
export async function setPaidJoin(
  tenantId: string,
  caps: GroupBuyCapabilities,
  input: unknown,
): Promise<{ ok: true; groupBuy: GroupBuy } | Err> {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (typeof o.id !== "string" || !ID_RE.test(o.id)) return { error: "Group buy not found." };
  if (typeof o.paidJoin !== "boolean") return { error: "Choose whether this group buy needs a paid join." };
  if (o.paidJoin && !caps.paidAccess) return { error: "Paid group-buy access isn't enabled for this store." };

  let joinFeeCents: number | undefined;
  if (o.paidJoin || (o.joinFee !== undefined && o.joinFee !== "")) {
    const fee = parseJoinFeeCents(o.joinFee);
    if (!fee.ok) return { error: fee.error };
    joinFeeCents = fee.value;
  }
  const id = o.id;
  const paidJoin = o.paidJoin;
  const row = await withTenant(tenantId, async (db) => {
    const n = await db.groupBuy.updateMany({ where: { id }, data: { paidJoin, ...(joinFeeCents !== undefined ? { joinFeeCents } : {}) } });
    return n.count ? db.groupBuy.findFirst({ where: { id } }) : null;
  });
  if (!row) return { error: "Group buy not found." };
  revalidateGroupBuys(tenantId);
  return { ok: true, groupBuy: dbGroupBuyToStorefront(row as DbGroupBuyRow) };
}

// ── The queue ───────────────────────────────────────────────────────────────

const ROW_SELECT = {
  id: true,
  groupBuyId: true,
  customerId: true,
  customerName: true,
  customerEmail: true,
  status: true,
  amountCents: true,
  currency: true,
  method: true,
  reference: true,
  paidAt: true,
  submittedAt: true,
  decidedAt: true,
  decidedBy: true,
  reviewReason: true,
  refundReference: true,
  refundedAt: true,
  receiptFilePath: true,
  createdAt: true,
  events: {
    orderBy: { createdAt: "asc" as const },
    select: { fromStatus: true, toStatus: true, actorKind: true, actorId: true, reason: true, createdAt: true },
  },
} as const;

type DbRow = {
  id: string;
  groupBuyId: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string;
  status: string;
  amountCents: number;
  currency: string;
  method: string;
  reference: string;
  paidAt: Date | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  decidedBy: string | null;
  reviewReason: string;
  refundReference: string;
  refundedAt: Date | null;
  receiptFilePath: string | null;
  createdAt: Date;
  events: { fromStatus: string | null; toStatus: string; actorKind: string; actorId: string | null; reason: string; createdAt: Date }[];
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toRow(r: DbRow, roundNames: Map<string, string>, duplicates: Set<string>): JoinRequestRow {
  const ref = r.reference.trim().toLowerCase();
  return {
    id: r.id,
    groupBuyId: r.groupBuyId,
    roundName: roundNames.get(r.groupBuyId) ?? "Group buy",
    customerId: r.customerId,
    customerName: r.customerName,
    customerEmail: r.customerEmail,
    status: r.status,
    amountCents: r.amountCents,
    currency: r.currency,
    method: r.method,
    reference: r.reference,
    paidAt: iso(r.paidAt),
    submittedAt: iso(r.submittedAt),
    decidedAt: iso(r.decidedAt),
    decidedBy: r.decidedBy,
    reviewReason: r.reviewReason,
    refundReference: r.refundReference,
    refundedAt: iso(r.refundedAt),
    hasReceipt: !!r.receiptFilePath,
    duplicateReference: ref !== "" && duplicates.has(ref),
    createdAt: r.createdAt.toISOString(),
    history: r.events.map((e) => ({
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actorKind: e.actorKind,
      actorId: e.actorId,
      reason: e.reason,
      at: e.createdAt.toISOString(),
    })),
  };
}

/** References used on more than one request in the store (case-insensitive). */
async function duplicateReferences(tenantId: string, refs: string[]): Promise<Set<string>> {
  const wanted = [...new Set(refs.map((r) => r.trim()).filter(Boolean))];
  if (wanted.length === 0) return new Set();
  const rows = await withTenant(tenantId, (db) =>
    db.groupBuyMembership.findMany({
      where: { OR: wanted.map((r) => ({ reference: { equals: r, mode: "insensitive" as const } })) },
      select: { reference: true },
    }),
  );
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = r.reference.trim().toLowerCase();
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

export async function listJoinRequests(
  tenantId: string,
  slug: string,
  filters: unknown,
): Promise<{ ok: true; requests: JoinRequestRow[]; counts: JoinRequestCounts }> {
  const f = (filters && typeof filters === "object" ? filters : {}) as Record<string, unknown>;
  const status = isGbMembershipStatus(f.status) ? f.status : undefined;
  const groupBuyId = typeof f.groupBuyId === "string" && ID_RE.test(f.groupBuyId) ? f.groupBuyId : undefined;

  const [rows, grouped, rounds] = await Promise.all([
    withTenant(tenantId, (db) =>
      db.groupBuyMembership.findMany({
        where: { ...(status ? { status } : {}), ...(groupBuyId ? { groupBuyId } : {}) },
        orderBy: [{ submittedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: MAX_LISTED,
        select: ROW_SELECT,
      }),
    ),
    withTenant(tenantId, (db) =>
      db.groupBuyMembership.groupBy({ by: ["status"], where: groupBuyId ? { groupBuyId } : {}, _count: { _all: true } }),
    ),
    loadGroupBuys(tenantId, slug),
  ]);
  const counts = Object.fromEntries(GB_MEMBERSHIP_STATUSES.map((s) => [s, 0])) as JoinRequestCounts;
  for (const g of grouped) if (isGbMembershipStatus(g.status)) counts[g.status] = g._count._all;
  const names = new Map(rounds.map((r) => [r.id, r.name]));
  const dupes = await duplicateReferences(tenantId, (rows as DbRow[]).map((r) => r.reference));
  return { ok: true, requests: (rows as DbRow[]).map((r) => toRow(r, names, dupes)), counts };
}

async function loadRow(tenantId: string, slug: string, id: string): Promise<JoinRequestRow | null> {
  const r = await withTenant(tenantId, (db) => db.groupBuyMembership.findFirst({ where: { id }, select: ROW_SELECT }));
  if (!r) return null;
  const names = new Map((await loadGroupBuys(tenantId, slug)).map((g) => [g.id, g.name]));
  const dupes = await duplicateReferences(tenantId, [r.reference]);
  return toRow(r as DbRow, names, dupes);
}

// ── Decisions ───────────────────────────────────────────────────────────────

export async function reviewJoinRequest(
  tenantId: string,
  slug: string,
  actor: MembershipActor,
  input: unknown,
): Promise<{ ok: true; request: JoinRequestRow } | Err> {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (typeof o.id !== "string" || !ID_RE.test(o.id)) return { error: "Join request not found." };
  if (typeof o.action !== "string" || !Object.prototype.hasOwnProperty.call(ACTIONS, o.action)) return { error: "Unknown action." };
  const id = o.id;
  const to = ACTIONS[o.action as ReviewAction];

  const current = await withTenant(tenantId, (db) =>
    db.groupBuyMembership.findFirst({ where: { id }, select: { status: true, customerId: true, customerEmail: true } }),
  );
  if (!current) return { error: "Join request not found." };

  const plan = planMembershipTransition({
    from: current.status,
    to,
    actor,
    membership: { customerId: current.customerId, customerEmail: current.customerEmail },
    reason: o.reason,
    refundReference: o.refundReference,
  });
  if (!plan.ok) return { error: plan.error };

  const moved = await withTenant(tenantId, async (db) => {
    // Conditional on the status we read: two reviewers can't both decide it.
    const n = await db.groupBuyMembership.updateMany({ where: { id, status: current.status }, data: plan.patch });
    if (n.count === 0) return false;
    await db.groupBuyMembershipEvent.create({
      data: {
        tenantId,
        membershipId: id,
        fromStatus: current.status,
        toStatus: to,
        actorKind: actor.kind,
        actorId: actor.kind === "owner" ? null : actor.id,
        reason: plan.patch.reviewReason ?? plan.patch.refundReference ?? "",
      },
    });
    return true;
  });
  if (!moved) return { error: "This request just changed. Refresh and try again." };

  const row = await loadRow(tenantId, slug, id);
  return row ? { ok: true, request: row } : { error: "Join request not found." };
}

/** A 10-minute link to a request's receipt, for the store's admins. */
export async function adminReceiptUrl(tenantId: string, id: unknown): Promise<{ ok: true; url: string } | Err> {
  if (typeof id !== "string" || !ID_RE.test(id)) return { error: "Join request not found." };
  const r = await withTenant(tenantId, (db) => db.groupBuyMembership.findFirst({ where: { id }, select: { receiptFilePath: true } }));
  if (!r) return { error: "Join request not found." };
  if (!r.receiptFilePath) return { error: "No receipt was uploaded for this request." };
  return { ok: true, url: privateReceiptUrl(r.receiptFilePath) };
}
