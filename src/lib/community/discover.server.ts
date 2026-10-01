import "server-only";

import { Prisma } from "@prisma/client";
import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import type { SearchHit, SearchResponse, SharedResponse, SharedTab, ThreadType } from "@/lib/mobile/contract";
import type { CommunityActor } from "./actor.server";
import { dmPeerOf } from "./keys";
import type { Outcome } from "./messages.server";
import { loadParticipants } from "./participants.server";
import { extractLinks, likePattern, normaliseSearchQuery } from "./text";
import { parseThreadType, resolveThread, threadWhere } from "./thread-access.server";
import { buildMessageViews } from "./view.server";

/**
 * Search (everywhere the reader can see, or one thread) and a thread's Shared
 * tabs (media / docs / links / listings). Deleted messages never match.
 */

const SEARCH_LIMIT = 50;
const SHARED_LIMIT = 100;
const SHARED_TABS = new Set<SharedTab>(["media", "docs", "links", "listings"]);

async function threadTitles(db: TenantTx, actor: CommunityActor, topicIds: string[], convIds: string[]) {
  const [topics, convs] = await Promise.all([
    topicIds.length
      ? db.communityTopic.findMany({ where: { id: { in: topicIds } }, include: { channel: { select: { name: true } } } })
      : Promise.resolve([]),
    convIds.length ? db.communityConversation.findMany({ where: { id: { in: convIds } } }) : Promise.resolve([]),
  ]);
  const peers = convs.map((c) => dmPeerOf(c, actor.key) ?? c.lowKey);
  const people = await loadParticipants(db, actor.tenant, peers);
  const titles = new Map<string, string>();
  for (const t of topics) titles.set(t.id, t.isGeneral ? t.channel.name : `${t.channel.name} › ${t.name}`);
  convs.forEach((c, i) => titles.set(c.id, people.get(peers[i])?.name ?? "Chat"));
  return titles;
}

export async function searchMessages(actor: CommunityActor, params: URLSearchParams): Promise<Outcome<SearchResponse>> {
  const q = normaliseSearchQuery(params.get("q"));
  if (!q) return { kind: "invalid", message: "Type at least 2 characters." };
  const scope = params.get("scope") === "thread" ? "thread" : "everywhere";
  return withTenant(actor.tenantId, async (db): Promise<Outcome<SearchResponse>> => {
    let where: Prisma.Sql;
    if (scope === "thread") {
      const type = parseThreadType(params.get("type") ?? "");
      const access = type ? await resolveThread(db, actor, type, params.get("id") ?? "") : null;
      if (!access) return { kind: "not_found" };
      where = access.type === "topic" ? Prisma.sql`"topicId" = ${access.id}` : Prisma.sql`"conversationId" = ${access.id}`;
    } else {
      // Every topic, plus only the DMs this reader is part of.
      where = Prisma.sql`("topicId" IS NOT NULL OR "conversationId" IN (
        SELECT id FROM community_conversations
        WHERE "tenantId" = ${actor.tenantId} AND (${actor.key} = "lowKey" OR ${actor.key} = "highKey")))`;
    }
    const ids = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM community_messages
      WHERE "tenantId" = ${actor.tenantId} AND "deletedAt" IS NULL
        AND body ILIKE ${likePattern(q)} ESCAPE '\\'
        AND ${where}
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${SEARCH_LIMIT}`;
    if (ids.length === 0) return { kind: "ok", value: { hits: [] } };
    const rows = await db.communityMessage.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const [views, titles] = await Promise.all([
      buildMessageViews(db, actor, rows),
      threadTitles(
        db,
        actor,
        [...new Set(rows.map((r) => r.topicId).filter((x): x is string => !!x))],
        [...new Set(rows.map((r) => r.conversationId).filter((x): x is string => !!x))],
      ),
    ]);
    const hits: SearchHit[] = views.map((m) => ({
      message: m,
      thread: { type: m.threadType, id: m.threadId, title: titles.get(m.threadId) ?? "Chat" },
    }));
    return { kind: "ok", value: { hits } };
  });
}

function tabWhere(tab: SharedTab): Prisma.CommunityMessageWhereInput {
  switch (tab) {
    case "media":
      return { imageUrl: { not: null } };
    case "docs":
      return { fileUrl: { not: null } };
    case "links":
      return { body: { contains: "http" } };
    case "listings":
      return { kind: { in: ["product", "protocol", "drop"] } };
  }
}

export async function sharedItems(
  actor: CommunityActor,
  type: ThreadType,
  id: string,
  tabRaw: string | null,
): Promise<Outcome<SharedResponse>> {
  const tab = (SHARED_TABS.has(tabRaw as SharedTab) ? tabRaw : "media") as SharedTab;
  return withTenant(actor.tenantId, async (db): Promise<Outcome<SharedResponse>> => {
    const access = await resolveThread(db, actor, type, id);
    if (!access) return { kind: "not_found" };
    const rows = await db.communityMessage.findMany({
      where: { ...threadWhere(access), deletedAt: null, ...tabWhere(tab) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: SHARED_LIMIT,
    });
    const kept = tab === "links" ? rows.filter((r) => extractLinks(r.body).length > 0) : rows;
    return { kind: "ok", value: { items: await buildMessageViews(db, actor, kept) } };
  });
}
