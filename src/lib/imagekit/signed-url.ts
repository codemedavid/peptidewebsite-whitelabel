// Pure pieces of a signed private-file link, kept apart from server.ts so they
// can be tested without ImageKit keys.
//
// Two things decide how many bytes a private image costs us:
//  1. Size. A signed URL can't take a client-side `tr=` (the signature covers
//     the transform), so the resize has to be signed in on the server. Without
//     it ImageKit ships the untouched upload — a 2–4 MB phone screenshot.
//  2. Repeat views. The SDK stamps `ik-t = now + ttl`, so every call mints a
//     NEW url and the browser can never reuse what it already downloaded.
//     Snapping the expiry to a fixed window makes every call inside that
//     window return the same url, which the browser serves from its cache.

/** ImageKit transform step, in the SDK's `transformation` shape. */
export type SignedTransform = { width?: number; quality?: number; format?: "auto"; crop?: "at_max" };

/**
 * Payment proofs are screenshots people read numbers off, so: wide enough that
 * a reference number stays crisp in a full-screen viewer, never upscaled past
 * the original (`at_max`), and AVIF/WebP where the browser takes it.
 */
export const PROOF_VIEW_TRANSFORM: SignedTransform = { width: 1000, quality: 80, format: "auto", crop: "at_max" };

/**
 * Seconds to hand the SDK so its expiry lands on the next `ttlSeconds`
 * boundary that is at least `ttlSeconds` away. Every call in the same window
 * gets the same `ik-t` (and so the same url), and the link always stays valid
 * for at least `ttlSeconds` — never less than an unaligned link would.
 */
export function alignedExpirySeconds(ttlSeconds: number, nowMs: number = Date.now()): number {
  const nowSec = Math.floor(nowMs / 1000);
  const expiresAt = Math.ceil((nowSec + ttlSeconds) / ttlSeconds) * ttlSeconds;
  return expiresAt - nowSec;
}
