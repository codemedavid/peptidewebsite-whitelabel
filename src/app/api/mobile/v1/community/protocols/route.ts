import { loadProtocolCards } from "@/lib/community/cards.server";
import { ok, withCommunity } from "@/lib/mobile/http";

// GET /api/mobile/v1/community/protocols → { protocols } — the store's guide,
// for the attach menu's Protocol picker. Empty when the store has no protocols.
export async function GET(req: Request) {
  return withCommunity(req, { route: "community/protocols" }, async (actor) =>
    ok({ protocols: [...loadProtocolCards(actor.tenant).values()] }),
  );
}
