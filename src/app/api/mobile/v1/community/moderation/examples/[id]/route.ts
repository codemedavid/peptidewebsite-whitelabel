import { deleteExample } from "@/lib/community/moderation.server";
import { respond } from "@/lib/community/respond";
import { withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ id: string }> };

// DELETE /api/mobile/v1/community/moderation/examples/:id (store team) — answers with the whole policy.
export async function DELETE(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/moderation/examples:delete", team: true }, async (actor) =>
    respond(await deleteExample(actor, (await params).id), "This example isn't available."),
  );
}
