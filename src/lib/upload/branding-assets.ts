/**
 * Per-kind rules for the branding assets a platform operator uploads from the
 * tenant Branding editor, plus the merge used to store the ones that live in
 * the config blob.
 *
 * A branding asset lands in one of two places, and `assetTarget` is the single
 * declaration of which:
 *
 *   - a COLUMN on the `Branding` row — the logo and the favicon own theirs;
 *   - a PATH inside the shared `branding.config` blob — the default product
 *     image (`defaultProductImage`) and the loading screen's mark
 *     (`brandSplash.logoUrl`).
 *
 * That dispatch is load-bearing, not tidiness. The upload/remove actions used
 * to branch `kind === "defaultProductImage" ? <config> : <column>`, and the
 * column leg ends in `kind === "logo" ? { logoUrl } : { faviconUrl }` — so any
 * new config-blob kind added without this would silently overwrite the tenant's
 * FAVICON with, say, their splash mark. Kinds now declare where they live and
 * the actions dispatch on that.
 *
 * The config blob is also the object the editor holds in state and writes back
 * wholesale on "Save branding". Both the server action and the editor therefore
 * merge through `applyBrandingAsset`, so a save can never write a stale config
 * back over a just-uploaded image.
 *
 * Pure module (no DB, no Next runtime) so both sides can share it. Covered by
 * scripts/test-default-product-image.ts and scripts/test-brand-splash.ts.
 */

import { BRANDING_ASSET_MAX_BYTES, STOREFRONT_IMAGE_MAX_BYTES } from "@/lib/upload/limits";

export type BrandingAssetKind = "logo" | "favicon" | "defaultProductImage" | "splashLogo";

export const BRANDING_ASSET_KINDS = [
  "logo",
  "favicon",
  "defaultProductImage",
  "splashLogo",
] as const;

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
  // logo | favicon | splashLogo — all small marks, and a splash mark is often
  // the same vector as the header logo.
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

/** Where one branding asset's URL is persisted. */
export type AssetTarget =
  | { store: "column"; column: "logoUrl" | "faviconUrl" }
  | { store: "config"; path: readonly string[] };

const ASSET_TARGETS: Record<BrandingAssetKind, AssetTarget> = {
  logo: { store: "column", column: "logoUrl" },
  favicon: { store: "column", column: "faviconUrl" },
  defaultProductImage: { store: "config", path: ["defaultProductImage"] },
  splashLogo: { store: "config", path: ["brandSplash", "logoUrl"] },
};

/**
 * Where this kind's URL belongs. The upload and remove actions dispatch on
 * this instead of special-casing kinds, so adding a kind cannot land it in the
 * wrong storage by omission — see the header note.
 */
export function assetTarget(kind: BrandingAssetKind): AssetTarget {
  return ASSET_TARGETS[kind];
}

/**
 * Set (or clear) a config-backed branding asset on a branding config, leaving
 * every other key untouched.
 *
 * Clearing REMOVES the key rather than storing an empty string, so the reader
 * falls back to its own default (the SVG product placeholder, or the header
 * logo for the splash mark) instead of carrying a value the normalizer would
 * only reject later.
 *
 * Immutable at every level of the path: the config and each nested object on
 * the way down are copied, never written through. The caller may be holding the
 * very object a cached render is reading from.
 *
 * Throws for a column-backed kind. That is a caller bug — silently returning
 * the config unchanged would drop the upload on the floor and look like a
 * successful save.
 */
export function applyBrandingAsset(
  config: Record<string, unknown>,
  kind: BrandingAssetKind,
  url: string | null,
): Record<string, unknown> {
  const target = assetTarget(kind);
  if (target.store !== "config") {
    throw new Error(`applyBrandingAsset: "${kind}" is stored in a Branding column, not the config`);
  }
  return writePath(config, target.path, (url ?? "").trim());
}

/**
 * Immutably set `path` to `value` inside `config`, or delete the leaf when
 * `value` is empty. Intermediate objects are created on write and dropped on
 * delete only if they were never there to begin with — an existing sibling
 * (the operator's chosen design, say) always survives.
 */
function writePath(
  config: Record<string, unknown>,
  path: readonly string[],
  value: string,
): Record<string, unknown> {
  const [head, ...rest] = path;
  const next = { ...config };

  if (rest.length === 0) {
    if (value) next[head] = value;
    else delete next[head];
    return next;
  }

  const child = next[head];
  const childRecord =
    child && typeof child === "object" && !Array.isArray(child)
      ? (child as Record<string, unknown>)
      : {};
  // Clearing a leaf under a parent that never existed leaves the config alone
  // rather than planting an empty object in it.
  if (!value && child !== childRecord && !(head in next)) return next;

  next[head] = writePath(childRecord, rest, value);
  return next;
}

/**
 * Set (or clear) `defaultProductImage`. Kept as a named wrapper because it is
 * the call site the editor and the action both read as intent, and because
 * scripts/test-default-product-image.ts asserts on it by name.
 */
export function applyDefaultProductImage(
  config: Record<string, unknown>,
  url: string | null,
): Record<string, unknown> {
  return applyBrandingAsset(config, "defaultProductImage", url);
}
