// Input validation for every community write. Pure (npm run test:community-core).
// Each parser takes untrusted JSON and returns a clean value or a message that
// is safe to show on the phone.

import { isChannelPreviewAccess, type ChannelPreviewAccess } from "./preview";
import { isAudience, type Audience, type PostRole } from "./rules";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const CHANNEL_NAME = [2, 60] as const;
const CHANNEL_DESCRIPTION_MAX = 200;
const TOPIC_NAME = [2, 60] as const;
export const BODY_MAX = 2000;
const REASON = [5, 500] as const;
const DISPLAY_NAME = [2, 40] as const;
const BIO_MAX = 160;
const HEADLINE = [2, 80] as const;
const DROP_NOTE_MAX = 500;
const EMOJI_MAX_CHARS = 16;
const EMOJI_MAX_GRAPHEMES = 2;
const URL_MAX = 2000;
const ID_MAX = 128;
/** A drop can stay live for up to 30 days. */
export const DROP_MAX_MINUTES = 60 * 24 * 30;
export const DEFAULT_EMOJI = "💬";

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = <T>(error: string): Parsed<T> => ({ ok: false, error });

function inRange(s: string, [min, max]: readonly [number, number]): boolean {
  return s.length >= min && s.length <= max;
}

function graphemes(s: string): number {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  return Seg ? [...new Seg(undefined, { granularity: "grapheme" }).segment(s)].length : Array.from(s).length;
}

/**
 * One or two emoji — never words. No ASCII letters, digits or markup, at most
 * two grapheme clusters (so 👍🏽, 🇵🇭 and 👨‍👩‍👧 count as one each).
 */
