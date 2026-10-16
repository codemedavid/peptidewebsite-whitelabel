// The store's welcome messages (branding.config.communityWelcome). Pure
// (npm run test:community-core) — welcome.server.ts sends them, and
// members.server.ts resolves uploaded media before saving.
//
// Stored shape: { enabled, messages: [{ id, text, media }] }. Stores saved
// before multi-message welcomes hold { enabled, message } — read as one text
// message, so nothing a store already set is lost.

import type { WelcomeItem, WelcomeMedia, WelcomeMessage } from "../mobile/contract";

export const WELCOME_MAX = 1000;
export const WELCOME_MAX_MESSAGES = 10;

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MEDIA_KINDS = new Set(["image", "video"]);

const OFF: WelcomeMessage = { enabled: false, messages: [], message: "" };

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function dimension(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 20_000 ? v : null;
}

function normalizeMedia(v: unknown): WelcomeMedia | null {
  const m = record(v);
  if (!m || !MEDIA_KINDS.has(m.kind as string) || typeof m.url !== "string" || !m.url) return null;
  return {
    kind: m.kind as WelcomeMedia["kind"],
    url: m.url,
    name: typeof m.name === "string" ? m.name : m.kind === "video" ? "video" : "photo",
    size: typeof m.size === "number" && m.size >= 0 ? m.size : 0,
    mime: typeof m.mime === "string" ? m.mime : "",
    width: dimension(m.width),
    height: dimension(m.height),
    posterUrl: m.kind === "video" ? videoPosterUrl(m.url) : null,
  };
}

function normalizeItem(v: unknown, index: number): WelcomeItem | null {
  const o = record(v);
  if (!o) return null;
  const text = typeof o.text === "string" ? o.text.trim().slice(0, WELCOME_MAX) : "";
  const media = normalizeMedia(o.media);
  if (!text && !media) return null;
  return { id: typeof o.id === "string" && ID_RE.test(o.id) ? o.id : `w${index + 1}`, text, media };
}

function view(enabled: boolean, messages: WelcomeItem[]): WelcomeMessage {
  return { enabled: enabled && messages.length > 0, messages, message: messages.find((m) => m.text)?.text ?? "" };
}

/**
 * The store's welcome, as saved. On only when explicitly enabled AND there is
 * at least one message; broken entries are dropped rather than sent.
 */
export function communityWelcome(config: unknown): WelcomeMessage {
  const w = record(record(config)?.communityWelcome);
  if (!w) return OFF;
  const enabled = w.enabled === true;
  if (Array.isArray(w.messages)) {
    const items = w.messages
      .slice(0, WELCOME_MAX_MESSAGES)
      .map(normalizeItem)
      .filter((m): m is WelcomeItem => m !== null);
    return view(enabled, items);
  }
  const legacy = typeof w.message === "string" ? w.message.trim().slice(0, WELCOME_MAX) : "";
  return view(enabled, legacy ? [{ id: "w1", text: legacy, media: null }] : []);
}

/** One message as asked for, before its media is checked against the uploads. */
export type WelcomeDraft = { id: string | null; text: string; media: { kind: WelcomeMedia["kind"]; url: string } | null };

export type ParsedWelcome = { enabled: boolean; messages: WelcomeDraft[] };

type Parsed = { ok: true; value: ParsedWelcome } | { ok: false; error: string };

function parseItem(v: unknown, n: number): { ok: true; value: WelcomeDraft } | { ok: false; error: string } {
  const o = record(v);
  if (!o) return { ok: false, error: `Message ${n} is not a message.` };
  const text = typeof o.text === "string" ? o.text.trim() : "";
  if (text.length > WELCOME_MAX) return { ok: false, error: `Keep message ${n} under ${WELCOME_MAX} characters.` };
  let media: WelcomeDraft["media"] = null;
  if (o.media !== null && o.media !== undefined) {
    const m = record(o.media);
    if (!m || !MEDIA_KINDS.has(m.kind as string) || typeof m.url !== "string" || !m.url) {
      return { ok: false, error: `The photo or video on message ${n} didn't upload. Add it again.` };
    }
    media = { kind: m.kind as WelcomeMedia["kind"], url: m.url };
  }
  if (!text && !media) return { ok: false, error: `Message ${n} is empty. Write something or add a photo or video.` };
  return { ok: true, value: { id: typeof o.id === "string" && ID_RE.test(o.id) ? o.id : null, text, media } };
}

