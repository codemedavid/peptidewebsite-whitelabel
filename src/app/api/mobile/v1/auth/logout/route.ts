import { fail, logServerError, ok, readJson } from "@/lib/mobile/http";
import { findSessionForLogout, revokeSession } from "@/lib/mobile/sessions";
import { parseBearer } from "@/lib/mobile/tokens";

// POST /api/mobile/v1/auth/logout  (Bearer access token and/or { refreshToken })
// Revokes the session and removes this phone's push registration. Idempotent:
// an unknown or already-revoked session still answers ok.
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const refreshToken = typeof body?.refreshToken === "string" ? body.refreshToken.slice(0, 256) : null;
    const sessionId = await findSessionForLogout(parseBearer(req.headers.get("authorization")), refreshToken);
    if (sessionId) await revokeSession(sessionId);
    return ok({ signedOut: true });
  } catch (e) {
    logServerError("auth/logout", e);
    return fail("server_error", "Couldn't sign out on the server. You've been signed out on this phone.");
  }
}
