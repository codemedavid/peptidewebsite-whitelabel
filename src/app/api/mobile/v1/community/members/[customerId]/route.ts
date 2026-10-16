import { setMemberAdmin, setVerifiedReseller } from "@/lib/community/members.server";
import { fail, ok, readJson, withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ customerId: string }> };

// PATCH /api/mobile/v1/community/members/:customerId (the store team)
//   { verifiedReseller: boolean } → may / may not post in a hub's On hand
//   { isAdmin: boolean }          → makes an approved member a community admin, or takes it back
export async function PATCH(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/members:update", team: true }, async (actor) => {
    const customerId = (await params).customerId;
    const body = await readJson(req);
    if (body && typeof body === "object" && "isAdmin" in body) {
      const value = (body as Record<string, unknown>).isAdmin;
      if (typeof value !== "boolean") return fail("invalid_input", "Choose whether this member is an admin.");
      const res = await setMemberAdmin(actor, customerId, value);
      if (res.kind === "ok") return ok({ customerId, isAdmin: res.isAdmin });
      return res.kind === "invalid" ? fail("invalid_input", res.message) : fail("not_found", "This member isn't available.");
    }
    const res = await setVerifiedReseller(actor, customerId, body);
    if (res.kind === "ok") return ok({ customerId, verifiedReseller: res.verifiedReseller });
    return res.kind === "invalid" ? fail("invalid_input", res.message) : fail("not_found", "This member isn't available.");
  });
}
