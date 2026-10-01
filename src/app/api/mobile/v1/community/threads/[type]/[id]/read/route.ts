import { markRead } from "@/lib/community/messages.server";
import { respond } from "@/lib/community/respond";
import { parseThreadType } from "@/lib/community/thread-access.server";
import { fail, readJson, withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ type: string; id: string }> };

// POST /api/mobile/v1/community/threads/:type/:id/read  { at } — the server-side
// read marker (shared by all of this account's phones; never moves backwards).
export async function POST(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/threads/read" }, async (actor) => {
    const { type: rawType, id } = await params;
    const type = parseThreadType(rawType);
    if (!type) return fail("not_found", "This chat isn't available.");
    return respond(await markRead(actor, type, id, await readJson(req)));
  });
}
