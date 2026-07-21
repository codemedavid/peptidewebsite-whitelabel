/**
 * Pure helpers for re-hosting a tenant's images off a *foreign* storage host.
 *
 * Background: a migrated tenant can carry image URLs that physically live in
 * someone else's storage bucket (e.g. an old Supabase project). Only the URLs
 * were copied into our DB — the bytes never moved — so if that foreign project
 * is paused or deleted, the images 404. The rescue is: download each foreign
 * image, re-upload it to our own host (ImageKit), then rewrite every stored
 * reference from the old URL to the new one.
 *
 * This module owns only the *rewriting* — no DB, no network — so the risky
 * "swap URLs inside arbitrary JSON without touching anything else" logic is
 * unit-testable in isolation. The IO (download / upload / DB write) lives in the
 * migration script that consumes these helpers.
 */

/** A JSON value as stored in `product.images` / `branding.config`. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Whether `value` is an absolute URL whose host equals `foreignHost`. Non-URL or
 * empty strings are simply not foreign (returns false rather than throwing), so
 * callers can pass every string leaf without pre-filtering.
 */
export function isForeignHostUrl(value: string, foreignHost: string): boolean {
  if (!value || typeof value !== "string") return false;
  try {
    return new URL(value).host === foreignHost;
  } catch {
    return false;
  }
}

/**
 * Deep-walk a JSON value and return the de-duplicated list of string leaves that
 * satisfy `match`. Order follows first appearance. Used to discover every
 * foreign URL to download before anything is rewritten.
 */
export function collectMatchingUrls(
  value: unknown,
  match: (url: string) => boolean,
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      if (match(v) && !seen.has(v)) {
        seen.add(v);
        found.push(v);
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (v && typeof v === "object") {
      for (const inner of Object.values(v as Record<string, unknown>)) walk(inner);
    }
  };
  walk(value);
  return found;
}

/**
 * Return a deep copy of `value` with every string leaf found in `mapping`
 * replaced by its mapped value, plus how many replacements were made (counting
 * every occurrence, including duplicates). The input is never mutated; strings
 * absent from `mapping` are preserved byte-for-byte, as are all non-string
 * leaves. `replaced` lets the migration assert it rewrote exactly what it
 * re-hosted before committing the DB write.
 */
export function rewriteJsonUrls(
  value: unknown,
  mapping: ReadonlyMap<string, string>,
): { value: unknown; replaced: number } {
  let replaced = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const next = mapping.get(v);
      if (next !== undefined) {
        replaced++;
        return next;
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(inner);
      }
      return out;
    }
    return v;
  };
  return { value: walk(value), replaced };
}
