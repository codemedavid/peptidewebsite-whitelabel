import "server-only";

import type { CommunityMessage as MessageRow } from "@prisma/client";
import { jevDecide, jevHealth, type JevHealth } from "@/lib/ai/jev";
import { prisma } from "@/lib/db/prisma";
import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import type {
  FlagActionResult,
  FlagContextLine,
  FlagStatus,
  ModerationExample,
  ModerationFlag,
  ModerationPolicy,
  ModerationResponse,
  ModerationSettingsView,
  ModerationTestResult,
} from "@/lib/mobile/contract";
import type { CommunityActor } from "./actor.server";
import { customerKey, dmPeerOf, parseParticipantKey } from "./keys";
import {
  BAN_REASON,
  BOT_REVIEWER,
  MAX_EXAMPLES_PER_KIND,
  confidenceLabel,
  defaultRules,
  exampleText,
  matchedRule,
  moderationSettings,
  offenseLabel,
  offenseTag,
  parseExampleInput,
  parseFlagReview,
  parseModerationInput,
  parseRulesInput,
  parseSanction,
  parseTestInput,
  poachQuestion,
  poachScore,
  scanText,
  shouldAutoMute,
  shouldLiftAutoMute,
  verdictFor,
  type ModerationSettings,
  type Policy,
  type RuleKind,
  type ScanPlace,
  type Verdict,
} from "./moderation";
import { loadParticipants, type MemberCard } from "./participants.server";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { previewText } from "./text";

/**
 * The community safety bot. Every member's channel post and DM (sends AND
 * edits) is asked of Jev before it is written; a catch is written hidden
 * (deletedAt + moderatedAt) with a CommunityFlag. Its text reaches only the
 * moderators' review queue — everyone else in the thread sees a "removed by
 * the safety bot" placeholder. The store team is never scanned (community
 * admins are customers, so they are), and muted
 * members are refused before any scan. Jev being down fails open.
 *
 * Each check carries the store's policy: the owner's Not allowed / Allowed
 * rules and the messages they labelled while reviewing (Jev can't be
 * fine-tuned — it is steered per request). The store's sensitivity decides
 * whether a catch is hidden at once or left visible and held for review.
 *
 * Moderators then restore (false alarm), confirm, mute or ban. Banning revokes
 * the membership AND disables the customer account (sessionVersion bump kills
 * every live session), so the same login is refused everywhere.
 */

// Each flag costs one context read inside one transaction (tx-round-trip budget) — keep the page small.
const FLAG_PAGE = 10;
const CONTEXT_LINES = 2;
const FLAG_STATUSES: readonly FlagStatus[] = ["pending", "confirmed", "dismissed"];

type Outcome<T> = { kind: "ok"; value: T } | { kind: "not_found" } | { kind: "invalid"; message: string };

function settingsOf(actor: CommunityActor): ModerationSettings {
  return moderationSettings(actor.tenant.branding?.config);
}

// ── the store's policy ───────────────────────────────────────────────────────

/** The owner's rules (the starter rules until they save their own) and taught examples, newest first. */
async function loadPolicy(db: TenantTx, storeName: string): Promise<Policy & { customized: boolean; exampleRows: ModerationExample[] }> {
  const rows = await db.communityModerationRule.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const line = (r: (typeof rows)[number]) => ({ id: r.id, kind: r.kind as RuleKind, text: r.text });
  // Saved rules keep the order the owner wrote them in.
  const saved = rows.filter((r) => r.type === "rule").reverse().map(line);
  const examples = rows.filter((r) => r.type === "example");
  return {
    rules: saved.length > 0 ? saved : defaultRules(storeName),
    customized: saved.length > 0,
    examples: examples.map(line),
    exampleRows: examples.map((r) => ({ ...line(r), source: r.source === "review" ? "review" : "owner", createdAt: r.createdAt.toISOString() })),
  };
}

function policyView(p: Awaited<ReturnType<typeof loadPolicy>>): ModerationPolicy {
  return { rules: p.rules, examples: p.exampleRows, customized: p.customized };
}

/** What the bot decided about one message: hide it now, or leave it up and hold it for review. */
export type PoachCatch = { score: number; verdict: Verdict; reason: string | null };

async function judge(actor: CommunityActor, place: ScanPlace, text: string) {
  const policy = await withTenant(actor.tenantId, (db) => loadPolicy(db, actor.storeName));
  const answers = await jevDecide(poachQuestion(actor.storeName, place, text, policy));
  const score = poachScore(answers);
  return { score, verdict: verdictFor(score, settingsOf(actor).sensitivity), reason: matchedRule(answers, policy) };
}

