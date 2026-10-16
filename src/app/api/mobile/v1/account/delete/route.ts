import { deleteAccount } from "@/lib/mobile/account-delete";
import { fail, ok, readJson, withSession } from "@/lib/mobile/http";

// POST /api/mobile/v1/account/delete  { password } — or { supabaseAccessToken } for an
// account made by /auth/exchange (Mamamica), which has no password.
// Start deleting YOUR OWN account (Apple 5.1.1(v)) — every kind of account.
// Customers are deleted now; owner/staff file a request the platform completes
// within 30 days. Either way every phone on the account is signed out.
// A wrong password answers 401 `wrong_password` (not `unauthenticated`, which
// would make the app refresh its session and resend).
export async function POST(req: Request) {
  return withSession(req, { route: "account/delete" }, async (principal) => {
    const body = await readJson(req);
    const res = await deleteAccount(principal, body?.password, body?.supabaseAccessToken);
    return res.ok ? ok(res.data) : fail(res.code, res.message);
  });
}
