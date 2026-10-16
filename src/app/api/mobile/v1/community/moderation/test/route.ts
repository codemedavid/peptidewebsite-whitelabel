import { communityLimit } from "@/lib/community/limits.server";
import { testMessage } from "@/lib/community/moderation.server";
import { respond } from "@/lib/community/respond";
import { readJson, withCommunity } from "@/lib/mobile/http";

// POST /api/mobile/v1/community/moderation/test  { text } (store team)
// What the safety bot would do with this message under the current rules. Nothing is saved.
export async function POST(req: Request) {
  return withCommunity(req, { route: "community/moderation/test", team: true }, async (actor) => {
    const limited = communityLimit("moderationTest", actor);
    if (limited) return limited;
    return respond(await testMessage(actor, await readJson(req)));
  });
}
