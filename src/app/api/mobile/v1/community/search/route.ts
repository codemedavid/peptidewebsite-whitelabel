import { communityLimit } from "@/lib/community/limits.server";
import { searchMessages } from "@/lib/community/discover.server";
import { respond } from "@/lib/community/respond";
import { withCommunity } from "@/lib/mobile/http";

// GET /api/mobile/v1/community/search?q=&scope=everywhere|thread&type=&id=
export async function GET(req: Request) {
  return withCommunity(req, { route: "community/search" }, async (actor) => {
    const limited = communityLimit("search", actor);
    if (limited) return limited;
    return respond(await searchMessages(actor, new URL(req.url).searchParams));
  });
}
