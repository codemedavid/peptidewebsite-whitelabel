// Multiple photos per product and per variation.
//
// The model keeps `image` as the MAIN photo — the one every existing surface
// already reads (card, cart thumbnail, share preview, export, Card Studio) — and
// adds `extraImages` beside it. Nothing that only knows about `image` has to
// change, and a single-photo product carries no extras at all.
//
// Pure (no React, no DB) so the mapping layer, the input normalizer, the gallery
// and the admin editor all apply the same rules. Covered by
// scripts/test-multi-image.ts.

import { normalizeHostedImageUrl } from "./product-image";

/** Main photo + extras, per product or per variation. Enough for front/back/
 *  label/angle shots; a hard cap so a runaway paste can't bloat a JSON row. */
export const MAX_PHOTOS_PER_ITEM = 10;

/**
 * Coerce an untrusted extras list: http(s) only (these land in an <img src>
 * from tenant-editable JSON — same rule as every other stored photo), no
 * duplicates, never a repeat of the main photo, capped so main + extras stays
 * within MAX_PHOTOS_PER_ITEM.
 */
export function cleanExtraImages(value: unknown, main?: string | null): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>(main ? [main] : []);
  const out: string[] = [];
  for (const raw of value) {
    const url = normalizeHostedImageUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_PHOTOS_PER_ITEM - 1) break;
  }
  return out;
}

/**
 * The full ordered photo list, main first. With no main photo the first extra
 * is promoted rather than lost — removing the lead photo in the editor must not
 * leave a product that has photos but shows none on the card.
 */
export function photoList(main: string | null | undefined, extras: unknown): string[] {
  const cleaned = cleanExtraImages(extras, main);
  return main ? [main, ...cleaned] : cleaned;
}
