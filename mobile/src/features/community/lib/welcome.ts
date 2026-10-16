// The welcome-message editor's working copy. Pure (scripts/test-community-lib.ts)
// — WelcomeEditor.tsx holds the state, the server re-checks everything.
import type { WelcomeItem, WelcomeMessage, WelcomeRequest } from "@contract";

/** Mirrors the server (src/lib/community/welcome.ts). */
export const WELCOME_TEXT_MAX = 1000;
export const WELCOME_MAX_MESSAGES = 10;

/** A photo or video on a message being edited: picked on the phone, uploading, or saved. */
export type DraftMedia = {
  kind: "image" | "video";
  /** What to show: the local file while it uploads, the hosted URL after. */
  previewUri: string;
  /** Set once uploaded (or loaded from the saved welcome). */
  url: string | null;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  size: number;
  status: "uploading" | "ready" | "failed";
  error: string | null;
};

export type DraftItem = {
  /** Stable React key; also the server id for saved messages. */
  key: string;
  /** The server's id — null for messages added in this session. */
  id: string | null;
  text: string;
  media: DraftMedia | null;
};

export function draftFromSaved(m: WelcomeItem): DraftItem {
  return {
    key: m.id,
    id: m.id,
    text: m.text,
    media: m.media
      ? {
          kind: m.media.kind,
          previewUri: m.media.url,
          url: m.media.url,
          posterUrl: m.media.posterUrl,
          width: m.media.width,
          height: m.media.height,
          size: m.media.size,
          status: "ready",
          error: null,
        }
      : null,
  };
}

export function draftsFromWelcome(w: WelcomeMessage): DraftItem[] {
  return w.messages.map(draftFromSaved);
}

/** The list with the item at `index` moved one place up (-1) or down (+1). */
export function moveItem<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const to = index + direction;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** The list with `item` put at `index`, or added to the end when index is null. */
export function upsertItem(items: readonly DraftItem[], index: number | null, item: DraftItem): DraftItem[] {
  if (index === null || index < 0 || index >= items.length) return [...items, item];
  return items.map((it, i) => (i === index ? item : it));
}

export function removeItem<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}

/** Why a single message can't be kept yet, or null when it can. */
export function itemProblem(item: Pick<DraftItem, "text" | "media">): string | null {
  if (item.media?.status === "uploading") return "Wait for the upload to finish.";
  if (item.media?.status === "failed") return "The upload failed. Try again or remove it.";
  if (item.text.trim().length > WELCOME_TEXT_MAX) return `Keep it under ${WELCOME_TEXT_MAX} characters.`;
  if (!item.text.trim() && !item.media) return "Write something or add a photo or video.";
  return null;
}

/** Why the whole welcome can't be saved yet, or null when it can. */
export function welcomeProblem(enabled: boolean, items: readonly DraftItem[]): string | null {
  if (items.length > WELCOME_MAX_MESSAGES) return `Keep it to ${WELCOME_MAX_MESSAGES} messages or fewer.`;
  if (enabled && items.length === 0) return "Add a message, or switch the welcome off.";
  const bad = items.findIndex((it) => itemProblem(it) !== null);
  return bad >= 0 ? `Message ${bad + 1}: ${itemProblem(items[bad])}` : null;
}

export function toWelcomeRequest(enabled: boolean, items: readonly DraftItem[]): WelcomeRequest["welcome"] {
  return {
    enabled,
    messages: items.map((it) => ({
      ...(it.id ? { id: it.id } : {}),
      text: it.text.trim(),
      media: it.media?.url ? { kind: it.media.kind, url: it.media.url } : null,
    })),
  };
}

/** One line for the list and the Members card: the text, else what's attached. */
export function itemSummary(item: { text: string; media: { kind: "image" | "video" } | null }): string {
  const text = item.text.replace(/\s+/g, " ").trim();
  if (text) return text;
  if (item.media?.kind === "video") return "Video";
  if (item.media?.kind === "image") return "Photo";
  return "Empty message";
}

/** The Members screen card's second line. */
export function welcomeCardLine(w: WelcomeMessage): string {
  if (!w.enabled) return "Off · new members get no message";
  const first = w.messages[0] ? itemSummary(w.messages[0]) : "On";
  return w.messages.length > 1 ? `${w.messages.length} messages · ${first}` : first;
}
