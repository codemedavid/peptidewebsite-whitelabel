// Remembers a payment proof's signed link for a few minutes, so reopening the
// same proof reuses the url the browser already holds the image for — no
// second server action, no second download from ImageKit.
//
// The server signs links valid for at least 10 minutes (payments.ts), so
// holding one for 8 can never hand back a link that has already expired.

export const PROOF_URL_HOLD_MS = 8 * 60 * 1000;

export type ProofUrlResult = { ok: true; url: string } | { ok: false; message: string };

const held = new Map<string, { url: string; at: number }>();

/** The held link for `key`, or `load()`'s fresh one (held only on success). */
export async function cachedProofUrl(
  key: string,
  load: () => Promise<ProofUrlResult>,
  now: number = Date.now(),
): Promise<ProofUrlResult> {
  const hit = held.get(key);
  if (hit && now - hit.at < PROOF_URL_HOLD_MS) return { ok: true, url: hit.url };
  const res = await load();
  if (res.ok) held.set(key, { url: res.url, at: now });
  else held.delete(key);
  return res;
}
