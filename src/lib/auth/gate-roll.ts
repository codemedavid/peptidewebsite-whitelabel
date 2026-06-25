import type { NextRequest, NextResponse } from "next/server";
import {
  resolveGateSecret,
  signGateTokenEdge,
  verifyGateTokenEdge,
} from "./gate-token-edge";
import {
  GATE_COOKIE_NAME,
  GATE_TTL_SECONDS,
  GATE_MAX_SESSION_SECONDS,
} from "./gate-constants";

/**
 * Per-request ROLLING timeout for the visitor access-code gate, run in middleware
 * (Edge). If the browser holds a still-valid `tenant.sid`, re-sign it with a fresh
 * 15-minute expiry and write it back — so an actively-browsing visitor never gets
 * bounced to the gate mid-session. The storefront layout can't do this itself
 * (Server Components can't set cookies); middleware can.
 *
 * No DB is touched: tenantId + codeVersion + iat are carried through unchanged, so
 * this only ever extends `exp`. It can't resurrect a rotated-out session — the
 * layout still rejects a stale codeVersion against the live tenant — and it stops
 * extending once the absolute session cap (iat + MAX) is reached, so a cookie can't
 * be rolled forever. Absent/invalid/expired/capped cookies are left untouched (the
 * layout then renders the gate).
 */

export async function rollGateCookie(req: NextRequest, res: NextResponse): Promise<void> {
  const token = req.cookies.get(GATE_COOKIE_NAME)?.value;
  if (!token) return;

  const secret = resolveGateSecret();
  if (!secret) return;

  const payload = await verifyGateTokenEdge(token, secret);
  if (!payload) return; // invalid or expired → don't refresh; layout will gate

  const now = Math.floor(Date.now() / 1000);
  // Absolute lifetime cap: past it, let the cookie lapse instead of re-stamping.
  if (now >= payload.iat + GATE_MAX_SESSION_SECONDS) return;

  const fresh = await signGateTokenEdge(
    {
      tenantId: payload.tenantId,
      codeVersion: payload.codeVersion,
      iat: payload.iat, // preserve original issue time so the cap is honored
      exp: now + GATE_TTL_SECONDS,
    },
    secret,
  );
  res.cookies.set({
    name: GATE_COOKIE_NAME,
    value: fresh,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GATE_TTL_SECONDS,
  });
}
