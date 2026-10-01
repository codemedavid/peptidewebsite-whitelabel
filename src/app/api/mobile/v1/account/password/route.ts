import { changePassword } from "@/lib/mobile/account";
import { fail, ok, readJson, withMobile } from "@/lib/mobile/http";

// POST /api/mobile/v1/account/password  { currentPassword, newPassword }
// Everyone may change their OWN password (the web's always-allowed Account view).
export async function POST(req: Request) {
  return withMobile(req, { route: "account/password" }, async (ctx) => {
    const body = await readJson(req);
    if (!body) return fail("invalid_input", "Enter your current and new password.");
    const res = await changePassword(ctx, body.currentPassword, body.newPassword);
    return res.ok ? ok({ changed: true }) : fail("invalid_input", res.message);
  });
}
