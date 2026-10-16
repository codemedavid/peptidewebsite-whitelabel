import "server-only";

import { Prisma, type CommunityChannel as ChannelRow, type CommunityMessage as MessageRow, type CommunityTopic as TopicRow } from "@prisma/client";
import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import type {
  ChannelDetailResponse,
  ChannelMuteResponse,
  CommunityChannel,
  CommunityConversation,
  CommunityTopic,
  InboxResponse,
  MessagePreview,
  ThreadType,
} from "@/lib/mobile/contract";
import type { CommunityActor } from "./actor.server";
import { listActiveDrops } from "./drops.server";
import { STORE_KEY, dmPeerOf } from "./keys";
import { loadParticipants, publicParticipant, type MemberCard } from "./participants.server";
import { MUTED_REASON } from "./moderation";
import { HUB_TOPICS, isHub } from "./hub";
import { canAddTopic, canDeleteTopic, canListChannel, canManageChannel, canManageTopic, canPostInTopic, canSeeChannel } from "./rules";
import { channelPreviewAccess } from "./preview";
import { countUnreadChats, readBaseline } from "./unread";
import { parseChannelInput, parseTopicInput } from "./validate";
import { findOwnUpload } from "./uploads.server";
import { messagePreview } from "./view.server";
import { parseMuteRequest } from "./topic-push";
import type { Outcome } from "./messages.server";
import { welcomeIfNew } from "./welcome.server";

/**
 * Channels, topics and the inbox. The inbox is built in a fixed number of
 * batched queries (unread counts and previews come from one GROUP BY / DISTINCT
 * ON each), well inside withTenant()'s round-trip budget however many threads
 * a store has.
 */

const MAX_CHANNELS = 100;
const MAX_CONVERSATIONS = 200;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const NOT_FOUND = { kind: "not_found" } as const;
const invalid = (message: string) => ({ kind: "invalid", message }) as const;
const forbidden = (message: string) => ({ kind: "forbidden", message }) as const;
const MODERATORS_ONLY = "Only the store team can do this.";
const BAD_PICTURE = "Upload the picture again.";

/** A channel/topic picture must be an image this participant uploaded here. */
async function pictureOk(db: TenantTx, actor: CommunityActor, url: string | null): Promise<boolean> {
  return url === null || (await findOwnUpload(db, actor, url, "image")) !== null;
}

