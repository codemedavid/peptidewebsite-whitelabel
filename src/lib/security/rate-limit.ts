import "server-only";
import { headers } from "next/headers";

/**
 * Tiny in-memory sliding-window rate limiter for auth endpoints. Per the access
 * gate spec we keep it dependency-free (no Upstash/Redis) — good enough for a
 * single instance. On a multi-instance/serverless deployment each instance keeps
 * its own counters, so swap in a shared store (Upstash `@upstash/ratelimit`) if
 * you scale out; the call sites only depend on `rateLimit()` returning a verdict.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * @returns `{ ok: true }` when the action is allowed, or `{ ok: false, retryAfter }`
 *          (seconds) once the window's limit is exhausted.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (existing.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }

  existing.count += 1;
  return { ok: true };

  // Note: the map grows by distinct key; expired buckets are overwritten lazily
  // on the next hit for that key. For a long-lived process you'd sweep it, but
  // the key space here is bounded by (action × client IP), which is fine.
}

/**
 * Best-effort client IP from proxy headers (Vercel/most hosts set
 * `x-forwarded-for`). Falls back to a constant so the limiter still applies
 * (globally, not per-client) when no IP is available — fail closed, not open.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip")?.trim() || "unknown";
}
