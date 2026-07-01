import type { Protocol } from "@/storefront/types";

/**
 * Hard cap on images stored/rendered per protocol. Keeps the shared
 * `branding.config` JSON blob bounded (protocols live there, not in their own
 * table) — especially in demo mode where images are inlined as data URLs.
 */
export const MAX_PROTOCOL_IMAGES = 12;

const isNonBlank = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "";

/**
 * Canonical list of a protocol's images, resolving the new multi-image field
 * against the legacy single `image` for full backward-compatibility.
 *
 * Rules (single source of truth for both the admin form and the public page):
 *   - If `images` is an array, it is authoritative: blanks are dropped, the
 *     list is capped at MAX_PROTOCOL_IMAGES, and the legacy `image` is ignored
 *     (so clearing the gallery to [] never resurrects an old single image).
 *   - Otherwise fall back to the legacy `image` string when it is non-blank.
 *   - Anything else yields [] — never throws on malformed persisted JSON.
 */
export function resolveProtocolImages(p: Protocol): string[] {
  if (Array.isArray(p.images)) {
    return p.images.filter(isNonBlank).slice(0, MAX_PROTOCOL_IMAGES);
  }
  return isNonBlank(p.image) ? [p.image] : [];
}
