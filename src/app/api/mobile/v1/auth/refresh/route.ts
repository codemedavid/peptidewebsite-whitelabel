import { prisma } from "@/lib/db/prisma";
import { SIGNED_OUT, resolveSubject, storeAvailability } from "@/lib/mobile/auth";
import { fail, logServerError, ok, readJson } from "@/lib/mobile/http";
import { peekRefreshTenant, revokeSession, rotateSession } from "@/lib/mobile/sessions";

// POST /api/mobile/v1/auth/refresh  { refreshToken } → a new token pair.
// The refresh token is single-use; replaying an old one revokes the session.
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const refreshToken = typeof body?.refreshToken === "string" ? body.refreshToken : "";
    if (!refreshToken || refreshToken.length > 256) return fail("session_revoked", SIGNED_OUT.message);

    // Check the store BEFORE rotating: a temporarily suspended store must not
    // burn the phone's single-use refresh token (it would be signed out for good).
    const tenantId = await peekRefreshTenant(refreshToken);
    if (tenantId) {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, status: true } });
      const unavailable = await storeAvailability(tenant);
      if (unavailable) return fail(unavailable.code, unavailable.message);
    }

    const rotated = await rotateSession(refreshToken);
    if (!rotated.ok) return fail("session_revoked", SIGNED_OUT.message);
    const { session, tokens } = rotated;

    const actor = await resolveSubject(session.tenantId, session.subject);
    if (!actor || actor.stamp !== session.credentialStamp) {
      await revokeSession(session.id);
      return fail("session_revoked", SIGNED_OUT.message);
    }
    return ok(tokens);
  } catch (e) {
    logServerError("auth/refresh", e);
    return fail("server_error", "Couldn't refresh your session. Please try again.");
  }
}
