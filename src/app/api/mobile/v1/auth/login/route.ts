import { clientIp } from "@/lib/security/rate-limit";
import { fail, logServerError, ok, readJson } from "@/lib/mobile/http";
import { mobileLogin } from "@/lib/mobile/login";

// POST /api/mobile/v1/auth/login  { email, password, store? } → tokens + me,
// or { chooseStore } when that login opens several stores.
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    if (!body) return fail("invalid_input", "Enter your email and password.");
    const label = (req.headers.get("x-device-label") ?? "").slice(0, 80) || null;
    const result = await mobileLogin(body, await clientIp(), label);
    return result.ok ? ok(result.data) : fail(result.code, result.message);
  } catch (e) {
    logServerError("auth/login", e);
    return fail("server_error", "We couldn't sign you in right now. Please try again.");
  }
}