export function parseEmoji(v: unknown): Parsed<string> {
  const e = str(v);
  if (!e) return ok(DEFAULT_EMOJI);
  if (e.length > EMOJI_MAX_CHARS || /[\x00-\x7f]/.test(e.replace(/[#*0-9]\uFE0F?\u20E3/g, ""))) return bad("Pick an emoji.");
  return graphemes(e) <= EMOJI_MAX_GRAPHEMES ? ok(e) : bad("Pick one or two emoji.");
}

/**
 * The SHAPE of a picture link: a hosted https image or an inline image. Whether
 * it is really one of this participant's uploads is checked server-side
 * against CommunityUpload (uploads.server.ts) — this never trusts it alone.
 */
export function parseImageUrl(v: unknown): Parsed<string | null> {
  if (v === null || v === undefined || v === "") return ok(null);
  const s = str(v);
  if (/^https:\/\/[^\s]+$/i.test(s) && s.length <= URL_MAX) return ok(s);
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(s)) return ok(s);
  return bad("That picture link isn't valid.");
}

/** A new member's starting name: their account name, else "Member" — never the email. */
export function defaultDisplayName(accountName: unknown): string {
  const name = parseDisplayName(accountName);
  return name.ok ? name.value : "Member";
}

export type ChannelFields = {
  name: string;
  description: string | null;
  emoji: string;
  imageUrl: string | null;
  postRole: PostRole;
  audience: Audience;
  /** Only when the request sets it — an edit from an older app leaves the channel's setting alone. */
  previewAccess?: ChannelPreviewAccess;
};

export function parseChannelInput(input: unknown): Parsed<ChannelFields> {
  const o = obj(input);
  if (!o) return bad("Give the channel a name.");
  const name = str(o.name);
  if (!inRange(name, CHANNEL_NAME)) return bad("Channel names are 2–60 characters.");
  const description = str(o.description);
  if (description.length > CHANNEL_DESCRIPTION_MAX) return bad("Keep the description under 200 characters.");
  const postRole = o.postRole === undefined ? "everyone" : o.postRole;
  if (postRole !== "everyone" && postRole !== "admins") return bad("Choose who can post.");
  const audience = o.audience === undefined ? "everyone" : o.audience;
  if (!isAudience(audience)) return bad("Choose who can see the channel.");
  const emoji = parseEmoji(o.emoji);
  if (!emoji.ok) return emoji;
  const imageUrl = parseImageUrl(o.imageUrl);
  if (!imageUrl.ok) return imageUrl;
  if (o.previewAccess !== undefined && !isChannelPreviewAccess(o.previewAccess)) return bad("Choose what people in preview get here.");
  // A hub is open for posting; its topics decide who posts (rules.ts canPostInTopic).
  return ok({
    name,
    description: description || null,
    emoji: emoji.value,
    imageUrl: imageUrl.value,
    postRole: audience === "hub" ? "everyone" : postRole,
    audience,
    ...(o.previewAccess !== undefined ? { previewAccess: o.previewAccess as ChannelPreviewAccess } : {}),
  });
}

export type TopicFields = { name: string; emoji: string; imageUrl: string | null };

export function parseTopicInput(input: unknown): Parsed<TopicFields> {
  const o = obj(input);
  if (!o) return bad("Give the topic a name.");
  const name = str(o.name);
  if (!inRange(name, TOPIC_NAME)) return bad("Topic names are 2–60 characters.");
  const emoji = parseEmoji(o.emoji);
  if (!emoji.ok) return emoji;
  const imageUrl = parseImageUrl(o.imageUrl);
  if (!imageUrl.ok) return imageUrl;
  return ok({ name, emoji: emoji.value, imageUrl: imageUrl.value });
}

/** Text needs words; attachments and cards take an optional caption. */
export function parseMessageBody(kind: string, body: unknown): Parsed<string | null> {
  const text = str(body);
  if (text.length > BODY_MAX) return bad("Messages are up to 2,000 characters.");
  if (kind === "text") return text ? ok(text) : bad("Type a message first.");
  return ok(text || null);
}

export function parseEditBody(body: unknown): Parsed<string> {
  const r = parseMessageBody("text", body);
  return r.ok ? ok(r.value as string) : r;
}

export type ReviewFields = { approve: boolean; reason: string | null };

export function parseReviewInput(input: unknown): Parsed<ReviewFields> {
  const o = obj(input);
  if (!o || typeof o.approve !== "boolean") return bad("Approve or decline this application.");
  if (o.approve) return ok({ approve: true, reason: null });
  const reason = str(o.reason);
  if (!inRange(reason, REASON)) return bad("Tell them why in 5–500 characters.");
  return ok({ approve: false, reason });
}

export function parseDisplayName(v: unknown): Parsed<string> {
  const name = str(v).replace(/\s+/g, " ");
  return inRange(name, DISPLAY_NAME) ? ok(name) : bad("Display names are 2–40 characters.");
}

export type ProfileFields = { displayName: string; bio: string };

export function parseProfileUpdate(input: unknown): Parsed<ProfileFields> {
  const o = obj(input);
  if (!o) return bad("Nothing to save.");
  const displayName = parseDisplayName(o.displayName);
  if (!displayName.ok) return displayName;
  const bio = str(o.bio);
  if (bio.length > BIO_MAX) return bad("Keep your bio under 160 characters.");
  return ok({ displayName: displayName.value, bio });
}

function parseId(v: unknown): string | null {
  const s = str(v);
  return s && s.length <= ID_MAX ? s : null;
}

export type DropFields = {
  productId: string;
  variationId: string | null;
  headline: string;
  note: string | null;
  durationMinutes: number | null;
  channelId: string;
};

export function parseDropInput(input: unknown): Parsed<DropFields> {
  const o = obj(input);
  if (!o) return bad("Pick a product to drop.");
  const productId = parseId(o.productId);
  if (!productId) return bad("Pick a product to drop.");
  const channelId = parseId(o.channelId);
  if (!channelId) return bad("Pick the channel that announces it.");
  const variationId = o.variationId === null || o.variationId === undefined || o.variationId === "" ? null : parseId(o.variationId);
  if (o.variationId && !variationId) return bad("That option isn't available.");
  const headline = str(o.headline);
  if (!inRange(headline, HEADLINE)) return bad("Headlines are 2–80 characters.");
  const note = str(o.note);
  if (note.length > DROP_NOTE_MAX) return bad("Keep the note under 500 characters.");
  let durationMinutes: number | null = null;
  if (o.durationMinutes !== null && o.durationMinutes !== undefined) {
    const n = Number(o.durationMinutes);
    if (!Number.isInteger(n) || n < 1 || n > DROP_MAX_MINUTES) return bad("A drop runs from 1 minute to 30 days.");
    durationMinutes = n;
  }
  return ok({ productId, variationId, headline, note: note || null, durationMinutes, channelId });
}

const BROADCAST_CHANNELS_MAX = 20;
const BROADCAST_NOTE_MAX = 500;
const CLIENT_ID_RE = /^[A-Za-z0-9_.:-]{1,40}$/;

export type GroupBuyBroadcastFields = { clientId: string; channelIds: string[]; note: string | null };

/**
 * "Send the group buy to everyone": 1–20 channels, an optional caption, and a
 * client id that makes a retry post nothing twice (it is suffixed per topic, so
 * it stays short enough for the message's 64-character clientId).
 */
export function parseGroupBuyBroadcast(input: unknown): Parsed<GroupBuyBroadcastFields> {
  const o = obj(input);
  if (!o) return bad("Pick where to send it.");
  const clientId = str(o.clientId);
  if (!CLIENT_ID_RE.test(clientId)) return bad("Couldn't send that. Try again.");
  if (!Array.isArray(o.channelIds) || o.channelIds.some((c) => typeof c !== "string")) return bad("Pick where to send it.");
  const channelIds = [...new Set((o.channelIds as string[]).map((c) => parseId(c)).filter((c): c is string => !!c))];
  if (channelIds.length === 0) return bad("Pick at least one channel.");
  if (channelIds.length > BROADCAST_CHANNELS_MAX) return bad(`Pick up to ${BROADCAST_CHANNELS_MAX} channels.`);
  const note = str(o.note);
  if (note.length > BROADCAST_NOTE_MAX) return bad("Keep the note under 500 characters.");
  return ok({ clientId, channelIds, note: note || null });
}
