import "server-only";

import { randomBytes } from "node:crypto";
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
  WelcomeMedia,
  WelcomeMessage,
} from "@/lib/mobile/contract";
import { storeDisplayName } from "@/lib/mobile/store-name";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { AUTO_REVIEWER, admitCustomer, joinModeOf } from "./admission.server";
import { isCommunityModerator, type CommunityActor } from "./actor.server";
import { STORE_KEY, avatarHue, customerKey, parseParticipantKey } from "./keys";
import { MEMBER_STATUSES, isActiveAdmin, isJoinMode, isMemberStatus, membershipFor } from "./membership";
import { loadParticipants, publicParticipant, storeParticipant } from "./participants.server";
import { findOwnUpload } from "./uploads.server";
import { communityTags } from "./tags";
import { previewFor, previewPolicyOf } from "./preview";
import { parseDisplayName, parseProfileUpdate, parseReviewInput, type Parsed } from "./validate";
import { communityWelcome, finalizeWelcome, parseWelcomeInput, videoPosterUrl } from "./welcome";

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
    isAdmin: false,
    isVerifiedReseller: false,
    myKey: null,
    profile: null,
    pendingApplications: 0,
    joinMode: joinModeOf(ctx.tenant),
    tags: communityTags(ctx.tenant.branding?.config),
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
  const isAdmin = isActiveAdmin(member);
  const pending = isAdmin ? await withTenant(ctx.tenantId, (db) => db.communityMember.count({ where: { status: "pending" } })) : 0;
  // Not approved while the store's preview is on: they browse under its rules
  // (pending ones may also read / chat where allowed, as `c:<id>`).
  const preview = previewFor(previewPolicyOf(ctx.tenant.branding?.config), member.status);
  return {
    ...none,
    membership,
    isAdmin,
    isVerifiedReseller: membership === "approved" && member.verifiedReseller,
    rejectionReason: membership === "rejected" || membership === "revoked" ? member.reason : null,
    myKey: membership === "approved" || (preview && membership === "pending") ? customerKey(principal.ctx.customer.id) : null,
    profile: { displayName: member.displayName, bio: member.bio, avatarHue: member.avatarHue },
    pendingApplications: pending,
    preview,
  };
}

// ── moderators: the approval queue ───────────────────────────────────────────

/** A member's email and phone are the store's: community admins get blanks. */
function contactFor(actor: CommunityActor, customer: { email: string; phone: string }): { email: string; phone: string } {
  return actor.isTeam ? { email: customer.email, phone: customer.phone } : { email: "", phone: "" };
}

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
    // Safety bot record: offenses that weren't dismissed as false alarms.
    const flagged = await db.communityFlag.groupBy({
      by: ["senderKey"],
      where: { senderKey: { in: rows.map((r) => customerKey(r.customerId)) }, status: { not: "dismissed" } },
      _count: { _all: true },
    });
    const offenses = new Map(flagged.map((f) => [f.senderKey, f._count._all]));
    const members: MemberApplication[] = rows.map((r) => ({
      customerId: r.customerId,
      displayName: r.displayName,
      ...contactFor(actor, r.customer),
      status: isMemberStatus(r.status) ? r.status : "pending",
      reason: r.reason,
      submittedAt: r.submittedAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      verifiedReseller: r.verifiedReseller,
      isAdmin: r.isAdmin,
      offenses: actor.isTeam ? (offenses.get(customerKey(r.customerId)) ?? 0) : 0,
      muted: r.mutedAt !== null,
      banned: r.bannedAt !== null,
    }));
    // The welcome messages are run by every moderator (team and community admins).
    const welcome = communityWelcome(actor.tenant.branding?.config);
    return { members, counts, joinMode: joinModeOf(actor.tenant), welcome };
  });
}

export type ReviewOutcome =
  | { kind: "ok"; member: MemberApplication }
  | { kind: "invalid"; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "not_found" };

