import { respond } from "@/lib/community/respond";
import { createSavedReply, listSavedReplies } from "@/lib/community/saved-replies.server";
import { ok, readJson, withCommunity } from "@/lib/mobile/http";

// GET /api/mobile/v1/community/saved-replies (moderators)
// The store team's shared quick answers, A→Z by title.
export async function GET(req: Request) {
  return withCommunity(req, { route: "community/saved-replies", team: true }, async (actor) => ok(await listSavedReplies(actor)));
}

// POST /api/mobile/v1/community/saved-replies  { title, body } (moderators) → the whole list
export async function POST(req: Request) {
  return withCommunity(req, { route: "community/saved-replies:create", team: true }, async (actor) =>
    respond(await createSavedReply(actor, await readJson(req))),
  );
}