/** Serialise the first-visit bootstrap per tenant (transaction-scoped advisory lock). */
async function lockBootstrap(db: TenantTx, tenantId: string): Promise<void> {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`community-bootstrap:${tenantId}`}))::text AS locked`;
}

// ── bootstrap ────────────────────────────────────────────────────────────────

const DEFAULT_CHANNELS = [
  { name: "Announcements", description: "News from the store.", emoji: "📣", postRole: "admins", sortOrder: 0 },
  { name: "Community", description: "Chat with the store and other members.", emoji: "💬", postRole: "everyone", sortOrder: 1 },
] as const;

async function createChannelWithGeneral(
  db: TenantTx,
  actor: CommunityActor,
  data: { name: string; description: string | null; emoji: string; imageUrl?: string | null; postRole: string; audience?: string; sortOrder: number },
): Promise<ChannelRow> {
  const channel = await db.communityChannel.create({ data: { ...data, tenantId: actor.tenantId } });
  const general = isHub(channel) ? HUB_TOPICS.onHand : { name: "General", emoji: data.emoji };
  await db.communityTopic.create({
    data: { tenantId: actor.tenantId, channelId: channel.id, ...general, isGeneral: true, createdByKey: actor.key },
  });
  if (isHub(channel)) await ensureHubTopics(db, actor, channel.id);
  return channel;
}

/**
 * A hub's General topic is "On hand" and it always has a "Looking for" topic.
 * Run when a channel becomes a hub; safe to repeat (never duplicates, never
 * renames a General topic the team already renamed).
 */
async function ensureHubTopics(db: TenantTx, actor: CommunityActor, channelId: string): Promise<void> {
  const topics = await db.communityTopic.findMany({ where: { channelId }, select: { id: true, name: true, isGeneral: true } });
  const general = topics.find((t) => t.isGeneral);
  if (general && general.name === "General") {
    await db.communityTopic.updateMany({ where: { id: general.id }, data: { ...HUB_TOPICS.onHand } });
  }
  const wanted = HUB_TOPICS.lookingFor.name.toLowerCase();
  if (!topics.some((t) => !t.isGeneral && t.name.toLowerCase() === wanted)) {
    await db.communityTopic.create({
      data: { tenantId: actor.tenantId, channelId, ...HUB_TOPICS.lookingFor, createdByKey: actor.key },
    });
  }
}

/**
 * The first visit to an empty community seeds the two starter channels. Any
 * member may trigger it — in an open community a customer often arrives before
 * the owner ever opens Chats — and the channels are always the store's own.
 */
async function bootstrapIfEmpty(db: TenantTx, actor: CommunityActor): Promise<void> {
  if ((await db.communityChannel.count()) > 0) return;
  // Two moderators opening an empty community at once: the second waits here,
  // then re-checks and finds the first one's channels.
  await lockBootstrap(db, actor.tenantId);
  if ((await db.communityChannel.count()) > 0) return;
  const asStore = { ...actor, key: STORE_KEY };
  for (const c of DEFAULT_CHANNELS) await createChannelWithGeneral(db, asStore, { ...c });
}

// ── unread + previews (batched) ──────────────────────────────────────────────

async function unreadByThread(db: TenantTx, actor: CommunityActor, type: ThreadType, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const column = type === "topic" ? Prisma.sql`m."topicId"` : Prisma.sql`m."conversationId"`;
  const baseline = readBaseline(null, actor.joinedAt);
  const rows = await db.$queryRaw<Array<{ threadId: string; n: number }>>`
    SELECT ${column} AS "threadId", COUNT(*)::int AS n
    FROM community_messages m
    LEFT JOIN community_reads r
      ON r."tenantId" = m."tenantId" AND r."participantKey" = ${actor.key}
     AND r."threadType" = ${type} AND r."threadId" = ${column}
    WHERE m."tenantId" = ${actor.tenantId}
      AND ${column} IN (${Prisma.join(ids)})
      AND m."deletedAt" IS NULL
      AND m."senderKey" <> ${actor.key}
      AND m."createdAt" > GREATEST(COALESCE(r."lastReadAt", ${baseline}), ${baseline})
    GROUP BY ${column}`;
  for (const r of rows) out.set(r.threadId, Number(r.n));
  return out;
}

async function latestByThread(db: TenantTx, type: ThreadType, tenantId: string, ids: string[]): Promise<Map<string, MessageRow>> {
  const out = new Map<string, MessageRow>();
  if (ids.length === 0) return out;
  const column = type === "topic" ? Prisma.sql`"topicId"` : Prisma.sql`"conversationId"`;
  const latest = await db.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT ON (${column}) id FROM community_messages
    WHERE "tenantId" = ${tenantId} AND ${column} IN (${Prisma.join(ids)}) AND "deletedAt" IS NULL
    ORDER BY ${column}, "createdAt" DESC, id DESC`;
  if (latest.length === 0) return out;
  const rows = await db.communityMessage.findMany({ where: { id: { in: latest.map((l) => l.id) } } });
  for (const r of rows) out.set((type === "topic" ? r.topicId : r.conversationId)!, r);
  return out;
}

// ── views ────────────────────────────────────────────────────────────────────

type TopicStats = { unread: Map<string, number>; latest: Map<string, MessageRow>; participants: Map<string, MemberCard> };

function preview(actor: CommunityActor, row: MessageRow | undefined, stats: TopicStats): MessagePreview | null {
  return row ? messagePreview(actor, row, stats.participants) : null;
}

function topicView(actor: CommunityActor, t: TopicRow, channel: ChannelRow, stats: TopicStats): CommunityTopic {
  return {
    id: t.id,
    channelId: t.channelId,
    name: t.name,
    emoji: t.emoji,
    imageUrl: t.imageUrl,
    isGeneral: t.isGeneral,
    isPinned: t.isPinned,
    lastMessageAt: t.lastMessageAt?.toISOString() ?? null,
    messageCount: t.messageCount,
    preview: preview(actor, stats.latest.get(t.id), stats),
    unread: stats.unread.get(t.id) ?? 0,
    canPost: canPostInTopic(actor, channel, t),
    canManage: canManageTopic(actor),
    canDelete: canDeleteTopic(actor, t),
  };
}

/**
 * The channels this reader muted — only full members, the only ones a channel
 * message pushes (null for the store team and for people in preview).
 */
async function mutedChannels(db: TenantTx, actor: CommunityActor): Promise<ReadonlySet<string> | null> {
  if (!actor.customerId || actor.preview) return null;
  const rows = await db.communityChannelMute.findMany({ where: { participantKey: actor.key }, select: { channelId: true } });
  return new Set(rows.map((r) => r.channelId));
}

