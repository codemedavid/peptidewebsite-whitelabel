import { sharedItems } from "@/lib/community/discover.server";
import { respond } from "@/lib/community/respond";
import { parseThreadType } from "@/lib/community/thread-access.server";
import { fail, withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ type: string; id: string }> };

// GET /api/mobile/v1/community/threads/:type/:id/shared?tab=media|docs|links|listings
export async function GET(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/threads/shared", preview: true }, async (actor) => {
    const { type: rawType, id } = await params;
    const type = parseThreadType(rawType);
    if (!type) return fail("not_found", "This chat isn't available.");
    return respond(await sharedItems(actor, type, id, new URL(req.url).searchParams.get("tab")));
  });
}
