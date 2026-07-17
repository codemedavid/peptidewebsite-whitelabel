/**
 * Single source of truth for image-upload size limits.
 *
 * Uploads reach the server as multipart/form-data through a Next server action.
 * Next enforces `experimental.serverActions.bodySizeLimit` on the whole encoded
 * request body BEFORE the action body runs — so a per-file max that sits at or
 * above that limit is unenforceable: the framework rejects the request with an
 * opaque error and our own "File too large" message never fires.
 *
 * Every declared per-file max must therefore satisfy `fitsServerActionBody()`.
 * `scripts/test-upload-limits.ts` enforces that invariant.
 */

/**
 * Must stay above the largest per-file max below, with room for multipart
 * overhead. It was previously "2mb" — exactly BRANDING_ASSET_MAX_BYTES — which
 * made the 2 MB logo limit unenforceable and the 10 MB image limit dead code.
 */
export const SERVER_ACTION_BODY_LIMIT = "12mb";
export const SERVER_ACTION_BODY_LIMIT_BYTES = 12 * 1024 * 1024;

/** Logos and favicons are small; anything bigger is a mistake, not a need. */
export const BRANDING_ASSET_MAX_BYTES = 2 * 1024 * 1024;

/** Arbitrary storefront imagery (hero shots, product photos). */
export const STOREFRONT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Size of `bytes` once wrapped in multipart/form-data: a boundary marker,
 * per-part headers, and the action's own serialized arguments ride along with
 * the file. 1% + 1 KB is comfortably above the real overhead for a single part.
 */
export function encodedSize(bytes: number): number {
  return Math.ceil(bytes * 1.01) + 1024;
}

/** True when a file of `maxBytes` still fits under the body limit once encoded. */
export function fitsServerActionBody(maxBytes: number): boolean {
  return encodedSize(maxBytes) <= SERVER_ACTION_BODY_LIMIT_BYTES;
}
