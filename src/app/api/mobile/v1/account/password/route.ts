import { changePassword } from "@/lib/mobile/account";
import { changeOwnCustomerPassword } from "@/lib/community/member-account.server";
import { fail, ok, readJson, withSession } from "@/lib/mobile/http";

// POST /api/mobile/v1/account/password  { currentPassword, newPassword }
// Everyone may change their OWN password: the store team (the web's
// always-allowed Account view) and customers (the website's My account).
export async function POST(req: Request) {
  return withSession(req, { route: "account/password" }, async (principal) => {
    const body = await readJson(req);
    if (!body) return fail("invalid_input", "Enter your current and new password.");
    const res =
      principal.kind === "customer"
        ? await changeOwnCustomerPassword(principal.ctx, body.currentPassword, body.newPassword)
        : await changePassword(principal.ctx, body.currentPassword, body.newPassword);
    return res.ok ? ok({ changed: true }) : fail("invalid_input", res.message);
  });
}
