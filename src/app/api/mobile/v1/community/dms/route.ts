import { communityLimit } from "@/lib/community/limits.server";
import { openDm } from "@/lib/community/dms.server";
import { respond } from "@/lib/community/respond";
import { readJson, withCommunity } from "@/lib/mobile/http";

// POST /api/mobile/v1/community/dms  { peerKey } → { conversationId } (open or create).
export async function POST(req: Request) {
  return withCommunity(req, { route: "community/dms", preview: true }, async (actor) => {
    const limited = communityLimit("dmOpen", actor);
    if (limited) return limited;
    return respond(await openDm(actor, await readJson(req)), "That member isn't available.");
  });
}
