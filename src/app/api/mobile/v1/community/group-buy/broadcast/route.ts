import { after } from "next/server";
import { broadcastGroupBuy } from "@/lib/community/group-buy.server";
import { communityLimit } from "@/lib/community/limits.server";
import { claimGroupBuyPushSlot, notifyGroupBuy } from "@/lib/community/push.server";
import { respond } from "@/lib/community/respond";
import { ok, readJson, withCommunity } from "@/lib/mobile/http";

// POST /api/mobile/v1/community/group-buy/broadcast  GroupBuyBroadcastRequest →
// GroupBuyBroadcastResponse (moderators). Posts the live round's card into each
// channel's General topic, then pushes every approved member — only when this
// call actually posted something (a retry of a finished broadcast pushes nobody),
// and at most once per round every 30 minutes per store.
export async function POST(req: Request) {
  return withCommunity(req, { route: "community/group-buy/broadcast", team: true }, async (actor) => {
    const limited = communityLimit("broadcast", actor);
    if (limited) return limited;
    const res = await broadcastGroupBuy(actor, await readJson(req));
    if (res.kind !== "ok") return respond(res);
    const { posted, topicIds, card } = res.value;
    if (posted > 0 && claimGroupBuyPushSlot(actor.tenantId, card.id)) {
      after(() => notifyGroupBuy({ tenantId: actor.tenantId, topicId: topicIds[0], roundName: card.name, storeName: actor.storeName }));
    }
    return ok({ posted, topicIds });
  });
}
