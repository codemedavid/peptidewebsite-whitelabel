import { saveRules } from "@/lib/community/moderation.server";
import { respond } from "@/lib/community/respond";
import { readJson, withCommunity } from "@/lib/mobile/http";

// PUT /api/mobile/v1/community/moderation/rules  { rules: [{ kind: "block" | "allow", text }] } (store team)
// Replaces the safety bot's Not allowed / Allowed rules; answers with the whole policy.
export async function PUT(req: Request) {
  return withCommunity(req, { route: "community/moderation/rules:put", team: true }, async (actor) =>
    respond(await saveRules(actor, await readJson(req))),
  );
}
