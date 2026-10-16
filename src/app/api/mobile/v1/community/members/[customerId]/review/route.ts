import { reviewMember } from "@/lib/community/members.server";
import { fail, ok, readJson, withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ customerId: string }> };

// POST /api/mobile/v1/community/members/:customerId/review  { approve, reason? } (moderators; only the team reviews an admin)
// Declining a pending application rejects it; declining an approved member revokes them.
export async function POST(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/members/review", moderator: true }, async (actor) => {
    const res = await reviewMember(actor, (await params).customerId, await readJson(req));
    if (res.kind === "ok") return ok(res.member);
    if (res.kind === "forbidden") return fail("forbidden", res.message);
    return res.kind === "invalid" ? fail("invalid_input", res.message) : fail("not_found", "This application isn't available.");
  });
}