/**
 * Approve, decline (pending) or revoke (approved). Declining an approved member
 * revokes them — and drops any admin role; approving again restores them and
 * resets their unread baseline. Community admins approve pending people and
 * remove members; another admin, or re-admitting someone removed, is the team's.
 */
export async function reviewMember(actor: CommunityActor, customerId: string, body: unknown): Promise<ReviewOutcome> {
  const input = parseReviewInput(body);
  if (!input.ok) return { kind: "invalid", message: input.error };
  return withTenant(actor.tenantId, async (db): Promise<ReviewOutcome> => {
    const row = await db.communityMember.findFirst({ where: { customerId }, include: { customer: { select: { email: true, phone: true } } } });
    if (!row) return { kind: "not_found" };
    if (!actor.isTeam) {
      if (row.isAdmin) return { kind: "forbidden", message: "Only the store team can change another admin's membership." };
      // Admins work the queue and remove members; taking a removed member back is the team's call.
      if (input.value.approve && row.status !== "pending") return { kind: "forbidden", message: "Only the store team can take back a removed member." };
    }
    // A ban also locked the account — only unbanning (Safety) gives both back.
    if (row.bannedAt && input.value.approve) return { kind: "invalid", message: "This member is banned. Unban them from Safety first." };
    const status: MemberStatus = input.value.approve ? "approved" : row.status === "approved" ? "revoked" : "rejected";
    const now = new Date();
    await db.communityMember.updateMany({
      where: { customerId },
      data: {
        status,
        reason: input.value.reason,
        reviewedAt: now,
        reviewedBy: actor.authorKey ?? actor.key,
        ...(status === "approved" ? {} : { isAdmin: false }),
      },
    });
    return {
      kind: "ok",
      member: {
        customerId,
        displayName: row.displayName,
        ...contactFor(actor, row.customer),
        status,
        reason: input.value.reason,
        submittedAt: row.submittedAt.toISOString(),
        reviewedAt: now.toISOString(),
        verifiedReseller: row.verifiedReseller,
        isAdmin: status === "approved" && row.isAdmin,
        muted: row.mutedAt !== null,
        banned: row.bannedAt !== null,
      },
    };
  });
}

/**
 * Merge keys into branding.config. Reads the CURRENT config (not the cached
 * context) so a concurrent website edit to another branding field is never
 * overwritten by this write.
 */
async function patchBrandingConfig(tenantId: string, patch: Record<string, unknown>): Promise<void> {
  const row = await prisma.branding.findUnique({ where: { tenantId }, select: { config: true } });
  const current = (row?.config ?? {}) as Record<string, unknown>;
  const config = { ...current, ...patch } as Prisma.InputJsonValue;
  await prisma.branding.upsert({ where: { tenantId }, update: { config }, create: { tenantId, config } });
}

/**
 * The welcome DMs new members get when they first open Chats
 * (welcome.server.ts). Set by any moderator. A NEW photo or video must be one
 * this moderator uploaded to this tenant — its name, size, type and dimensions
 * come from that upload record, never from the request. Media already in the
 * saved welcome is kept as saved, so one admin can re-save another's photo.
 */
