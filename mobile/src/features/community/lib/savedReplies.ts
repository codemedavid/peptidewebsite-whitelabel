// Saved replies in the composer: typing "/" at the start of a message searches
// the store team's quick answers (Business Suite style). Pure — covered by
// mobile/scripts/test-community-lib.ts.
import type { CommunityMessage, SavedReply, SavedReplyImage, SavedReplyRequest } from "@contract";

/** Longest title the server accepts (src/lib/community/saved-replies.ts) plus the "/". */
const MAX_SHORTCUT = 61;

/** The search after a leading "/", or null when the draft is a normal message. */
export function shortcutQuery(draft: string): string | null {
  if (!draft.startsWith("/") || draft.includes("\n") || draft.length > MAX_SHORTCUT) return null;
  return draft.slice(1);
}

/**
 * Replies matching `query`: title starts with it, then title contains it,
 * then message contains it. An empty query keeps the saved order.
 */
export function matchSavedReplies(list: SavedReply[], query: string, limit = Infinity): SavedReply[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, limit);
  const rank = (r: SavedReply): number => {
    const title = r.title.toLowerCase();
    if (title.startsWith(q)) return 0;
    if (title.includes(q)) return 1;
    return r.body.toLowerCase().includes(q) ? 2 : -1;
  };
  return list
    .map((r) => ({ r, score: rank(r) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.r);
}

/** The draft after picking a reply: it replaces a "/shortcut" or blank draft, else goes on a new line. */
export function applySavedReply(draft: string, body: string): string {
  const replace = !draft.trim() || shortcutQuery(draft) !== null;
  if (!body.trim()) return replace ? "" : draft; // a photo-only reply
  if (replace) return body;
  return `${draft.replace(/\s+$/, "")}\n${body}`;
}

export function photoLabel(count: number): string {
  return `${count} ${count === 1 ? "photo" : "photos"}`;
}

/** One line for a list row: the message, or "3 photos" for a photo-only reply. */
export function savedReplySummary(reply: SavedReply): string {
  const text = reply.body.replace(/\s+/g, " ").trim();
  return text || photoLabel(reply.images.length);
}

/** A photo in the saved-reply form: uploads as soon as it's picked. */
export type FormPhoto = {
  key: string;
  previewUri: string;
  /** Set once uploaded. */
  url: string | null;
  width: number | null;
  height: number | null;
  status: "uploading" | "ready" | "failed";
};

/** Why the form can't be saved yet because of its photos, or null. */
export function formPhotosProblem(photos: FormPhoto[]): string | null {
  if (photos.some((p) => p.status === "uploading")) return "Photos are still uploading…";
  if (photos.some((p) => p.status === "failed")) return "A photo failed to upload. Remove it or try it again.";
  return null;
}

export function toSavedReplyRequest(title: string, body: string, photos: FormPhoto[]): SavedReplyRequest {
  return { title, body, images: photos.flatMap((p) => (p.url ? [{ url: p.url }] : [])) };
}

/**
 * "Save as reply" on a message: its text, plus its photo when the store team
 * sent it (a member's upload can't be re-sent by the team). Null = nothing to save.
 */
export function saveAsReplyFrom(m: Pick<CommunityMessage, "body" | "image" | "sender">): { body: string; images: SavedReplyImage[] } | null {
  const images = m.image && m.sender?.isTeam ? [{ url: m.image.url, width: m.image.width || null, height: m.image.height || null }] : [];
  const body = m.body ?? "";
  return body.trim() || images.length ? { body, images } : null;
}
