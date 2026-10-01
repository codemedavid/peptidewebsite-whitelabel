import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-client";
import { FEATURES } from "@/lib/features/catalog";
import type { CustomerContext, Principal } from "@/lib/mobile/auth";
import type {
  CommunityMe,
  MemberApplication,
  MembersResponse,
  MemberStatus,
  ProfileResponse,
} from "@/lib/mobile/contract";
import { storeDisplayName } from "@/lib/mobile/store-name";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { AUTO_REVIEWER, admitCustomer, joinModeOf } from "./admission.server";
import { isCommunityModerator, type CommunityActor } from "./actor.server";
import { STORE_KEY, avatarHue, customerKey, parseParticipantKey } from "./keys";
import { MEMBER_STATUSES, isJoinMode, isMemberStatus, membershipFor } from "./membership";
import { loadParticipants, publicParticipant, storeParticipant } from "./participants.server";
import { parseDisplayName, parseProfileUpdate, parseReviewInput, type Parsed } from "./validate";

/**
 * Community membership: the join mode, the moderators' approve / decline
 * queue, re-applying, and profiles. Joining itself is admission.server.ts.
 * Membership lives in our own table — StorefrontCustomer is only ever read.
 */

const MEMBER_LIST_LIMIT = 200;

export async function buildCommunityMe(principal: Principal): Promise<CommunityMe> {
  const ctx = principal.ctx;
  const enabled = ctx.tenant.has(FEATURES.MOBILE_COMMUNITY);
  const none: CommunityMe = {
    enabled,
    membership: "none",
    rejectionReason: null,
    isModerator: false,
    myKey: null,
    profile: null,
    pendingApplications: 0,
    joinMode: joinModeOf(ctx.tenant),
  };
  if (!enabled) return none;

  if (principal.kind === "admin") {
    if (!isCommunityModerator(principal)) return none;
    const pending = await withTenant(ctx.tenantId, (db) => db.communityMember.count({ where: { status: "pending" } }));
    return {
      ...none,
      membership: "moderator",
      isModerator: true,
      myKey: STORE_KEY,
      profile: { displayName: storeDisplayName(ctx.tenant), bio: "", avatarHue: avatarHue(STORE_KEY) },
      pendingApplications: pending,
    };
  }

  // The first sign-in joins (or applies); an open community also admits
  // people who applied while the store still reviewed each member.
  const member = await admitCustomer(ctx.tenant, ctx.tenantId, principal.ctx.customer);
  const membership = membershipFor({ enabled, isModerator: false, status: member.status });
  return {
    ...none,
    membership,
    rejectionReason: membership === "rejected" || membership === "revoked" ? member.reason : null,
    myKey: membership === "approved" ? customerKey(principal.ctx.customer.id) : null,
    profile: { displayName: member.displayName, bio: member.bio, avatarHue: member.avatarHue },
  };
}

// ── moderators: the approval queue ───────────────────────────────────────────

