import { reviewFlag } from "@/lib/community/moderation.server";
import { respond } from "@/lib/community/respond";
import { readJson, withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ id: string }> };

// POST /api/mobile/v1/community/moderation/flags/:id  { action: "restore" | "confirm", teach? } (moderators)
export async function POST(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/moderation/flags:review", team: true }, async (actor) =>
    respond(await reviewFlag(actor, (await params).id, await readJson(req)), "This flag isn't available."),
  );
}