function channelView(
  actor: CommunityActor,
  c: ChannelRow,
  topics: TopicRow[],
  stats: TopicStats,
  muted: ReadonlySet<string> | null = null,
): CommunityChannel | null {
  const general = topics.find((t) => t.isGeneral);
  if (!general) return null;
  const newest = topics
    .map((t) => stats.latest.get(t.id))
    .filter((m): m is MessageRow => !!m)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const last = topics.reduce<Date | null>((acc, t) => (t.lastMessageAt && (!acc || t.lastMessageAt > acc) ? t.lastMessageAt : acc), null);
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    emoji: c.emoji,
    imageUrl: c.imageUrl,
    postRole: c.postRole === "admins" ? "admins" : "everyone",
    audience: isHub(c) ? "hub" : "everyone",
    sortOrder: c.sortOrder,
    topicCount: topics.length,
    generalTopicId: general.id,
    lastMessageAt: last?.toISOString() ?? null,
    preview: preview(actor, newest, stats),
    previewTopic: newest ? (topics.find((t) => t.id === newest.topicId)?.name ?? null) : null,
    unread: topics.reduce((n, t) => n + (stats.unread.get(t.id) ?? 0), 0),
    // A channel-level "post" is starting a topic (the New topic button).
    canPost: canAddTopic(actor, c),
    canManage: canManageChannel(actor),
    ...(actor.isModerator ? { previewAccess: channelPreviewAccess(c.previewAccess) } : {}),
    ...(muted ? { muted: muted.has(c.id) } : {}),
  };
}

/**
 * A channel someone in preview may see listed but not open: its name, emoji
 * and description only — no topics, previews or unread counts.
 */
function lockedChannelView(c: ChannelRow): CommunityChannel {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    emoji: c.emoji,
    imageUrl: c.imageUrl,
    postRole: c.postRole === "admins" ? "admins" : "everyone",
    audience: isHub(c) ? "hub" : "everyone",
    sortOrder: c.sortOrder,
    topicCount: 0,
    generalTopicId: "",
    lastMessageAt: null,
    preview: null,
    previewTopic: null,
    unread: 0,
    canPost: false,
    canManage: false,
    locked: true,
  };
}

async function topicStats(db: TenantTx, actor: CommunityActor, topicIds: string[], extraKeys: string[] = []): Promise<TopicStats> {
  const [unread, latest] = await Promise.all([
    unreadByThread(db, actor, "topic", topicIds),
    latestByThread(db, "topic", actor.tenantId, topicIds),
  ]);
  const participants = await loadParticipants(db, actor.tenant, [...[...latest.values()].map((m) => m.senderKey), ...extraKeys]);
  return { unread, latest, participants };
}

function sortTopics(topics: TopicRow[]): TopicRow[] {
  const rank = (t: TopicRow) => (t.isGeneral ? 0 : t.isPinned ? 1 : 2);
  return [...topics].sort(
    (a, b) => rank(a) - rank(b) || (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0) || a.name.localeCompare(b.name),
  );
}

// ── inbox ────────────────────────────────────────────────────────────────────

export async function buildInbox(actor: CommunityActor): Promise<InboxResponse> {
  const now = new Date();
  return withTenant(actor.tenantId, async (db) => {
    await bootstrapIfEmpty(db, actor);
    await welcomeIfNew(db, actor, now);
    const [allChannels, allTopics, conversations] = await Promise.all([
      db.communityChannel.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: MAX_CHANNELS }),
      db.communityTopic.findMany({}),
      db.communityConversation.findMany({
        where: { OR: [{ lowKey: actor.key }, { highKey: actor.key }] },
        orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
        take: MAX_CONVERSATIONS,
      }),
    ]);
    // Channels this reader can't see are left out entirely — topics, unread and previews too.
    // (In preview a "locked" channel is still listed, as its name alone.)
    const listed = allChannels.filter((c) => canListChannel(actor, c));
    const channels = listed.filter((c) => canSeeChannel(actor, c));
    const visible = new Set(channels.map((c) => c.id));
    const topics = allTopics.filter((t) => visible.has(t.channelId));
    const convIds = conversations.map((c) => c.id);
    const peerKeys = conversations.map((c) => dmPeerOf(c, actor.key)!);
    const [stats, convUnread, convLatest, muted] = await Promise.all([
      topicStats(db, actor, topics.map((t) => t.id), peerKeys),
      unreadByThread(db, actor, "dm", convIds),
      latestByThread(db, "dm", actor.tenantId, convIds),
      mutedChannels(db, actor),
    ]);
    const extra = [...convLatest.values()].map((m) => m.senderKey).filter((k) => !stats.participants.has(k));
    if (extra.length) for (const [k, v] of await loadParticipants(db, actor.tenant, extra)) stats.participants.set(k, v);

    const byChannel = new Map<string, TopicRow[]>();
    for (const t of topics) byChannel.set(t.channelId, [...(byChannel.get(t.channelId) ?? []), t]);
    const channelViews = listed
      .map((c) => (visible.has(c.id) ? channelView(actor, c, byChannel.get(c.id) ?? [], stats, muted) : lockedChannelView(c)))
      .filter((c): c is CommunityChannel => !!c);
    const conversationViews: CommunityConversation[] = conversations.map((c, i) => ({
      id: c.id,
      peer: publicParticipant(stats.participants.get(peerKeys[i])!),
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      messageCount: c.messageCount,
      preview: convLatest.has(c.id) ? messagePreview(actor, convLatest.get(c.id)!, stats.participants) : null,
      unread: convUnread.get(c.id) ?? 0,
    }));
    return {
      channels: channelViews,
      conversations: conversationViews,
      drops: await listActiveDrops(db, actor, now),
      unreadChats: countUnreadChats(channelViews, conversationViews),
    };
  });
}