/** Null = let it through (fine, not checked, or Jev didn't answer — the bot fails open). */
export async function checkForPoach(actor: CommunityActor, place: ScanPlace, body: string | null | undefined): Promise<PoachCatch | null> {
  if (actor.isTeam || !actor.customerId || actor.isMuted) return null;
  if (!settingsOf(actor).enabled) return null;
  const text = scanText(body);
  if (!text) return null;
  try {
    const { score, verdict, reason } = await judge(actor, place, text);
    return score !== null && verdict ? { score, verdict, reason } : null;
  } catch (e) {
    // Like Jev being down: never lose a member's message because the bot couldn't run.
    console.warn("[moderation] check skipped", (e as Error).name);
    return null;
  }
}

/**
 * Offenses on record per sender: flags that weren't dismissed as false alarms —
 * a borderline message held for review counts only once a moderator confirms it.
 */
async function offenseCounts(db: TenantTx, senderKeys: string[]): Promise<Map<string, number>> {
  if (senderKeys.length === 0) return new Map();
  const rows = await db.communityFlag.groupBy({
    by: ["senderKey"],
    where: { senderKey: { in: senderKeys }, status: { not: "dismissed" }, OR: [{ action: "hide" }, { status: "confirmed" }] },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.senderKey, r._count._all]));
}

/** Mutes the sender once their offenses reach the store's limit. */
async function autoMuteIfDue(db: TenantTx, senderKey: string, customerId: string, muteAfter: number, now: Date): Promise<boolean> {
  const offenses = (await offenseCounts(db, [senderKey])).get(senderKey) ?? 0;
  const member = await db.communityMember.findFirst({ where: { customerId }, select: { mutedAt: true } });
  if (!member || !shouldAutoMute(offenses, muteAfter, !!member.mutedAt)) return !!member?.mutedAt;
  await db.communityMember.updateMany({ where: { customerId }, data: { mutedAt: now, mutedBy: BOT_REVIEWER } });
  return true;
}

/**
 * Inside the send/edit transaction, after the hidden row is written: open the
 * flag (or re-open it for an edited message) and mute a repeat offender.
 */
export async function recordFlag(
  db: TenantTx,
  actor: CommunityActor,
  row: Pick<MessageRow, "id" | "topicId" | "conversationId">,
  caught: PoachCatch,
  now: Date,
): Promise<{ muted: boolean }> {
  const thread = row.topicId ? { threadType: "topic", threadId: row.topicId } : { threadType: "dm", threadId: row.conversationId ?? "" };
  const data = { score: caught.score, action: caught.verdict, reason: caught.reason };
  // findFirst/updateMany are tenant-scoped by the client extension (upsert is not).
  const existing = await db.communityFlag.findFirst({ where: { messageId: row.id }, select: { id: true } });
  if (existing) {
    await db.communityFlag.updateMany({ where: { id: existing.id }, data: { ...data, status: "pending", reviewedAt: null, reviewedBy: null } });
  } else {
    await db.communityFlag.create({ data: { tenantId: actor.tenantId, messageId: row.id, senderKey: actor.key, ...thread, ...data, createdAt: now } });
  }
  // Only a hidden catch counts toward the auto-mute until someone confirms a held one.
  if (caught.verdict !== "hide") {
    const member = await db.communityMember.findFirst({ where: { customerId: actor.customerId! }, select: { mutedAt: true } });
    return { muted: !!member?.mutedAt };
  }
  return { muted: await autoMuteIfDue(db, actor.key, actor.customerId!, settingsOf(actor).muteAfter, now) };
}

// ── the moderators' queue ────────────────────────────────────────────────────

async function settingsView(s: ModerationSettings): Promise<ModerationSettingsView> {
  const health = await jevHealth();
  return { ...s, available: health === "ok", health };
}

function lineText(m: Pick<MessageRow, "kind" | "body" | "fileName">): string {
  return previewText({ kind: m.kind, body: m.body, deleted: false, fileName: m.fileName });
}

type TopicName = { name: string; isGeneral: boolean; channel: { name: string } };
type Convo = { lowKey: string; highKey: string };