/**
 * PATCH /community/members { welcome }. Takes the list form, or — from app
 * builds before multi-message welcomes — { enabled, message }, which edits
 * only the FIRST message's text and keeps everything else (`current`).
 */
export function parseWelcomeInput(input: unknown, current: WelcomeMessage = OFF): Parsed {
  const o = record(input);
  if (!o) return { ok: false, error: "Send the welcome message settings." };
  if (typeof o.enabled !== "boolean") return { ok: false, error: "Choose whether the welcome message is on." };

  if (!Array.isArray(o.messages)) {
    const text = typeof o.message === "string" ? o.message.trim() : "";
    if (o.enabled && !text && current.messages.length === 0) return { ok: false, error: "Write the welcome message first." };
    if (text.length > WELCOME_MAX) return { ok: false, error: `Keep the welcome message under ${WELCOME_MAX} characters.` };
    const drafts: WelcomeDraft[] = current.messages.map((m) => ({ id: m.id, text: m.text, media: m.media ? { kind: m.media.kind, url: m.media.url } : null }));
    if (drafts.length === 0) {
      if (text) drafts.push({ id: null, text, media: null });
    } else if (text || drafts[0].media) {
      drafts[0] = { ...drafts[0], text };
    }
    return { ok: true, value: { enabled: o.enabled, messages: drafts } };
  }

  if (o.messages.length > WELCOME_MAX_MESSAGES) return { ok: false, error: `Keep it to ${WELCOME_MAX_MESSAGES} welcome messages or fewer.` };
  const messages: WelcomeDraft[] = [];
  for (let i = 0; i < o.messages.length; i++) {
    const item = parseItem(o.messages[i], i + 1);
    if (!item.ok) return item;
    messages.push(item.value);
  }
  if (o.enabled && messages.length === 0) return { ok: false, error: "Add a welcome message first, or switch it off." };
  return { ok: true, value: { enabled: o.enabled, messages } };
}

/** What the store stores: ids made unique, so the app can key and edit each one. */
export function finalizeWelcome(enabled: boolean, items: { id: string | null; text: string; media: WelcomeMedia | null }[], newId: () => string): {
  enabled: boolean;
  messages: WelcomeItem[];
} {
  const seen = new Set<string>();
  const messages = items.map((m) => {
    let id = m.id && !seen.has(m.id) ? m.id : newId();
    while (seen.has(id)) id = newId();
    seen.add(id);
    return { id, text: m.text, media: m.media };
  });
  return { enabled: enabled && messages.length > 0, messages };
}

/** One chat row the welcome sends, in order. */
export type WelcomeRow = {
  kind: "text" | "image" | "video";
  body: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  fileMime: string | null;
  clientId: string;
};

/**
 * Each welcome message as the chat row it becomes. The first keeps the
 * original `welcome:<customerId>` clientId; later ones add their position.
 */
export function welcomeRows(welcome: WelcomeMessage, customerId: string): WelcomeRow[] {
  if (!welcome.enabled) return [];
  return welcome.messages.map((m, i) => {
    const base = { body: m.text || null, clientId: i === 0 ? `welcome:${customerId}` : `welcome:${customerId}:${i + 1}` };
    const empty = { imageUrl: null, imageWidth: null, imageHeight: null, fileUrl: null, fileName: null, fileSize: null, fileMime: null };
    if (m.media?.kind === "image") {
      return { ...base, ...empty, kind: "image", imageUrl: m.media.url, imageWidth: m.media.width, imageHeight: m.media.height };
    }
    if (m.media?.kind === "video") {
      return {
        ...base,
        ...empty,
        kind: "video",
        imageWidth: m.media.width,
        imageHeight: m.media.height,
        fileUrl: m.media.url,
        fileName: m.media.name,
        fileSize: m.media.size,
        fileMime: m.media.mime,
      };
    }
    return { ...base, ...empty, kind: "text" };
  });
}

/**
 * A still frame for a hosted video: ImageKit serves one at
 * `<video url>/ik-thumbnail.jpg`. Anything else (inline dev uploads) → null.
 */
export function videoPosterUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !/(^|\.)imagekit\.io$/i.test(parsed.hostname)) return null;
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/ik-thumbnail.jpg`;
  return parsed.toString();
}
