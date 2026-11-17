import { clientIp } from "@/lib/security/rate-limit";
import { fail, logServerError, ok, readJson } from "@/lib/mobile/http";
import { mobileStartGuest } from "@/lib/mobile/guest-session";

// POST /api/mobile/v1/auth/guest  { store } → tokens + me for a new app guest
// (lib/mobile/app-guest.ts): shop and order without an account, sign up later.
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    if (!body) return fail("invalid_input", "Enter the store you shop at.");
    const label = (req.headers.get("x-device-label") ?? "").slice(0, 80) || null;
    const result = await mobileStartGuest(body, await clientIp(), label);
    return result.ok ? ok(result.data) : fail(result.code, result.message);
  } catch (e) {
    logServerError("auth/guest", e);
    return fail("server_error", "We couldn't open the shop right now. Please try again.");
  }
}
