import "server-only";

import { Prisma, type CommunityChannel as ChannelRow, type CommunityMessage as MessageRow, type CommunityTopic as TopicRow } from "@prisma/client";
import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import type {
  ChannelDetailResponse,
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
import { canDeleteTopic, canManageChannel, canManageTopic, canPostInChannel } from "./rules";
import { countUnreadChats, readBaseline } from "./unread";
import { parseChannelInput, parseTopicInput } from "./validate";
import { findOwnUpload } from "./uploads.server";
import { messagePreview } from "./view.server";
import type { Outcome } from "./messages.server";

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
  data: { name: string; description: string | null; emoji: string; imageUrl?: string | null; postRole: string; sortOrder: number },
): Promise<ChannelRow> {
  const channel = await db.communityChannel.create({ data: { ...data, tenantId: actor.tenantId } });
  await db.communityTopic.create({
    data: { tenantId: actor.tenantId, channelId: channel.id, name: "General", emoji: data.emoji, isGeneral: true, createdByKey: actor.key },
  });
  return channel;
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
    canPost: canPostInChannel(actor, channel.postRole),
    canManage: canManageTopic(actor),
    canDelete: canDeleteTopic(actor, t),
  };
}

function channelView(actor: CommunityActor, c: ChannelRow, topics: TopicRow[], stats: TopicStats): CommunityChannel | null {
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
    sortOrder: c.sortOrder,
    topicCount: topics.length,
    generalTopicId: general.id,
    lastMessageAt: last?.toISOString() ?? null,
    preview: preview(actor, newest, stats),
    previewTopic: newest ? (topics.find((t) => t.id === newest.topicId)?.name ?? null) : null,
    unread: topics.reduce((n, t) => n + (stats.unread.get(t.id) ?? 0), 0),
    canPost: canPostInChannel(actor, c.postRole),
    canManage: canManageChannel(actor),
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
    const [channels, topics, conversations] = await Promise.all([
      db.communityChannel.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: MAX_CHANNELS }),
      db.communityTopic.findMany({}),
      db.communityConversation.findMany({
        where: { OR: [{ lowKey: actor.key }, { highKey: actor.key }] },
        orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
        take: MAX_CONVERSATIONS,
      }),
    ]);
    const convIds = conversations.map((c) => c.id);
    const peerKeys = conversations.map((c) => dmPeerOf(c, actor.key)!);
    const [stats, convUnread, convLatest] = await Promise.all([
      topicStats(db, actor, topics.map((t) => t.id), peerKeys),
      unreadByThread(db, actor, "dm", convIds),
      latestByThread(db, "dm", actor.tenantId, convIds),
    ]);
    const extra = [...convLatest.values()].map((m) => m.senderKey).filter((k) => !stats.participants.has(k));
    if (extra.length) for (const [k, v] of await loadParticipants(db, actor.tenant, extra)) stats.participants.set(k, v);

    const byChannel = new Map<string, TopicRow[]>();
    for (const t of topics) byChannel.set(t.channelId, [...(byChannel.get(t.channelId) ?? []), t]);
    const channelViews = channels
      .map((c) => channelView(actor, c, byChannel.get(c.id) ?? [], stats))
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
  if (!channel) return null;
  const topics = sortTopics(await db.communityTopic.findMany({ where: { channelId } }));
  const stats = await topicStats(db, actor, topics.map((t) => t.id));
  const view = channelView(actor, channel, topics, stats);
  return view ? { channel: view, topics: topics.map((t) => topicView(actor, t, channel, stats)) } : null;
}

export async function getChannel(actor: CommunityActor, channelId: string): Promise<Outcome<ChannelDetailResponse>> {
  if (!ID_RE.test(channelId)) return NOT_FOUND;
  const res = await withTenant(actor.tenantId, (db) => detail(db, actor, channelId));
  return res ? { kind: "ok", value: res } : NOT_FOUND;
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
    if (!channel) return NOT_FOUND;
    if (!canPostInChannel(actor, channel.postRole)) return forbidden("Only the store team can add topics here.");
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