export async function listMembers(actor: CommunityActor, statusParam: string | null): Promise<MembersResponse> {
  const status = isMemberStatus(statusParam) ? statusParam : null;
  return withTenant(actor.tenantId, async (db) => {
    const [rows, grouped] = await Promise.all([
      db.communityMember.findMany({
        where: status ? { status } : {},
        orderBy: [{ submittedAt: "desc" }],
        take: MEMBER_LIST_LIMIT,
        include: { customer: { select: { email: true, phone: true } } },
      }),
      db.communityMember.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(MEMBER_STATUSES.map((s) => [s, 0])) as Record<MemberStatus, number>;
    for (const g of grouped) if (isMemberStatus(g.status)) counts[g.status] = g._count._all;
    const members: MemberApplication[] = rows.map((r) => ({
      customerId: r.customerId,
      displayName: r.displayName,
      email: r.customer.email,
      phone: r.customer.phone,
      status: isMemberStatus(r.status) ? r.status : "pending",
      reason: r.reason,
      submittedAt: r.submittedAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
    }));
    return { members, counts, joinMode: joinModeOf(actor.tenant) };
  });
}

export type ReviewOutcome = { kind: "ok"; member: MemberApplication } | { kind: "invalid"; message: string } | { kind: "not_found" };

/**
 * Approve, decline (pending) or revoke (approved). Declining an approved member
 * revokes them; approving again restores them and resets their unread baseline.
 */
export async function reviewMember(actor: CommunityActor, customerId: string, body: unknown): Promise<ReviewOutcome> {
  const input = parseReviewInput(body);
  if (!input.ok) return { kind: "invalid", message: input.error };
  return withTenant(actor.tenantId, async (db): Promise<ReviewOutcome> => {
    const row = await db.communityMember.findFirst({ where: { customerId }, include: { customer: { select: { email: true, phone: true } } } });
    if (!row) return { kind: "not_found" };
    const status: MemberStatus = input.value.approve ? "approved" : row.status === "approved" ? "revoked" : "rejected";
    const now = new Date();
    await db.communityMember.updateMany({
      where: { customerId },
      data: { status, reason: input.value.reason, reviewedAt: now, reviewedBy: actor.authorKey },
    });
    return {
      kind: "ok",
      member: {
        customerId,
        displayName: row.displayName,
        email: row.customer.email,
        phone: row.customer.phone,
        status,
        reason: input.value.reason,
        submittedAt: row.submittedAt.toISOString(),
        reviewedAt: now.toISOString(),
      },
    };
  });
}

/**
 * Switch who can join. Going open lets everyone still waiting in at once;
 * going to approval only affects people who sign in from now on.
 */
export async function setJoinMode(actor: CommunityActor, body: unknown): Promise<Parsed<MembersResponse["joinMode"]>> {
  const joinMode = body && typeof body === "object" ? (body as Record<string, unknown>).joinMode : undefined;
  if (!isJoinMode(joinMode)) return { ok: false, error: "Choose open or approval." };
  // Read the CURRENT config (not the cached context) so a concurrent website
  // edit to another branding field is never overwritten by this write.
  const row = await prisma.branding.findUnique({ where: { tenantId: actor.tenantId }, select: { config: true } });
  const current = (row?.config ?? {}) as Record<string, unknown>;
  const config = { ...current, communityJoin: joinMode } as Prisma.InputJsonValue;
  await prisma.branding.upsert({
    where: { tenantId: actor.tenantId },
    update: { config },
    create: { tenantId: actor.tenantId, config },
  });
  if (joinMode === "open") {
    const now = new Date();
    await withTenant(actor.tenantId, (db) =>
      db.communityMember.updateMany({
        where: { status: "pending" },
        data: { status: "approved", reason: null, reviewedAt: now, reviewedBy: AUTO_REVIEWER },
      }),
    );
  }
  revalidateTenant(actor.tenantId, actor.slug);
  return { ok: true, value: joinMode };
}

/** A declined customer applies again (revoked members can't — the owner removed them). */
export async function reapply(ctx: CustomerContext, body: Record<string, unknown> | null): Promise<Parsed<CommunityMe>> {
  if (!ctx.tenant.has(FEATURES.MOBILE_COMMUNITY)) return { ok: false, error: "The community isn't available for this store." };
  const name = parseDisplayName(body?.displayName);
  if (!name.ok) return name;
  // An open community takes a declined customer straight back in.
  const open = joinModeOf(ctx.tenant) === "open";
  const now = new Date();
  const updated = await withTenant(ctx.tenantId, (db) =>
    db.communityMember.updateMany({
      where: { customerId: ctx.customer.id, status: "rejected" },
      data: {
        status: open ? "approved" : "pending",
        displayName: name.value,
        reason: null,
        submittedAt: now,
        reviewedAt: open ? now : null,
        reviewedBy: open ? AUTO_REVIEWER : null,
      },
    }),
  );
  if (updated.count !== 1) return { ok: false, error: "There's no declined application to resend." };
  return { ok: true, value: await buildCommunityMe({ kind: "customer", ctx }) };
}

// ── profiles ─────────────────────────────────────────────────────────────────

export async function getProfile(actor: CommunityActor, key: string): Promise<ProfileResponse | null> {
  const ref = parseParticipantKey(key);
  if (!ref) return null;
  if (ref.kind === "store") return { ...storeParticipant(actor.tenant), bio: "", memberSince: null };
  const cards = await withTenant(actor.tenantId, (db) => loadParticipants(db, actor.tenant, [key]));
  const card = cards.get(key);
  // Only approved members have a public profile (moderators may see anyone's).
  if (!card || card.name === "Former member" || (card.status !== "approved" && !actor.isModerator)) return null;
  return { ...publicParticipant(card), bio: card.bio, memberSince: card.memberSince?.toISOString() ?? null };
}

export async function updateMyProfile(actor: CommunityActor, body: unknown): Promise<Parsed<ProfileResponse>> {
  if (!actor.customerId) return { ok: false, error: "Change the store's name and logo on the website." };
  const input = parseProfileUpdate(body);
  if (!input.ok) return input;
  await withTenant(actor.tenantId, (db) =>
    db.communityMember.updateMany({ where: { customerId: actor.customerId! }, data: input.value }),
  );
  const profile = await getProfile(actor, actor.key);
  return profile ? { ok: true, value: profile } : { ok: false, error: "Profile not found." };
}