// ── channels ─────────────────────────────────────────────────────────────────

async function detail(db: TenantTx, actor: CommunityActor, channelId: string): Promise<ChannelDetailResponse | null> {
  const channel = await db.communityChannel.findFirst({ where: { id: channelId } });
  if (!channel || !canSeeChannel(actor, channel)) return null;
  const topics = sortTopics(await db.communityTopic.findMany({ where: { channelId } }));
  const [stats, muted] = await Promise.all([topicStats(db, actor, topics.map((t) => t.id)), mutedChannels(db, actor)]);
  const view = channelView(actor, channel, topics, stats, muted);
  return view ? { channel: view, topics: topics.map((t) => topicView(actor, t, channel, stats)) } : null;
}

export async function getChannel(actor: CommunityActor, channelId: string): Promise<Outcome<ChannelDetailResponse>> {
  if (!ID_RE.test(channelId)) return NOT_FOUND;
  const res = await withTenant(actor.tenantId, (db) => detail(db, actor, channelId));
  return res ? { kind: "ok", value: res } : NOT_FOUND;
}

/**
 * Mute / unmute a channel's chat messages on this member's phones. Members
 * only — the store team and people in preview get no channel pushes. Safe to
 * repeat (muting twice is one row; unmuting what isn't muted is a no-op).
 */
export async function setChannelMute(actor: CommunityActor, channelId: string, body: unknown): Promise<Outcome<ChannelMuteResponse>> {
  if (!ID_RE.test(channelId)) return NOT_FOUND;
  const muted = parseMuteRequest(body);
  if (muted === null) return invalid("Choose whether to mute this channel.");
  if (!actor.customerId || actor.preview) return forbidden("Only community members can mute a channel.");
  return withTenant(actor.tenantId, async (db): Promise<Outcome<ChannelMuteResponse>> => {
    const channel = await db.communityChannel.findFirst({ where: { id: channelId } });
    if (!channel || !canSeeChannel(actor, channel)) return NOT_FOUND;
    const where = { tenantId: actor.tenantId, participantKey: actor.key, channelId };
    if (muted) {
      await db.communityChannelMute.upsert({ where: { tenantId_participantKey_channelId: where }, create: where, update: {} });
    } else {
      await db.communityChannelMute.deleteMany({ where: { participantKey: actor.key, channelId } });
    }
    return { kind: "ok", value: { channelId, muted } };
  });
}

export async function createChannel(actor: CommunityActor, body: unknown): Promise<Outcome<CommunityChannel>> {
  if (!canManageChannel(actor)) return forbidden(MODERATORS_ONLY);
  const input = parseChannelInput(body);
  if (!input.ok) return invalid(input.error);
  return withTenant(actor.tenantId, async (db): Promise<Outcome<CommunityChannel>> => {
    if (!(await pictureOk(db, actor, input.value.imageUrl))) return invalid(BAD_PICTURE);
    const last = await db.communityChannel.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const channel = await createChannelWithGeneral(db, actor, { ...input.value, sortOrder: (last?.sortOrder ?? -1) + 1 });
    const res = await detail(db, actor, channel.id);
    return { kind: "ok", value: res!.channel };
  });
}

