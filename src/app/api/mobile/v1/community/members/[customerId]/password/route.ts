import { resetMemberPassword } from "@/lib/community/member-account.server";
import { fail, ok, readJson, withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ customerId: string }> };

// POST /api/mobile/v1/community/members/:customerId/password  { password? }
// The store team gives a member who forgot their password a new one — typed, or
// generated when omitted. Signs the member out everywhere; the password comes
// back ONCE for the team to send them. Owner, or staff with Customers access.
export async function POST(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/members:password", team: true }, async (actor) => {
    const customerId = (await params).customerId;
    const res = await resetMemberPassword(actor, customerId, await readJson(req));
    if (res.kind === "ok") return ok(res.data);
    if (res.kind === "not_found") return fail("not_found", "This member isn't available.");
    return fail(res.kind === "forbidden" ? "forbidden" : "invalid_input", res.message);
  });
}
