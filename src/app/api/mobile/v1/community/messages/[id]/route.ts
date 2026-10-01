import { deleteMessage, editMessage } from "@/lib/community/messages.server";
import { respond } from "@/lib/community/respond";
import { readJson, withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ id: string }> };
const GONE = "This message isn't available.";

// PATCH /api/mobile/v1/community/messages/:id  { body } — own text/caption, 15 minutes.
export async function PATCH(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/messages:patch" }, async (actor) =>
    respond(await editMessage(actor, (await params).id, (await readJson(req))?.body), GONE),
  );
}

// DELETE /api/mobile/v1/community/messages/:id — delete for everyone.
export async function DELETE(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/messages:delete" }, async (actor) =>
    respond(await deleteMessage(actor, (await params).id), GONE),
  );
}
