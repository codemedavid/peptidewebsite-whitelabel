// What a community upload really is, decided from its BYTES. Pure
// (npm run test:community-core).
//
// Same lesson as lib/upload/image-file.ts (classifyProofFile): the phone's
// reported MIME type is a hint — Android pickers and in-app webviews send ""
// or application/octet-stream for perfectly good JPEGs. Unlike a payment
// proof, community files are re-served to OTHER people, so here the bytes are
// the authority: an image must carry an image signature, and a document must
// carry both an allowed extension and bytes that match it. The declared type
// is never trusted on its own.

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const FILE_MAX_BYTES = 25 * 1024 * 1024;
/** Demo / no-ImageKit fallback stores the bytes inline, so keep them small. */
export const INLINE_MAX_BYTES = 2 * 1024 * 1024;

const FILE_NAME_MAX = 120;
// C0/C1 controls, zero-width + bidi overrides/isolates, and path/markup chars.
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\\/:*?"<>|]/g;

/**
 * A display-safe file name ending in the SNIFFED extension: no control or bidi
 * characters (so "inv\u202Efdp.exe" can't pose as a PDF), no path parts.
 */
export function sanitizeFileName(raw: string, ext: string): string {
  const cleaned = (raw || "").normalize("NFC").replace(UNSAFE_NAME_CHARS, "").replace(/\.{2,}/g, "").replace(/\s+/g, " ").trim();
  const base = cleaned.slice(0, FILE_NAME_MAX).trim();
  if (!base.replace(/\.+/g, "")) return `file.${ext}`;
  if (base.toLowerCase().endsWith(`.${ext}`)) return base;
  const stem = base.replace(/\.[^.]*$/, "") || "file";
  return `${stem}.${ext}`;
}

export type UploadVerdict =
  | { ok: true; kind: "image" | "file"; mime: string; ext: string }
  | { ok: false; error: string };

type Signature = "pdf" | "zip" | "ole" | "rtf" | "text";

const DOCUMENTS: Record<string, { mime: string; sig: Signature }> = {
  pdf: { mime: "application/pdf", sig: "pdf" },
  doc: { mime: "application/msword", sig: "ole" },
  xls: { mime: "application/vnd.ms-excel", sig: "ole" },
  ppt: { mime: "application/vnd.ms-powerpoint", sig: "ole" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sig: "zip" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sig: "zip" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", sig: "zip" },
  txt: { mime: "text/plain", sig: "text" },
  csv: { mime: "text/csv", sig: "text" },
  rtf: { mime: "application/rtf", sig: "rtf" },
};

const UNSUPPORTED = "Send a photo, or a PDF, Word, Excel, PowerPoint, text or CSV file.";

function startsWith(head: Uint8Array, bytes: number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  return bytes.every((b, i) => head[offset + i] === b);
}

function ascii(head: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...head.slice(from, to));
}

/** The image format these bytes are, or null. */
function sniffImage(head: Uint8Array): { mime: string; ext: string } | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") return { mime: "image/gif", ext: "gif" };
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (["heic", "heix", "hevc", "mif1", "msf1"].includes(brand)) return { mime: "image/heic", ext: "heic" };
    if (brand === "avif") return { mime: "image/avif", ext: "avif" };
  }
  return null;
}

/** Printable text: no NULs and almost no control bytes in the sample. */
function looksLikeText(head: Uint8Array): boolean {
  if (head.length === 0) return false;
  let control = 0;
  for (const b of head) {
    if (b === 0) return false;
    if (b < 0x09 || (b > 0x0d && b < 0x20)) control++;
  }
  return control / head.length < 0.02;
}

function matches(sig: Signature, head: Uint8Array): boolean {
  switch (sig) {
    case "pdf":
      return ascii(head, 0, 5) === "%PDF-";
    case "zip":
      return startsWith(head, [0x50, 0x4b, 0x03, 0x04]);
    case "ole":
      return startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case "rtf":
      return ascii(head, 0, 5) === "{\\rtf";
    case "text":
      return looksLikeText(head);
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 || dot === name.length - 1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function classifyUpload(input: {
  name: string;
  declaredMime: string;
  /** The first bytes of the file (a few hundred is plenty). */
  head: Uint8Array;
  size: number;
}): UploadVerdict {
  if (!Number.isFinite(input.size) || input.size <= 0) return { ok: false, error: "That file is empty." };

  const image = sniffImage(input.head);
  if (image) {
    if (input.size > IMAGE_MAX_BYTES) return { ok: false, error: "Photos can be up to 10 MB." };
    return { ok: true, kind: "image", ...image };
  }

  const ext = extensionOf((input.name || "").trim());
  const doc = DOCUMENTS[ext];
  if (!doc || !matches(doc.sig, input.head)) return { ok: false, error: UNSUPPORTED };
  if (input.size > FILE_MAX_BYTES) return { ok: false, error: "Files can be up to 25 MB." };
  return { ok: true, kind: "file", mime: doc.mime, ext };
}

/** Pixel size from a PNG / GIF / JPEG / WebP header, or null. */
export function imageSize(head: Uint8Array): { width: number; height: number } | null {
  const u16be = (i: number) => (head[i] << 8) | head[i + 1];
  const u16le = (i: number) => head[i] | (head[i + 1] << 8);
  const u32be = (i: number) => ((head[i] << 24) | (head[i + 1] << 16) | (head[i + 2] << 8) | head[i + 3]) >>> 0;
  const found = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);

  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47]) && head.length >= 24) return found(u32be(16), u32be(20));
  if (ascii(head, 0, 3) === "GIF" && head.length >= 10) return found(u16le(6), u16le(8));
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP" && head.length >= 30) {
    const chunk = ascii(head, 12, 16);
    if (chunk === "VP8 ") return found(u16le(26) & 0x3fff, u16le(28) & 0x3fff);
    if (chunk === "VP8X") return found(1 + (head[24] | (head[25] << 8) | (head[26] << 16)), 1 + (head[27] | (head[28] << 8) | (head[29] << 16)));
    if (chunk === "VP8L" && head.length >= 25) {
      const b = head.slice(21, 25);
      return found(1 + (((b[1] & 0x3f) << 8) | b[0]), 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)));
    }
    return null;
  }
  if (startsWith(head, [0xff, 0xd8])) {
    let i = 2;
    while (i + 9 < head.length) {
      if (head[i] !== 0xff) return null;
      const marker = head[i + 1];
      const len = u16be(i + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return found(u16be(i + 7), u16be(i + 5));
      i += 2 + len;
    }
  }
  return null;
}
