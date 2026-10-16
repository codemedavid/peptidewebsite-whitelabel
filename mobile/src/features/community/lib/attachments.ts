// What can ride along with a chat message besides text. Pure — the pickers
// and the upload live in hooks/usePickers.ts and hooks/useThread.ts.
import type { GroupBuyCard, MessageKind, ProductCard, ProtocolCard } from "@contract";

/** A photo picked on the device and not yet uploaded. */
export type ImageDraft = { type: "image"; uri: string; mimeType: string; name: string; width: number | null; height: number | null };

/** A video picked from the library and not yet uploaded (store team only). */
export type VideoDraft = { type: "video"; uri: string; mimeType: string; name: string; width: number | null; height: number | null; size: number | null };

/** A document picked from Files and not yet uploaded. */
export type FileDraft = { type: "file"; uri: string; name: string; mimeType: string; size: number | null };

export type Attachment =
  | { type: "product"; product: ProductCard }
  | { type: "protocol"; protocol: ProtocolCard }
  | { type: "groupbuy"; groupBuy: GroupBuyCard }
  | ImageDraft
  | FileDraft;

/** Server limit (docs/mobile-admin/COMMUNITY.md): images max 10 MB. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};

export const IMAGE_MIME_TYPES = Object.keys(EXTENSION_BY_MIME);

/** Server limit for a video (the welcome messages). */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const VIDEO_EXTENSION_BY_MIME: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/3gpp": "3gp" };

/** The picked video's type; the server sniffs the real one, so MP4 is a safe guess. */
export function videoMimeFor(mimeType: string | null | undefined, fileName: string | null | undefined): string {
  const given = mimeType?.toLowerCase();
  if (given && VIDEO_EXTENSION_BY_MIME[given]) return given;
  const extension = fileName?.split(".").pop()?.toLowerCase();
  const byExtension = Object.entries(VIDEO_EXTENSION_BY_MIME).find(([, ext]) => ext === extension);
  return byExtension ? byExtension[0] : "video/mp4";
}

/** A file name for a video that came without one. */
export function videoFileName(mimeType: string, fileName: string | null | undefined, stamp = Date.now()): string {
  if (fileName && fileName.trim()) return fileName.trim();
  return `video-${stamp}.${VIDEO_EXTENSION_BY_MIME[mimeType] ?? "mp4"}`;
}

/** A supported image mime type, taken from the picker or guessed from the file name. */
export function imageMimeFor(mimeType: string | null | undefined, fileName: string | null | undefined): string | null {
  const given = mimeType?.toLowerCase();
  if (given && EXTENSION_BY_MIME[given]) return given;
  const extension = fileName?.split(".").pop()?.toLowerCase();
  return (extension && MIME_BY_EXTENSION[extension]) || null;
}

/** A file name for an upload that came without one (camera shots). */
export function imageFileName(mimeType: string, fileName: string | null | undefined, stamp = Date.now()): string {
  if (fileName && fileName.trim()) return fileName.trim();
  return `photo-${stamp}.${EXTENSION_BY_MIME[mimeType] ?? "jpg"}`;
}

/** Short label for an attachment kind in replies and menus; null for plain text. */
export function attachmentLabel(kind: MessageKind): string | null {
  switch (kind) {
    case "product":
      return "🏷️ Product listing";
    case "protocol":
      return "📋 Protocol";
    case "image":
      return "📷 Photo";
    case "video":
      return "🎬 Video";
    case "file":
      return "📄 Document";
    case "drop":
      return "⚡ Product drop";
    case "groupbuy":
      return "👥 Group buy";
    default:
      return null;
  }
}

/** Tallest a photo bubble may get, relative to its width. */
const MAX_PORTRAIT_RATIO = 4 / 3;
const FALLBACK_RATIO = 3 / 4;

/** On-screen size for a photo bubble: full width, height from the photo's ratio, capped for tall shots. */
export function bubbleImageSize(width: number | null | undefined, height: number | null | undefined, maxWidth: number) {
  const ratio = width && height ? height / width : FALLBACK_RATIO;
  return { width: maxWidth, height: Math.round(maxWidth * Math.min(ratio, MAX_PORTRAIT_RATIO)) };
}
