import { respond } from "@/lib/community/respond";
import { deleteSavedReply, editSavedReply } from "@/lib/community/saved-replies.server";
import { readJson, withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ id: string }> };

const GONE = "That saved reply was deleted.";

// PATCH /api/mobile/v1/community/saved-replies/:id  { title, body } (moderators) → the whole list
export async function PATCH(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/saved-replies:update", team: true }, async (actor) =>
    respond(await editSavedReply(actor, (await params).id, await readJson(req)), GONE),
  );
}

// DELETE /api/mobile/v1/community/saved-replies/:id (moderators) → the whole list
export async function DELETE(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/saved-replies:delete", team: true }, async (actor) =>
    respond(await deleteSavedReply(actor, (await params).id), GONE),
  );
}