export async function updateChannel(actor: CommunityActor, channelId: string, body: unknown): Promise<Outcome<CommunityChannel>> {
  if (!canManageChannel(actor)) return forbidden(MODERATORS_ONLY);
  if (!ID_RE.test(channelId)) return NOT_FOUND;
  const input = parseChannelInput(body);
  if (!input.ok) return invalid(input.error);
  return withTenant(actor.tenantId, async (db): Promise<Outcome<CommunityChannel>> => {
    if (!(await pictureOk(db, actor, input.value.imageUrl))) return invalid(BAD_PICTURE);
    const updated = await db.communityChannel.updateMany({ where: { id: channelId }, data: input.value });
    if (updated.count !== 1) return NOT_FOUND;
    if (input.value.audience === "hub") await ensureHubTopics(db, actor, channelId);
    const res = await detail(db, actor, channelId);
    return res ? { kind: "ok", value: res.channel } : NOT_FOUND;
  });
}

export async function deleteChannel(actor: CommunityActor, channelId: string): Promise<Outcome<{ deleted: true }>> {
  if (!canManageChannel(actor)) return forbidden(MODERATORS_ONLY);
  if (!ID_RE.test(channelId)) return NOT_FOUND;
  return withTenant(actor.tenantId, async (db): Promise<Outcome<{ deleted: true }>> => {
    // Topics, their messages and drops cascade with the channel.
    const res = await db.communityChannel.deleteMany({ where: { id: channelId } });
    return res.count === 1 ? { kind: "ok", value: { deleted: true } } : NOT_FOUND;
  });
}

// ── topics ───────────────────────────────────────────────────────────────────

async function topicWithChannel(db: TenantTx, topicId: string) {
  if (!ID_RE.test(topicId)) return null;
  return db.communityTopic.findFirst({ where: { id: topicId }, include: { channel: true } });
}

async function oneTopic(db: TenantTx, actor: CommunityActor, topicId: string): Promise<CommunityTopic | null> {
  const t = await topicWithChannel(db, topicId);
  if (!t) return null;
  const { channel, ...topic } = t;
  return topicView(actor, topic, channel, await topicStats(db, actor, [topic.id]));
}

export async function createTopic(actor: CommunityActor, channelId: string, body: unknown): Promise<Outcome<CommunityTopic>> {
  if (!ID_RE.test(channelId)) return NOT_FOUND;
  const input = parseTopicInput(body);
  return withTenant(actor.tenantId, async (db): Promise<Outcome<CommunityTopic>> => {
    const channel = await db.communityChannel.findFirst({ where: { id: channelId } });
    if (!channel || !canSeeChannel(actor, channel)) return NOT_FOUND;
    if (!canAddTopic(actor, channel)) {
      return forbidden(actor.isMuted ? MUTED_REASON : "Only the store team can add topics here.");
    }
    if (!input.ok) return invalid(input.error);
    if (!(await pictureOk(db, actor, input.value.imageUrl))) return invalid(BAD_PICTURE);
    const topic = await db.communityTopic.create({
      data: { ...input.value, tenantId: actor.tenantId, channelId, createdByKey: actor.key },
    });
    return { kind: "ok", value: (await oneTopic(db, actor, topic.id))! };
  });
}

export async function updateTopic(actor: CommunityActor, topicId: string, body: unknown): Promise<Outcome<CommunityTopic>> {
  return withTenant(actor.tenantId, async (db): Promise<Outcome<CommunityTopic>> => {
    const t = await topicWithChannel(db, topicId);
    if (!t) return NOT_FOUND;
    if (!canManageTopic(actor)) return forbidden(MODERATORS_ONLY);
    const input = parseTopicInput(body);
    if (!input.ok) return invalid(input.error);
    if (!(await pictureOk(db, actor, input.value.imageUrl))) return invalid(BAD_PICTURE);
    const pinned = (body as Record<string, unknown>)?.isPinned;
    await db.communityTopic.updateMany({
      where: { id: topicId },
      data: { ...input.value, ...(typeof pinned === "boolean" && !t.isGeneral ? { isPinned: pinned } : {}) },
    });
    return { kind: "ok", value: (await oneTopic(db, actor, topicId))! };
  });
}

export async function deleteTopic(actor: CommunityActor, topicId: string): Promise<Outcome<{ deleted: true }>> {
  return withTenant(actor.tenantId, async (db): Promise<Outcome<{ deleted: true }>> => {
    const t = await topicWithChannel(db, topicId);
    if (!t) return NOT_FOUND;
    if (!canDeleteTopic(actor, t)) {
      return forbidden(t.isGeneral ? "A channel's General topic can't be deleted." : MODERATORS_ONLY);
    }
    await db.communityTopic.deleteMany({ where: { id: topicId } });
    return { kind: "ok", value: { deleted: true } };
  });
}
