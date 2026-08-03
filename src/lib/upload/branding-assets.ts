/**
 * Per-kind rules for the branding assets a platform operator uploads from the
 * tenant Branding editor, plus the one merge used to store the default product
 * image.
 *
 * The logo and the favicon land on their own `Branding` columns, but the
 * default product image lives in the shared `branding.config` blob — the same
 * blob the editor holds in state and writes back wholesale on "Save branding".
 * Both the server action and the editor therefore merge through
 * `applyDefaultProductImage`, so a save can never write a stale config back
 * over a just-uploaded image.
 *
 * Pure module (no DB, no Next runtime) so both sides can share it. Covered by
 * scripts/test-default-product-image.ts.
 */

import { BRANDING_ASSET_MAX_BYTES, STOREFRONT_IMAGE_MAX_BYTES } from "@/lib/upload/limits";

export type BrandingAssetKind = "logo" | "favicon" | "defaultProductImage";

export const BRANDING_ASSET_KINDS = ["logo", "favicon", "defaultProductImage"] as const;

/** Narrow an untrusted client-supplied kind before it reaches any write. */
export function isBrandingAssetKind(value: unknown): value is BrandingAssetKind {
  return (BRANDING_ASSET_KINDS as readonly unknown[]).includes(value);
}

export type BrandingAssetRules = {
  maxBytes: number;
  /** Human label for the size limit, used in the operator-facing error. */
  maxLabel: string;
  allowedTypes: ReadonlySet<string>;
};

/** Small marks: a logo or a favicon, incl. the vector/icon formats they use. */
const MARK_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

/**
 * Photographic types only. A favicon-sized .ico or a vector mark stretched
 * across a product card reads as a broken image, so they are refused here even
 * though the uploader would happily host them.
 */
const PHOTO_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp"]);

export function brandingAssetRules(kind: BrandingAssetKind): BrandingAssetRules {
  if (kind === "defaultProductImage") {
    return {
      maxBytes: STOREFRONT_IMAGE_MAX_BYTES,
      maxLabel: "10 MB",
      allowedTypes: PHOTO_TYPES,
    };
  }
  return { maxBytes: BRANDING_ASSET_MAX_BYTES, maxLabel: "2 MB", allowedTypes: MARK_TYPES };
}

/** The operator-facing reason this file can't be used, or null when it can. */
export function validateBrandingAssetFile(
  kind: BrandingAssetKind,
  file: { type: string; size: number },
): string | null {
  const rules = brandingAssetRules(kind);
  if (!file.size) return "No file provided.";
  if (file.size > rules.maxBytes) return `File too large (max ${rules.maxLabel}).`;
  if (!rules.allowedTypes.has(file.type)) return `Unsupported type: ${file.type || "unknown"}.`;
  return null;
}

/**
 * Set (or clear) `defaultProductImage` on a branding config, leaving every
 * other key untouched. Clearing removes the key rather than storing an empty
 * string, so the storefront falls back to its SVG placeholder instead of
 * carrying a value `normalizeDefaultProductImage` would only reject later.
 */
export function applyDefaultProductImage(
  config: Record<string, unknown>,
  url: string | null,
): Record<string, unknown> {
  const next = { ...config };
  const trimmed = (url ?? "").trim();
  if (trimmed) next.defaultProductImage = trimmed;
  else delete next.defaultProductImage;
  return next;
}