function placeName(f: { threadType: string; threadId: string; senderKey: string }, topics: Map<string, TopicName>, convos: Map<string, Convo>, names: Map<string, MemberCard>): string {
  if (f.threadType === "topic") {
    const topic = topics.get(f.threadId);
    if (!topic) return "A removed channel";
    return topic.isGeneral ? topic.channel.name : `${topic.channel.name} › ${topic.name}`;
  }
  const convo = convos.get(f.threadId);
  const peerKey = convo ? dmPeerOf(convo, f.senderKey) : null;
  return `Private message to ${(peerKey && names.get(peerKey)?.name) || "a member"}`;
}

/** The flagged message and the lines just before it in the same thread — never the rest of a DM. */
async function contextFor(db: TenantTx, row: MessageRow, names: Map<string, MemberCard>): Promise<FlagContextLine[]> {
  const where = row.topicId ? { topicId: row.topicId } : { conversationId: row.conversationId };
  const before = await db.communityMessage.findMany({
    where: { ...where, deletedAt: null, OR: [{ createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lt: row.id } }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CONTEXT_LINES,
  });
  const line = (m: MessageRow, flagged: boolean): FlagContextLine => ({
    senderName: names.get(m.senderKey)?.name ?? "Member",
    text: lineText(m),
    at: m.createdAt.toISOString(),
    flagged,
  });
  return [...before.reverse().map((m) => line(m, false)), line(row, true)];
}

export async function getModeration(actor: CommunityActor, statusParam: string | null): Promise<ModerationResponse> {
  const status = FLAG_STATUSES.includes(statusParam as FlagStatus) ? (statusParam as FlagStatus) : "pending";
  // A network call — made before the transaction so it never holds a pooled connection.
  const settings = await settingsView(settingsOf(actor));
  return withTenant(actor.tenantId, async (db) => {
    const flags = await db.communityFlag.findMany({ where: { status }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: FLAG_PAGE });
    const grouped = await db.communityFlag.groupBy({ by: ["status"], _count: { _all: true } });
    const counts = Object.fromEntries(FLAG_STATUSES.map((s) => [s, 0])) as Record<FlagStatus, number>;
    for (const g of grouped) if (FLAG_STATUSES.includes(g.status as FlagStatus)) counts[g.status as FlagStatus] = g._count._all;

    const messages = await db.communityMessage.findMany({ where: { id: { in: flags.map((f) => f.messageId) } } });
    const byId = new Map(messages.map((m) => [m.id, m]));
    const senderKeys = [...new Set(flags.map((f) => f.senderKey))];
    const customerIds = senderKeys.flatMap((k) => {
      const ref = parseParticipantKey(k);
      return ref?.kind === "customer" ? [ref.id] : [];
    });
    const idsOf = (type: string) => flags.filter((f) => f.threadType === type).map((f) => f.threadId);
    const convoRows = await db.communityConversation.findMany({ where: { id: { in: idsOf("dm") } } });
    const topicRows = await db.communityTopic.findMany({ where: { id: { in: idsOf("topic") } }, include: { channel: { select: { name: true } } } });
    const convos = new Map(convoRows.map((c) => [c.id, c]));
    const topics = new Map(topicRows.map((t) => [t.id, t]));
    const names = await loadParticipants(db, actor.tenant, [...senderKeys, ...convoRows.flatMap((c) => [c.lowKey, c.highKey])]);
    const offenses = await offenseCounts(db, senderKeys);
    const members = await db.communityMember.findMany({
      where: { customerId: { in: customerIds } },
      select: { customerId: true, mutedAt: true, mutedBy: true, bannedAt: true },
    });
    const memberById = new Map(members.map((m) => [m.customerId, m]));

    const out: ModerationFlag[] = [];
    for (const f of flags) {
      const row = byId.get(f.messageId);
      if (!row) continue;
      const ref = parseParticipantKey(f.senderKey);
      const customerId = ref?.kind === "customer" ? ref.id : "";
      const member = memberById.get(customerId);
      const card = names.get(f.senderKey);
      const count = offenses.get(f.senderKey) ?? 0;
      out.push({
        id: f.id,
        status: f.status as FlagStatus,
        score: f.score,
        kind: f.action === "review" ? "review" : "hidden",
        confidence: confidenceLabel(f.score),
        reason: f.reason,
        createdAt: f.createdAt.toISOString(),
        reviewedAt: f.reviewedAt?.toISOString() ?? null,
        place: { type: f.threadType === "dm" ? "dm" : "topic", id: f.threadId, name: placeName(f, topics, convos, names) },
        message: { id: row.id, text: row.body ?? "", imageUrl: row.imageUrl, at: row.createdAt.toISOString(), hidden: !!row.deletedAt },
        context: await contextFor(db, row, names),
        sender: {
          customerId,
          key: f.senderKey,
          name: card?.name ?? "Former member",
          imageUrl: card?.imageUrl ?? null,
          avatarHue: card?.avatarHue ?? 0,
          offenses: count,
          tag: offenseTag(count),
          label: offenseLabel(count),
          muted: !!member?.mutedAt,
          mutedByBot: member?.mutedBy === BOT_REVIEWER,
          banned: !!member?.bannedAt,
        },
      });
    }
    const policy = policyView(await loadPolicy(db, actor.storeName));
    return { settings, flags: out, counts, policy };
  });
}

export async function setModeration(actor: CommunityActor, body: unknown): Promise<Outcome<ModerationSettingsView>> {
  const row = await prisma.branding.findUnique({ where: { tenantId: actor.tenantId }, select: { config: true } });
  const current = (row?.config ?? {}) as Record<string, unknown>;
  const input = parseModerationInput(body, moderationSettings(current));
  if (!input.ok) return { kind: "invalid", message: input.error };
  const config = { ...current, communityModeration: input.value };
  await prisma.branding.upsert({ where: { tenantId: actor.tenantId }, update: { config }, create: { tenantId: actor.tenantId, config } });
  // The scan reads the cached tenant context — without this a switch-off waits out the cache.
  revalidateTenant(actor.tenantId, actor.slug);
  return { kind: "ok", value: await settingsView(input.value) };
}

/**
 * Keeps a message as an example for Jev; the oldest review-taught one on that side makes room
 * (examples the team typed in are never dropped). Null when nothing new was saved.
 */
async function teach(db: TenantTx, actor: CommunityActor, kind: RuleKind, text: string, source: "owner" | "review" = "review"): Promise<string | null> {
  const clean = exampleText(text);
  if (!clean) return null;
  const same = await db.communityModerationRule.findFirst({ where: { type: "example", text: clean }, select: { id: true, kind: true } });
  if (same?.kind === kind) return null; // already an example — nothing new to undo
  if (same) await db.communityModerationRule.deleteMany({ where: { id: same.id } });
  const sideCount = await db.communityModerationRule.count({ where: { type: "example", kind } });
  if (sideCount >= MAX_EXAMPLES_PER_KIND) {
    const oldest = await db.communityModerationRule.findFirst({
      where: { type: "example", kind, source: "review" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!oldest) return null; // every slot holds an example the team typed in — those are never dropped
    await db.communityModerationRule.deleteMany({ where: { id: oldest.id } });
  }
  const row = await db.communityModerationRule.create({
    data: { tenantId: actor.tenantId, type: "example", kind, text: clean, source, createdBy: actor.authorKey },
  });
  return row.id;
}

/**
 * restore = false alarm: the message comes back and the offense stops counting.
 * confirm = keep it hidden — or hide it now, for a borderline message held for review.
 * Either way (unless teach is false) the message becomes an example Jev sees next time.
 * Decisions can be changed later from the other tabs.
 */
export async function reviewFlag(actor: CommunityActor, flagId: string, body: unknown): Promise<Outcome<FlagActionResult>> {
  const review = parseFlagReview(body);
  if (!review) return { kind: "invalid", message: "Choose restore or confirm." };
  if (review.action === "reopen") return reopenFlag(actor, flagId);
  const now = new Date();
  const muteAfter = settingsOf(actor).muteAfter;
  return withTenant(actor.tenantId, async (db): Promise<Outcome<FlagActionResult>> => {
    const flag = await db.communityFlag.findFirst({ where: { id: flagId } });
    if (!flag) return { kind: "not_found" };
    const status: FlagStatus = review.action === "restore" ? "dismissed" : "confirmed";
    await db.communityFlag.updateMany({ where: { id: flag.id }, data: { status, reviewedAt: now, reviewedBy: actor.authorKey } });
    const message = await db.communityMessage.findFirst({ where: { id: flag.messageId }, select: { body: true } });
    const exampleId = review.teach && message?.body ? await teach(db, actor, review.action === "restore" ? "allow" : "block", message.body) : null;
    const ref = parseParticipantKey(flag.senderKey);

    if (review.action === "confirm") {
      // Hide it if it's showing: held for review, or restored earlier. A message its sender deleted stays deleted.
      await db.communityMessage.updateMany({ where: { id: flag.messageId, deletedAt: null }, data: { deletedAt: now, moderatedAt: now } });
      if (ref?.kind === "customer") await autoMuteIfDue(db, flag.senderKey, ref.id, muteAfter, now);
      return { kind: "ok", value: { status, exampleId } };
    }

    // Bumping moderatedAt is what makes open chats' polls pick the message back up.
    await db.communityMessage.updateMany({ where: { id: flag.messageId, moderatedAt: { not: null } }, data: { deletedAt: null, moderatedAt: now } });
    if (ref?.kind === "customer") {
      const offenses = (await offenseCounts(db, [flag.senderKey])).get(flag.senderKey) ?? 0;
      const member = await db.communityMember.findFirst({ where: { customerId: ref.id }, select: { mutedBy: true } });
      if (member && shouldLiftAutoMute(offenses, muteAfter, member.mutedBy)) {
        await db.communityMember.updateMany({ where: { customerId: ref.id }, data: { mutedAt: null, mutedBy: null } });
      }
    }
    return { kind: "ok", value: { status, exampleId } };
  });
}

/** Undo of a review: pending again, and the message back how the bot left it (hidden, or visible and held). */
async function reopenFlag(actor: CommunityActor, flagId: string): Promise<Outcome<FlagActionResult>> {
  const now = new Date();
  const muteAfter = settingsOf(actor).muteAfter;
  return withTenant(actor.tenantId, async (db): Promise<Outcome<FlagActionResult>> => {
    const flag = await db.communityFlag.findFirst({ where: { id: flagId } });
    if (!flag) return { kind: "not_found" };
    await db.communityFlag.updateMany({ where: { id: flag.id }, data: { status: "pending", reviewedAt: null, reviewedBy: null } });
    const ref = parseParticipantKey(flag.senderKey);
    if (flag.action === "hide") {
      await db.communityMessage.updateMany({ where: { id: flag.messageId, deletedAt: null }, data: { deletedAt: now, moderatedAt: now } });
      if (ref?.kind === "customer") await autoMuteIfDue(db, flag.senderKey, ref.id, muteAfter, now);
    } else {
      // Only a hide by moderation is undone — never a message its sender deleted.
      await db.communityMessage.updateMany({ where: { id: flag.messageId, moderatedAt: { not: null } }, data: { deletedAt: null, moderatedAt: now } });
      if (ref?.kind === "customer") {
        const offenses = (await offenseCounts(db, [flag.senderKey])).get(flag.senderKey) ?? 0;
        const member = await db.communityMember.findFirst({ where: { customerId: ref.id }, select: { mutedBy: true } });
        if (member && shouldLiftAutoMute(offenses, muteAfter, member.mutedBy)) {
          await db.communityMember.updateMany({ where: { customerId: ref.id }, data: { mutedAt: null, mutedBy: null } });
        }
      }
    }
    return { kind: "ok", value: { status: "pending", exampleId: null } };
  });
}

// ── rules, examples and the test box ─────────────────────────────────────────

/** Replaces the store's rule list (the first save turns the starter rules into the store's own). */
export async function saveRules(actor: CommunityActor, body: unknown): Promise<Outcome<ModerationPolicy>> {
  const input = parseRulesInput(body);
  if (!input.ok) return { kind: "invalid", message: input.error };
  return withTenant(actor.tenantId, async (db) => {
    // Two saves at once would each delete-then-insert and leave both lists behind.
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`moderation-rules:${actor.tenantId}`}))::text AS locked`;
    await db.communityModerationRule.deleteMany({ where: { type: "rule" } });
    // One timestamp apart each, so the saved order is the order they're read back in.
    const base = Date.now();
    await db.communityModerationRule.createMany({
      data: input.value.map((r, i) => ({
        tenantId: actor.tenantId,
        type: "rule",
        kind: r.kind,
        text: r.text,
        createdBy: actor.authorKey,
        createdAt: new Date(base + i),
      })),
    });
    return { kind: "ok" as const, value: policyView(await loadPolicy(db, actor.storeName)) };
  });
}

export async function addExample(actor: CommunityActor, body: unknown): Promise<Outcome<ModerationPolicy>> {
  const input = parseExampleInput(body);
  if (!input.ok) return { kind: "invalid", message: input.error };
  return withTenant(actor.tenantId, async (db): Promise<Outcome<ModerationPolicy>> => {
    const id = await teach(db, actor, input.value.kind, input.value.text, "owner");
    const kept = id !== null || (await db.communityModerationRule.count({ where: { type: "example", kind: input.value.kind, text: exampleText(input.value.text) } })) > 0;
    if (!kept) return { kind: "invalid", message: `That list is full (${MAX_EXAMPLES_PER_KIND}). Remove an older example first.` };
    return { kind: "ok", value: policyView(await loadPolicy(db, actor.storeName)) };
  });
}

export async function deleteExample(actor: CommunityActor, exampleId: string): Promise<Outcome<ModerationPolicy>> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(exampleId)) return { kind: "not_found" };
  return withTenant(actor.tenantId, async (db): Promise<Outcome<ModerationPolicy>> => {
    const gone = await db.communityModerationRule.deleteMany({ where: { id: exampleId, type: "example" } });
    if (gone.count === 0) return { kind: "not_found" };
    return { kind: "ok", value: policyView(await loadPolicy(db, actor.storeName)) };
  });
}

/** Runs a message past Jev with the store's current rules — nothing is saved, hidden or counted. */
export async function testMessage(actor: CommunityActor, body: unknown): Promise<Outcome<ModerationTestResult>> {
  const input = parseTestInput(body);
  if (!input.ok) return { kind: "invalid", message: input.error };
  const { score, verdict, reason } = await judge(actor, "channel", input.value);
  const health: JevHealth = await jevHealth();
  return {
    kind: "ok",
    value: {
      verdict: verdict ?? "allow",
      score,
      confidence: score === null ? null : confidenceLabel(score),
      reason: verdict ? reason : null,
      health,
    },
  };
}

export type SanctionResult = { customerId: string; muted: boolean; banned: boolean };

/** Mute / unmute / ban / unban one member. A ban also locks their login and drops any admin role. */
export async function sanctionMember(actor: CommunityActor, customerId: string, body: unknown): Promise<Outcome<SanctionResult>> {
  const action = parseSanction(body);
  if (!action) return { kind: "invalid", message: "Choose mute, unmute, ban or unban." };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(customerId)) return { kind: "not_found" };
  const now = new Date();
  return withTenant(actor.tenantId, async (db): Promise<Outcome<SanctionResult>> => {
    const member = await db.communityMember.findFirst({ where: { customerId } });
    if (!member) return { kind: "not_found" };
    if (action === "mute") {
      await db.communityMember.updateMany({ where: { customerId }, data: { mutedAt: now, mutedBy: actor.authorKey } });
    } else if (action === "unmute") {
      await db.communityMember.updateMany({ where: { customerId }, data: { mutedAt: null, mutedBy: null } });
    } else if (action === "ban") {
      if (member.bannedAt) return { kind: "invalid", message: "This member is already banned." };
      // Disabled + a new sessionVersion: every live session stops resolving and sign-in is refused.
      // Only an ACTIVE account is locked by the ban (and so only that one is unlocked by an unban).
      const locked = await db.storefrontCustomer.updateMany({
        where: { id: customerId, status: "active" },
        data: { status: "disabled", sessionVersion: { increment: 1 } },
      });
      await db.communityMember.updateMany({
        where: { customerId },
        data: { status: "revoked", reason: BAN_REASON, bannedAt: now, banLockedAccount: locked.count === 1, isAdmin: false, reviewedAt: now, reviewedBy: actor.authorKey },
      });
      // Messages held for review are still visible — the ban hides them with the rest.
      const held = await db.communityFlag.findMany({ where: { senderKey: customerKey(customerId), status: "pending", action: "review" }, select: { messageId: true } });
      if (held.length > 0) {
        await db.communityMessage.updateMany({ where: { id: { in: held.map((f) => f.messageId) }, deletedAt: null }, data: { deletedAt: now, moderatedAt: now } });
      }
      await db.communityFlag.updateMany({
        where: { senderKey: customerKey(customerId), status: "pending" },
        data: { status: "confirmed", reviewedAt: now, reviewedBy: actor.authorKey },
      });
    } else {
      if (!member.bannedAt) return { kind: "invalid", message: "This member isn't banned." };
      await db.communityMember.updateMany({
        where: { customerId },
        data: { status: "approved", reason: null, bannedAt: null, banLockedAccount: false, mutedAt: null, mutedBy: null, reviewedAt: now, reviewedBy: actor.authorKey },
      });
      if (member.banLockedAccount) {
        await db.storefrontCustomer.updateMany({ where: { id: customerId, status: "disabled" }, data: { status: "active" } });
      }
    }
    const updated = await db.communityMember.findFirst({ where: { customerId }, select: { mutedAt: true, bannedAt: true } });
    return { kind: "ok", value: { customerId, muted: !!updated?.mutedAt, banned: !!updated?.bannedAt } };
  });
}
