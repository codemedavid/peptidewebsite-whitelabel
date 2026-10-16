/**
 * Chat media sizes — what keeps storage and download bandwidth small.
 *
 * Photos are shrunk on the phone before upload (WhatsApp-style: long edge
 * 1600 px, JPEG), bubbles and avatars ask ImageKit for a copy sized to their
 * box, and videos play from a 720p rendition ImageKit makes on first view.
 * String rules, not `URL` — React Native's URL has no searchParams.
 */

/** Longest edge a chat photo is sent at — sharp on any phone, ~200–400 KB as JPEG. */
export const PHOTO_MAX_EDGE = 1600;
/** JPEG quality for photos re-encoded on the phone. */
export const PHOTO_QUALITY = 0.75;
/** A JPEG/WebP at or under this size and edge is already light — sent as picked. */
const LIGHT_BYTES = 400 * 1024;
const LIGHT_TYPES = new Set(["image/jpeg", "image/webp"]);

/** Thumbnail widths are rounded up to these steps so phones share cached copies. */
const THUMB_STEP = 160;
const THUMB_MAX = 960;
/** Short edge a video is played at. */
const VIDEO_EDGE = 720;

const IMAGEKIT = /^https:\/\/ik\.imagekit\.io\//i;
const HAS_TRANSFORM = /[?&]tr=/;

export type PhotoResize = { width: number; height: null } | { width: null; height: number };
/** null = send the photo as picked; otherwise re-encode as JPEG, resizing when `resize` is set. */
export type PhotoPlan = { resize: PhotoResize | null } | null;

export function photoPlan(input: { mimeType: string; width: number | null; height: number | null; bytes: number | null }): PhotoPlan {
  // Re-encoding a GIF keeps only its first frame.
  if (input.mimeType === "image/gif") return null;
  const { width, height, bytes } = input;
  if (!width || !height) return { resize: null };
  const longEdge = Math.max(width, height);
  if (longEdge <= PHOTO_MAX_EDGE && LIGHT_TYPES.has(input.mimeType) && bytes != null && bytes <= LIGHT_BYTES) return null;
  if (longEdge <= PHOTO_MAX_EDGE) return { resize: null };
  return { resize: width >= height ? { width: PHOTO_MAX_EDGE, height: null } : { width: null, height: PHOTO_MAX_EDGE } };
}

/** Device pixels for a box `cssWidth` wide, rounded up to a shared step and capped. */
export function thumbWidthFor(cssWidth: number, pixelRatio: number): number {
  const px = Math.ceil((cssWidth * pixelRatio) / THUMB_STEP) * THUMB_STEP;
  return Math.min(Math.max(px, THUMB_STEP), THUMB_MAX);
}

/** Append an ImageKit transform; anything that isn't an untransformed ImageKit URL passes through. */
function withTransform(src: string, tr: string): string {
  if (!IMAGEKIT.test(src)) return src;
  const hashAt = src.indexOf("#");
  const bare = hashAt === -1 ? src : src.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : src.slice(hashAt);
  if (HAS_TRANSFORM.test(bare)) return src;
  return `${bare}${bare.includes("?") ? "&" : "?"}tr=${tr}${hash}`;
}

/** A chat photo or avatar sized to its box, never upscaled (c-at_max). */
export function sizedChatImage(src: string | null | undefined, width: number): string | null {
  if (!src) return null;
  return withTransform(src, `w-${Math.round(width)},c-at_max,q-70,f-auto`);
}

/** The full-screen photo: capped at the upload size, so old full-resolution uploads stay light too. */
export function fullPhotoUrl(src: string): string {
  return withTransform(src, `w-${PHOTO_MAX_EDGE},c-at_max,q-80,f-auto`);
}

/**
 * The URL a video plays from: a 720p rendition when the upload is bigger.
 * ImageKit makes it on first view and redirects to the original until it's
 * ready, so the first viewer never waits.
 */
export function playableVideoUrl(video: { url: string; width: number | null; height: number | null }): string {
  const { url, width, height } = video;
  if (!width || !height || Math.min(width, height) <= VIDEO_EDGE) return url;
  return withTransform(url, width <= height ? `w-${VIDEO_EDGE}` : `h-${VIDEO_EDGE}`);
}
