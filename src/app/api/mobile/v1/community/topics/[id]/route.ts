import { deleteTopic, updateTopic } from "@/lib/community/channels.server";
import { respond } from "@/lib/community/respond";
import { readJson, withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ id: string }> };
const GONE = "This topic isn't available.";

// PATCH /api/mobile/v1/community/topics/:id  TopicInput (+ isPinned) — moderators.
export async function PATCH(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/topics/:id:patch" }, async (actor) =>
    respond(await updateTopic(actor, (await params).id, await readJson(req)), GONE),
  );
}

// DELETE /api/mobile/v1/community/topics/:id — moderators; General is never deleted.
export async function DELETE(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/topics/:id:delete" }, async (actor) =>
    respond(await deleteTopic(actor, (await params).id), GONE),
  );
}
