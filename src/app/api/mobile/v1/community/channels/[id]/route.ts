import { deleteChannel, getChannel, updateChannel } from "@/lib/community/channels.server";
import { respond } from "@/lib/community/respond";
import { readJson, withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ id: string }> };
const GONE = "This channel isn't available.";

// GET /api/mobile/v1/community/channels/:id → { channel, topics }
export async function GET(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/channels/:id" }, async (actor) =>
    respond(await getChannel(actor, (await params).id), GONE),
  );
}

// PATCH /api/mobile/v1/community/channels/:id  ChannelInput (moderators)
export async function PATCH(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/channels/:id:patch" }, async (actor) =>
    respond(await updateChannel(actor, (await params).id, await readJson(req)), GONE),
  );
}

// DELETE /api/mobile/v1/community/channels/:id (moderators) — topics, messages and drops go with it.
export async function DELETE(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/channels/:id:delete" }, async (actor) =>
    respond(await deleteChannel(actor, (await params).id), GONE),
  );
}
