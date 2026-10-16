import "server-only";

import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db/tenant-client";
import type { GroupBuyBroadcastResponse, GroupBuyCard, LiveGroupBuyResponse } from "@/lib/mobile/contract";
import type { CommunityActor } from "./actor.server";
import { loadLiveGroupBuyCard, ROUND_NOT_OPEN } from "./group-buy-cards.server";
import { insertMessage, type Outcome } from "./messages.server";
import { parseGroupBuyBroadcast } from "./validate";

/**
 * "Send the group buy to everyone": a moderator posts the live round's card
 * into each chosen channel's General topic as the store, in ONE transaction,
 * then the route pushes every approved member once. Each card's clientId is
 * `<broadcast clientId>:<topicId>`, so a retry posts only what is missing.
 * Cost: 2 queries + 2 per channel (≤ 20 channels), well inside one withTenant.
 */

export async function liveGroupBuy(actor: CommunityActor): Promise<LiveGroupBuyResponse> {
  // In preview the round shows only while the store lets them see group buys.
  if (actor.preview && !actor.preview.viewGroupBuys) return { groupBuy: null, canBroadcast: false };
  return { groupBuy: await loadLiveGroupBuyCard(actor), canBroadcast: actor.isTeam === true };
}

export type BroadcastResult = GroupBuyBroadcastResponse & { card: GroupBuyCard };

export async function broadcastGroupBuy(actor: CommunityActor, body: unknown, isRetry = false): Promise<Outcome<BroadcastResult>> {
  if (!actor.isTeam) return { kind: "forbidden", message: "Only the store team can send to everyone." };
  const input = parseGroupBuyBroadcast(body);
  if (!input.ok) return { kind: "invalid", message: input.error };
  const card = await loadLiveGroupBuyCard(actor, { fresh: true });
  if (!card || card.status !== "open") return { kind: "invalid", message: ROUND_NOT_OPEN };
  const { channelIds, note } = input.value;
  const now = new Date();

  try {
    return await postCards(actor, card, input.value.clientId, channelIds, note, now);
  } catch (e) {
    // A timed-out request and its retry racing on the same clientId: the loser
    // re-reads the winner's cards (posted: 0) instead of failing the moderator.
    if (!isRetry && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return broadcastGroupBuy(actor, body, true);
    throw e;
  }
}

async function postCards(
  actor: CommunityActor,
  card: GroupBuyCard,
  clientId: string,
  channelIds: string[],
  note: string | null,
  now: Date,
): Promise<Outcome<BroadcastResult>> {
  return withTenant(actor.tenantId, async (db): Promise<Outcome<BroadcastResult>> => {
    const generals = await db.communityTopic.findMany({
      where: { channelId: { in: channelIds }, isGeneral: true },
      select: { id: true },
    });
    if (generals.length === 0) return { kind: "invalid", message: "Pick at least one channel." };
    const perTopic = (topicId: string) => `${clientId}:${topicId}`;
    const already = await db.communityMessage.findMany({
      where: { senderKey: actor.key, clientId: { in: generals.map((t) => perTopic(t.id)) } },
      select: { topicId: true },
    });
    const done = new Set(already.map((m) => m.topicId));
    const todo = generals.filter((t) => !done.has(t.id));
    for (const t of todo) {
      await insertMessage(
        db,
        actor,
        { type: "topic", id: t.id },
        { topicId: t.id, kind: "groupbuy", body: note, groupBuyId: card.id, clientId: perTopic(t.id) },
        now,
      );
    }
    return { kind: "ok", value: { posted: todo.length, topicIds: generals.map((t) => t.id), card } };
  });
}
