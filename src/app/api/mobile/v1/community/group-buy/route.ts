import { liveGroupBuy } from "@/lib/community/group-buy.server";
import { ok, withCommunity } from "@/lib/mobile/http";

// GET /api/mobile/v1/community/group-buy → LiveGroupBuyResponse — the live
// round as a card (null when none), for the attach menu and the Chats pin.
export async function GET(req: Request) {
  return withCommunity(req, { route: "community/group-buy", preview: true }, async (actor) => ok(await liveGroupBuy(actor)));
}
