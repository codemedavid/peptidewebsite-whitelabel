import { addExample } from "@/lib/community/moderation.server";
import { respond } from "@/lib/community/respond";
import { readJson, withCommunity } from "@/lib/mobile/http";

// POST /api/mobile/v1/community/moderation/examples  { kind: "block" | "allow", text } (store team)
// Teaches the safety bot with an example message; answers with the whole policy.
export async function POST(req: Request) {
  return withCommunity(req, { route: "community/moderation/examples:post", team: true }, async (actor) =>
    respond(await addExample(actor, await readJson(req))),
  );
}
