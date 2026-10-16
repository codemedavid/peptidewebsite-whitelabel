import { getModeration, setModeration } from "@/lib/community/moderation.server";
import { respond } from "@/lib/community/respond";
import { ok, readJson, withCommunity } from "@/lib/mobile/http";

// GET /api/mobile/v1/community/moderation?status=pending|confirmed|dismissed (moderators)
// The safety bot's settings and the flagged-message queue.
export async function GET(req: Request) {
  return withCommunity(req, { route: "community/moderation", team: true }, async (actor) =>
    ok(await getModeration(actor, new URL(req.url).searchParams.get("status"))),
  );
}

// PATCH /api/mobile/v1/community/moderation  { enabled?, muteAfter?, sensitivity? } (moderators)
export async function PATCH(req: Request) {
  return withCommunity(req, { route: "community/moderation:patch", team: true }, async (actor) =>
    respond(await setModeration(actor, await readJson(req))),
  );
}
