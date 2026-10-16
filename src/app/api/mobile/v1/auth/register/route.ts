import { clientIp } from "@/lib/security/rate-limit";
import { fail, logServerError, ok, readJson } from "@/lib/mobile/http";
import { mobileRegister } from "@/lib/mobile/register";

// POST /api/mobile/v1/auth/register
//   { store, firstName, lastName, email, phone, age, gender?, password }
// → tokens + me: the new customer account, signed straight in.
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    if (!body) return fail("invalid_input", "Fill in your details to create an account.");
    const label = (req.headers.get("x-device-label") ?? "").slice(0, 80) || null;
    const result = await mobileRegister(body, await clientIp(), label);
    return result.ok ? ok(result.data) : fail(result.code, result.message);
  } catch (e) {
    logServerError("auth/register", e);
    return fail("server_error", "We couldn't create your account right now. Please try again.");
  }
}
