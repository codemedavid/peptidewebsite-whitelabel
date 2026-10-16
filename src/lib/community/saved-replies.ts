// Saved replies: the store team's shared quick answers (Business Suite style).
// Pure — npm run test:community-saved-replies. saved-replies.server.ts loads
// and stores the list; this file decides what a valid list looks like.
//
// Stored in branding.config.communitySavedReplies: SavedReply[]. Every admin
// with the community module sees and edits the same list.

import type { SavedReply, SavedReplyImage } from "@/lib/mobile/contract";

export type { SavedReply, SavedReplyImage };

export const SAVED_REPLY_MAX = 100;
export const SAVED_REPLY_TITLE_MAX = 60;
/** Same cap as a chat message, so any saved reply can be sent as-is. */
export const SAVED_REPLY_BODY_MAX = 2000;
/** Not a product limit (the owner wants none) — a ceiling on one request so a bad client can't bloat the store config. */
export const SAVED_REPLY_IMAGES_MAX = 100;

/** What the request asks for; the server swaps the urls for verified upload records. */
export type ParsedSavedReply = { title: string; body: string; imageUrls: string[] };
export type SavedReplyInput = { title: string; body: string; images: SavedReplyImage[] };
export type SavedReplyAuthor = { key: string; name: string };
export type ListResult = { ok: true; value: SavedReply[] } | { ok: false; error: string; notFound?: boolean };

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

const byTitle = (a: SavedReply, b: SavedReply) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

function sameTitle(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

function size(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function imageFromRow(raw: unknown): SavedReplyImage | null {
  const r = record(raw);
  const url = text(r?.url);
  return r && url ? { url, width: size(r.width), height: size(r.height) } : null;
}

function fromRow(raw: unknown): SavedReply | null {
  const r = record(raw);
  if (!r) return null;
  const id = text(r.id);
  const title = text(r.title).trim();
  const body = text(r.body).trim();
  const images = (Array.isArray(r.images) ? r.images : []).map(imageFromRow).filter((i): i is SavedReplyImage => i !== null);
  if (!id || !title || (!body && images.length === 0)) return null;
  return {
    id,
    title,
    body,
    images,
    createdBy: text(r.createdBy),
    updatedBy: text(r.updatedBy) || text(r.createdBy),
    createdByKey: text(r.createdByKey),
    updatedByKey: text(r.updatedByKey) || text(r.createdByKey),
    createdAt: text(r.createdAt),
    updatedAt: text(r.updatedAt) || text(r.createdAt),
  };
}

/** The store's saved replies as stored, malformed rows dropped, A→Z by title. */
export function savedReplies(config: unknown): SavedReply[] {
  const raw = record(config)?.communitySavedReplies;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(fromRow)
    .filter((r): r is SavedReply => r !== null)
    .slice(0, SAVED_REPLY_MAX)
    .sort(byTitle);
}

/** `images: [{ url }]` → distinct urls in order, or null when the shape is wrong. */
function parseImageUrls(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const urls: string[] = [];
  for (const item of raw) {
    const url = record(item)?.url;
    if (typeof url !== "string" || !url) return null;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

/**
 * POST/PATCH body → a trimmed title, message and photo urls. A leading "/" on
 * the title is the shortcut prefix, not part of it. Photos alone are a reply.
 */
export function parseSavedReplyInput(body: unknown): { ok: true; value: ParsedSavedReply } | { ok: false; error: string } {
  const b = record(body);
  if (!b || typeof b.title !== "string" || typeof b.body !== "string") return { ok: false, error: "Add a title and a message." };
  const title = b.title.trim().replace(/^\/+/, "").trim();
  const message = b.body.trim();
  const imageUrls = parseImageUrls(b.images);
  if (!title) return { ok: false, error: "Give the reply a short title." };
  if (title.length > SAVED_REPLY_TITLE_MAX) return { ok: false, error: `Keep the title under ${SAVED_REPLY_TITLE_MAX} characters.` };
  if (!imageUrls) return { ok: false, error: "A photo didn't upload properly. Remove it and add it again." };
  if (imageUrls.length > SAVED_REPLY_IMAGES_MAX) return { ok: false, error: `A saved reply can hold up to ${SAVED_REPLY_IMAGES_MAX} photos.` };
  if (!message && imageUrls.length === 0) return { ok: false, error: "Add a message or a photo." };
  if (message.length > SAVED_REPLY_BODY_MAX) return { ok: false, error: `Keep the message under ${SAVED_REPLY_BODY_MAX} characters.` };
  return { ok: true, value: { title, body: message, imageUrls } };
}

function titleTaken(list: SavedReply[], title: string, exceptId: string | null): boolean {
  return list.some((r) => r.id !== exceptId && sameTitle(r.title, title));
}

const TAKEN = "A saved reply already has that title. Pick another one.";

export function addSavedReply(list: SavedReply[], input: SavedReplyInput, meta: { id: string; by: SavedReplyAuthor; now: Date }): ListResult {
  if (list.length >= SAVED_REPLY_MAX) return { ok: false, error: `You can keep up to ${SAVED_REPLY_MAX} saved replies. Delete one first.` };
  if (titleTaken(list, input.title, null)) return { ok: false, error: TAKEN };
  const at = meta.now.toISOString();
  const reply: SavedReply = {
    id: meta.id,
    ...input,
    createdBy: meta.by.name,
    updatedBy: meta.by.name,
    createdByKey: meta.by.key,
    updatedByKey: meta.by.key,
    createdAt: at,
    updatedAt: at,
  };
  return { ok: true, value: [...list, reply].sort(byTitle) };
}

export function updateSavedReply(list: SavedReply[], id: string, input: SavedReplyInput, meta: { by: SavedReplyAuthor; now: Date }): ListResult {
  if (!list.some((r) => r.id === id)) return { ok: false, error: "That saved reply was deleted.", notFound: true };
  if (titleTaken(list, input.title, id)) return { ok: false, error: TAKEN };
  const at = meta.now.toISOString();
  const next = list.map((r) => (r.id === id ? { ...r, ...input, updatedBy: meta.by.name, updatedByKey: meta.by.key, updatedAt: at } : r));
  return { ok: true, value: next.sort(byTitle) };
}

export function removeSavedReply(list: SavedReply[], id: string): ListResult {
  if (!list.some((r) => r.id === id)) return { ok: false, error: "That saved reply was already deleted.", notFound: true };
  return { ok: true, value: list.filter((r) => r.id !== id) };
}
