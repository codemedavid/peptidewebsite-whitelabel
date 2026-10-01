import { loadAccountProfile, saveAccountProfile } from "@/lib/mobile/account-profile.server";
import { fail, ok, readJson, withSession } from "@/lib/mobile/http";
import { rateLimit } from "@/lib/security/rate-limit";

const EDITS_PER_WINDOW = 20;
const TEN_MIN = 10 * 60 * 1000;

// GET /api/mobile/v1/account/profile → this account's name, nickname and photo.
// Every kind of account: owner, staff and customer.
export async function GET(req: Request) {
  return withSession(req, { route: "account/profile" }, async (principal) => ok(await loadAccountProfile(principal)));
}

// PATCH /api/mobile/v1/account/profile  { name, nickname?, bio? } — your OWN profile only.
export async function PATCH(req: Request) {
  return withSession(req, { route: "account/profile:patch" }, async (principal) => {
    if (!rateLimit(`account:profile:${principal.ctx.session.id}`, EDITS_PER_WINDOW, TEN_MIN).ok) {
      return fail("rate_limited", "Too many changes. Try again in a few minutes.");
    }
    const res = await saveAccountProfile(principal, await readJson(req));
    return res.ok ? ok(res.profile) : fail("invalid_input", res.message);
  });
}
