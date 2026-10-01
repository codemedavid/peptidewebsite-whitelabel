import "server-only";

import { NextResponse } from "next/server";
import { isModuleAllowed } from "@/storefront/admin/staff-permissions";
import type { ApiErrorCode } from "./contract";
import { resolveCommunityActor, type CommunityActor } from "@/lib/community/actor.server";
import {
  authenticateCustomer,
  authenticateMobile,
  authenticateSession,
  type CustomerContext,
  type MobileContext,
  type Principal,
} from "./auth";

/**
 * Response envelope + the auth wrapper every /api/mobile/v1 route goes through.
 *
 *   { ok: true, data }                       2xx
 *   { ok: false, error: { code, message } }  4xx / 5xx
 *
 * `message` is always safe to show to the admin. Nothing here ever logs a
 * token, a password, or a customer's details — only the route and error class.
 */

const STATUS: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  session_revoked: 401,
  forbidden: 403,
  store_unavailable: 403,
  not_found: 404,
  conflict: 409,
  invalid_input: 400,
  rate_limited: 429,
  server_error: 500,
};

const NO_STORE = { "Cache-Control": "no-store" };

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status, headers: NO_STORE });
}

export function fail(code: ApiErrorCode, message: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message, ...extra } },
    { status: STATUS[code], headers: NO_STORE },
  );
}

/** Parse a JSON body; null when absent or malformed (the caller answers 400). */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function logServerError(route: string, e: unknown): void {
  // Error class + Prisma code only. Messages are NOT logged: a Prisma
  // validation error can echo query arguments (hashes, customer fields).
  const name = e instanceof Error ? e.name : "Error";
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  console.error(`[mobile-api] ${route}: ${name}${code ? ` (${code})` : ""}`);
}

type Options = {
  /** Staff module key(s) — the actor must hold at least one. Owner passes all. */
  permission?: string | string[];
  /** A route label for error logs. */
  route: string;
};

/**
 * Authenticate, authorise, and run `handler`. Unexpected errors become a
 * generic 500 so no internal detail reaches the phone.
 */
export async function withMobile(
  req: Request,
  opts: Options,
  handler: (ctx: MobileContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const auth = await authenticateMobile(req);
    if (!auth.ok) return fail(auth.failure.code, auth.failure.message);

    const keys = opts.permission ? ([] as string[]).concat(opts.permission) : [];
    if (keys.length > 0 && !keys.some((k) => isModuleAllowed(auth.ctx.actor, k))) {
      return fail("forbidden", "Your account doesn't have access to this. Ask the store owner.");
    }
    return await handler(auth.ctx);
  } catch (e) {
    logServerError(opts.route, e);
    return fail("server_error", "Something went wrong on our side. Please try again.");
  }
}

const SERVER_ERROR = "Something went wrong on our side. Please try again.";

async function guarded(route: string, run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run();
  } catch (e) {
    logServerError(route, e);
    return fail("server_error", SERVER_ERROR);
  }
}

/** Any signed-in phone — store team or customer (/me, devices). */
export async function withSession(
  req: Request,
  opts: { route: string },
  handler: (principal: Principal) => Promise<NextResponse>,
): Promise<NextResponse> {
  return guarded(opts.route, async () => {
    const auth = await authenticateSession(req);
    if (!auth.ok) return fail(auth.failure.code, auth.failure.message);
    return handler(auth.principal);
  });
}

/** Customer sessions only (shop, my orders, checkout, re-applying). */
export async function withCustomer(
  req: Request,
  opts: { route: string },
  handler: (ctx: CustomerContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  return guarded(opts.route, async () => {
    const auth = await authenticateCustomer(req);
    if (!auth.ok) return fail(auth.failure.code, auth.failure.message);
    return handler(auth.ctx);
  });
}

/**
 * Anyone IN the community: approved customers, the owner, and staff holding
 * the `community` module — and only while the store holds MOBILE_COMMUNITY.
 * `moderator: true` further limits the route to the store team.
 */
export async function withCommunity(
  req: Request,
  opts: { route: string; moderator?: boolean },
  handler: (actor: CommunityActor) => Promise<NextResponse>,
): Promise<NextResponse> {
  return guarded(opts.route, async () => {
    const auth = await authenticateSession(req);
    if (!auth.ok) return fail(auth.failure.code, auth.failure.message);
    const resolved = await resolveCommunityActor(auth.principal);
    if (!resolved.ok) return fail(resolved.failure.code, resolved.failure.message);
    if (opts.moderator && !resolved.actor.isModerator) {
      return fail("forbidden", "Only the store team can do this.");
    }
    return handler(resolved.actor);
  });
}
