import { clientIp } from "@/lib/security/rate-limit";
import { mobileExchange } from "@/lib/mobile/exchange";
import { fail, logServerError, ok, readJson } from "@/lib/mobile/http";

// POST /api/mobile/v1/auth/exchange  { store, supabaseAccessToken }
// → tokens + me: a partner app's (Mamamica Glow) Supabase login, signed in as this store's customer.
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    if (!body) return fail("invalid_input", "Sign in to the app again, then retry.");
    const label = (req.headers.get("x-device-label") ?? "").slice(0, 80) || null;
    const result = await mobileExchange(body, await clientIp(), label);
    return result.ok ? ok(result.data) : fail(result.code, result.message);
  } catch (e) {
    logServerError("auth/exchange", e);
    return fail("server_error", "We couldn't sign you in right now. Please try again.");
  }
}