export async function setWelcome(actor: CommunityActor, body: unknown): Promise<Parsed<WelcomeMessage>> {
  const row = await prisma.branding.findUnique({ where: { tenantId: actor.tenantId }, select: { config: true } });
  const current = communityWelcome(row?.config);
  const input = parseWelcomeInput(body && typeof body === "object" ? (body as Record<string, unknown>).welcome : undefined, current);
  if (!input.ok) return input;
  const savedMedia = new Map(current.messages.flatMap((m) => (m.media ? [[`${m.media.kind}:${m.media.url}`, m.media] as const] : [])));

  const resolved = await withTenant(actor.tenantId, async (db) => {
    const out: { id: string | null; text: string; media: WelcomeMedia | null }[] = [];
    for (const [i, m] of input.value.messages.entries()) {
      if (!m.media) {
        out.push({ id: m.id, text: m.text, media: null });
        continue;
      }
      const kept = savedMedia.get(`${m.media.kind}:${m.media.url}`);
      if (kept) {
        out.push({ id: m.id, text: m.text, media: kept });
        continue;
      }
      const upload = await findOwnUpload(db, actor, m.media.url, m.media.kind);
      if (!upload) return { ok: false as const, error: `The ${m.media.kind === "video" ? "video" : "photo"} on message ${i + 1} wasn't uploaded here. Add it again.` };
      out.push({
        id: m.id,
        text: m.text,
        media: {
          kind: m.media.kind,
          url: upload.url,
          name: upload.name,
          size: upload.size,
          mime: upload.mime,
          width: upload.width,
          height: upload.height,
          posterUrl: m.media.kind === "video" ? videoPosterUrl(upload.url) : null,
        },
      });
    }
    return { ok: true as const, items: out };
  });
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const saved = finalizeWelcome(input.value.enabled, resolved.items, () => `w${randomBytes(4).toString("hex")}`);
  await patchBrandingConfig(actor.tenantId, { communityWelcome: saved });
  revalidateTenant(actor.tenantId, actor.slug);
  return { ok: true, value: communityWelcome({ communityWelcome: saved }) };
}

export type ResellerOutcome = { kind: "ok"; verifiedReseller: boolean } | { kind: "invalid"; message: string } | { kind: "not_found" };

/** Mark a member a verified reseller (posts in a hub's On hand), or take it back. */
export async function setVerifiedReseller(actor: CommunityActor, customerId: string, body: unknown): Promise<ResellerOutcome> {
  const value = body && typeof body === "object" ? (body as Record<string, unknown>).verifiedReseller : undefined;
  if (typeof value !== "boolean") return { kind: "invalid", message: "Choose whether this member is a verified reseller." };
  const res = await withTenant(actor.tenantId, (db) =>
    db.communityMember.updateMany({ where: { customerId }, data: { verifiedReseller: value } }),
  );
  return res.count === 1 ? { kind: "ok", verifiedReseller: value } : { kind: "not_found" };
}

export type AdminRoleOutcome = { kind: "ok"; isAdmin: boolean } | { kind: "invalid"; message: string } | { kind: "not_found" };

/**
 * The store team makes an approved member a community admin, or takes it back.
 * (The route is team-only; admins never promote or demote anyone.)
 */
export async function setMemberAdmin(actor: CommunityActor, customerId: string, value: boolean): Promise<AdminRoleOutcome> {
  return withTenant(actor.tenantId, async (db): Promise<AdminRoleOutcome> => {
    const row = await db.communityMember.findFirst({ where: { customerId }, select: { status: true } });
    if (!row) return { kind: "not_found" };
    if (value && row.status !== "approved") return { kind: "invalid", message: "Only approved members can be admins." };
    await db.communityMember.updateMany({ where: { customerId }, data: { isAdmin: value } });
    return { kind: "ok", isAdmin: value };
  });
}

/**
 * Switch who can join. Going open lets everyone still waiting in at once;
 * going to approval only affects people who sign in from now on.
 */
export async function setJoinMode(actor: CommunityActor, body: unknown): Promise<Parsed<MembersResponse["joinMode"]>> {
  const joinMode = body && typeof body === "object" ? (body as Record<string, unknown>).joinMode : undefined;
  if (!isJoinMode(joinMode)) return { ok: false, error: "Choose open or approval." };
  await patchBrandingConfig(actor.tenantId, { communityJoin: joinMode });
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
  // Only approved members have a public profile (the store team may see anyone's;
  // someone previewing still sees their own).
  if (!card || card.name === "Former member" || (card.status !== "approved" && !actor.isTeam && key !== actor.key)) return null;
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
