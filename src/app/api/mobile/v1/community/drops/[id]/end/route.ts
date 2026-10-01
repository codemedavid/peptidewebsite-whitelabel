import { endDrop } from "@/lib/community/drops.server";
import { respond } from "@/lib/community/respond";
import { withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ id: string }> };

// POST /api/mobile/v1/community/drops/:id/end (moderators)
export async function POST(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/drops/:id/end", moderator: true }, async (actor) =>
    respond(await endDrop(actor, (await params).id), "This drop isn't available."),
  );
}
