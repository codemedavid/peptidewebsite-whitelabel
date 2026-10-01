import { createChannel } from "@/lib/community/channels.server";
import { respond } from "@/lib/community/respond";
import { readJson, withCommunity } from "@/lib/mobile/http";

// POST /api/mobile/v1/community/channels  ChannelInput → CommunityChannel (moderators).
export async function POST(req: Request) {
  return withCommunity(req, { route: "community/channels", moderator: true }, async (actor) =>
    respond(await createChannel(actor, await readJson(req))),
  );
}
