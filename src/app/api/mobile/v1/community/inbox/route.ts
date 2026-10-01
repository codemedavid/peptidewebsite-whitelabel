import { buildInbox } from "@/lib/community/channels.server";
import { ok, withCommunity } from "@/lib/mobile/http";

// GET /api/mobile/v1/community/inbox → channels, DMs, live drops, the tab badge.
// A moderator's first visit to an empty community seeds the starter channels.
export async function GET(req: Request) {
  return withCommunity(req, { route: "community/inbox" }, async (actor) => ok(await buildInbox(actor)));
}
