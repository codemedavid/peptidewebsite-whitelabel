"use server";

import { prisma } from "@/lib/db/prisma";
import { getTenantIdOrNull } from "@/lib/tenant/headers";
import { sessionSecret, setStorefrontAdminCookie } from "@/lib/auth/storefront-admin";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import { decodeHandoffToken } from "@/lib/mobile/handoff-token";
import { checkHandoffSession } from "@/lib/mobile/handoff-rules";
import { decodeSubject, isAdminSubject } from "@/lib/mobile/sessions";
import { resolveActor, storeAvailability } from "@/lib/mobile/auth";

/**
 * The storefront half of the Pepweb app → embedded website admin handoff
 * (lib/mobile/handoff-token.ts). The app's WebView injects a 60s token; the
 * booting SPA (StorefrontApp.verifyAdmin) trades it here for the ordinary
 * `sf_admin_session` cookie. Being a Server Action, this request is never a
 * document load, so admin-session-reset.ts leaves the fresh cookie alone.
 *
 * The token only NAMES a mobile session. Everything the app API checks on each
 * call is re-checked here against the database before a cookie is issued:
 * same store as this host, session live, owner/staff (never a customer), the
 * account still resolves with the SAME credential stamp, and the store is
 * available. Failures collapse to one message; the token is never logged.
 */

const TEN_MIN = 10 * 60 * 1000;
const FAILED = "Couldn't sign you in from the app. Close this screen and try again.";

export async function redeemAppHandoffAction(token: unknown): Promise<{ ok: true } | { error: string }> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return { error: FAILED };

  const ip = await clientIp();
  const limited = rateLimit(`sf-admin:app-handoff:${tenantId}:${ip}`, 30, TEN_MIN);
  if (!limited.ok) return { error: "Too many attempts. Try again in a few minutes." };

  const claims = decodeHandoffToken(sessionSecret(), token, Date.now());
  if (!claims || claims.tenantId !== tenantId) return { error: FAILED };

  const row = await prisma.mobileSession.findUnique({
    where: { id: claims.sessionId },
    select: { tenantId: true, subject: true, credentialStamp: true, revokedAt: true, refreshExpiresAt: true },
  });
  if (!row || row.tenantId !== tenantId) return { error: FAILED };
  if (!checkHandoffSession(row, new Date()).ok) return { error: FAILED };

  const subject = decodeSubject(row.subject);
  if (!subject || !isAdminSubject(subject)) return { error: FAILED };

  const live = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, status: true } });
  if (await storeAvailability(live)) return { error: FAILED };

  const resolved = await resolveActor(tenantId, subject);
  if (!resolved || resolved.stamp !== row.credentialStamp) return { error: FAILED };

  await setStorefrontAdminCookie(tenantId, subject);
  return { ok: true };
}
