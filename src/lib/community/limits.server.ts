import "server-only";

import type { NextResponse } from "next/server";
import { fail } from "@/lib/mobile/http";
import { rateLimit } from "@/lib/security/rate-limit";

/**
 * Community write/read budgets, per tenant + participant (the store team is
 * counted per person, via its author key). Uses the app's existing in-memory
 * limiter (lib/security/rate-limit.ts) — per server instance, like the login
 * limits; a shared store (Redis/DB) is a follow-up.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const COMMUNITY_LIMITS = {
  send: { max: 30, windowMs: MINUTE },
  dmOpen: { max: 10, windowMs: HOUR },
  topicCreate: { max: 5, windowMs: HOUR },
  search: { max: 10, windowMs: MINUTE },
  profileEdit: { max: 10, windowMs: HOUR },
  reapply: { max: 3, windowMs: DAY },
} as const;

export type LimitAction = keyof typeof COMMUNITY_LIMITS;

const MESSAGE = "You're doing that too often. Try again in a little while.";

/** null = allowed (and counted); otherwise the 429 to return. */
export function communityLimit(
  action: LimitAction,
  who: { tenantId: string; key: string; authorKey?: string | null },
): NextResponse | null {
  const { max, windowMs } = COMMUNITY_LIMITS[action];
  const person = who.authorKey ?? who.key;
  return rateLimit(`community:${action}:${who.tenantId}:${person}`, max, windowMs).ok ? null : fail("rate_limited", MESSAGE);
}
