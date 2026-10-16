import { sanctionMember } from "@/lib/community/moderation.server";
import { respond } from "@/lib/community/respond";
import { readJson, withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ customerId: string }> };

// POST /api/mobile/v1/community/members/:customerId/sanction
//   { action: "mute" | "unmute" | "ban" | "unban" } (moderators)
// A ban revokes the membership AND disables the account: the same login is refused.
export async function POST(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/members:sanction", team: true }, async (actor) =>
    respond(await sanctionMember(actor, (await params).customerId, await readJson(req)), "This member isn't available."),
  );
}
