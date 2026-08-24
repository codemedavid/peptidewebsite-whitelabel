/**
 * Storefront image sizing.
 *
 * Every storefront image is a raw <img>: the design's CSS (object-fit, aspect
 * ratios, the flush hero) is tuned around real <img> boxes, and routing them
 * through next/image would both fight that CSS and pay Vercel's optimizer for
 * work ImageKit already does at its own edge. So instead of swapping the
 * element, we size the URL.
 *
 * ImageKit resizes from the URL: appending `tr=w-600,q-75,f-auto` returns that
 * image at 600px wide, quality-capped, in AVIF or WebP if the requesting
 * browser accepts one. Without it ImageKit serves the untouched original — a
 * 2000px phone photo painted into a 300px card.
 *
 * The one hard rule: only rewrite URLs we know are ImageKit's. Admin upload
 * previews are `blob:`/`data:`, some tenants still carry art on foreign hosts,
 * and local assets are relative — appending `tr=` to any of those produces a
 * broken image, so they pass through byte-for-byte.
 */

const IMAGEKIT_HOST = "ik.imagekit.io";

/** ImageKit's transformation query key. */
const TR = "tr";

export type ImageTransform = {
  /** Rendered width in CSS px. The single most important field: it's what stops
   *  a 2000px original from being sent to a 300px slot. */
  width?: number;
  /** Rendered height. Omit to let ImageKit preserve the aspect ratio. */
  height?: number;
  /** 1-100. Defaults to DEFAULT_QUALITY, which is visually lossless for photos
   *  at these sizes while cutting most of the bytes. */
  quality?: number;
};

/** High enough that product photography stays crisp, low enough to matter. */
const DEFAULT_QUALITY = 75;

/**
 * True only for URLs ImageKit serves, which are the only ones `tr=` means
 * anything to. Parsed rather than substring-matched so a foreign URL that merely
 * mentions the host (`https://evil.test/?u=ik.imagekit.io`) isn't rewritten.
 */
export function isImageKitUrl(src: string | null | undefined): boolean {
  if (!src) return false;
  try {
    const url = new URL(src);
    return url.protocol === "https:" && url.hostname === IMAGEKIT_HOST;
  } catch {
    // Relative paths, data:/blob: URIs, and malformed input all land here.
    return false;
  }
}

/**
 * Size an ImageKit URL to the box it renders into. Any other source — and any
 * URL that already carries a transform — is returned exactly as given, so this
 * is safe to wrap around a value of unknown provenance and safe to apply twice.
 */
export function imageUrl(src: string, t: ImageTransform = {}): string {
  if (!src || !isImageKitUrl(src)) return src;

  // Parsed for INSPECTION only. The returned string is built by appending to the
  // original `src`, never by re-serializing the parsed URL: URL.toString()
  // re-encodes the whole query (`%20` becomes `+`), and any attempt to tidy the
  // comma-delimited transform list afterwards would also decode `%2C` in the
  // object path. Either one silently points the <img> at a different object.
  if (hasTransform(src)) return src;

  const parts: string[] = [];
  if (t.width) parts.push(`w-${Math.round(t.width)}`);
  if (t.height) parts.push(`h-${Math.round(t.height)}`);
  parts.push(`q-${clampQuality(t.quality)}`);
  // Let the edge negotiate AVIF/WebP from the browser's Accept header.
  parts.push("f-auto");

  // Split off the fragment so `tr=` lands in the query, not after the '#'.
  const hashAt = src.indexOf("#");
  const hash = hashAt === -1 ? "" : src.slice(hashAt);
  const bare = hashAt === -1 ? src : src.slice(0, hashAt);

  // A '?' only when there isn't one already, so an existing query (a
  // cache-busting `?v=`, a signed `?ik-s=`) is carried through byte-for-byte.
  const sep = bare.includes("?") ? "&" : "?";
  // ImageKit's transform list is comma-delimited by design, so the commas are
  // written literally rather than percent-encoded.
  return `${bare}${sep}${TR}=${parts.join(",")}${hash}`;
}

/** Whether a URL already carries an explicit `tr=` transform. */
function hasTransform(src: string): boolean {
  try {
    return new URL(src).searchParams.has(TR);
  } catch {
    return false;
  }
}

function clampQuality(q: number | undefined): number {
  if (!q || !Number.isFinite(q)) return DEFAULT_QUALITY;
  return Math.min(100, Math.max(1, Math.round(q)));
}

/**
 * A `srcSet` of the same image at several widths, letting the browser pick by
 * viewport and DPR instead of us guessing. Empty string for non-ImageKit
 * sources — an empty srcSet is ignored, so `src` alone still renders.
 */
export function imageSrcSet(src: string, widths: number[], t: ImageTransform = {}): string {
  if (!isImageKitUrl(src)) return "";
  // `imageUrl` is idempotent, so mapping it over the ladder here would emit the
  // SAME url under every width descriptor — telling the browser a 100px image is
  // a 720w candidate, which it would then paint blurry into a large slot. An
  // empty srcSet is ignored and `src` alone renders, which is the honest answer.
  if (hasTransform(src)) return "";
  return widths
    .map((w) => `${imageUrl(src, { ...t, width: w })} ${w}w`)
    .join(", ");
}

/**
 * Width ladders per surface. Ascending, and capped at roughly 2x the largest
 * slot the design gives each image — past that we'd be shipping bytes no
 * display resolves.
 */
export const CARD_WIDTHS = [240, 360, 480, 720] as const satisfies readonly number[];
export const HERO_WIDTHS = [640, 960, 1280, 1920] as const satisfies readonly number[];

/**
 * `sizes` tells the browser how wide the image will render BEFORE layout, so it
 * can pick a candidate on first paint. Without it the browser assumes 100vw and
 * downloads the largest candidate — which would undo the srcSet entirely.
 */
// Cards: ~2 per row on phones, 3 on tablets, 4 on desktop.
export const CARD_SIZES = "(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 22vw";
// Hero spans the viewport at every breakpoint.
export const HERO_SIZES = "100vw";

/** Logos render small and fixed; one modest width beats a ladder. */
export const LOGO_WIDTH = 240;
