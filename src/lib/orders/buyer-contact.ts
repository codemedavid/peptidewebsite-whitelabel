// Where the buyer actually reached the store — the admin's record, not the buyer's.
//
// Most orders are finalised in a chat app: the buyer places the order, then
// messages the store on WhatsApp or Telegram. The checkout's `contactMethod` is
// what the buyer CLICKED; this is what the admin KNOWS — the exact WhatsApp
// number or Telegram username the conversation is happening on, so status
// updates can go back to the same chat in one tap.
//
// Stored inside the order's `customer` JSON as `reachedVia` (no schema change),
// written only by the store admin (website + app) through
// applyOrderStatusChange, and stripped from every checkout payload so a buyer
// can never set it.
//
// Pure (npm run test:buyer-contact).

import type { Order } from "../../storefront/types";
import { customerKeyOf } from "../storefront/customer-profile";
import { buildWaLink } from "../admin/whatsapp";

export const BUYER_APPS = ["whatsapp", "telegram"] as const;
export type BuyerApp = (typeof BUYER_APPS)[number];
export type BuyerChannel = { app: BuyerApp; handle: string };

export const BUYER_APP_LABEL: Record<BuyerApp, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};

const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15; // E.164
const MAX_HANDLE_INPUT = 64;
// Telegram usernames: 5–32 chars, letters/digits/underscore, starting with a letter.
const TG_USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
// What a typed phone number may contain before we strip it to digits.
const PHONE_CHARS_RE = /^\+?[\d\s().-]+$/;

export function isBuyerApp(v: unknown): v is BuyerApp {
  return typeof v === "string" && (BUYER_APPS as readonly string[]).includes(v);
}

/**
 * A typed phone number → international digits (no "+"), or null.
 * Philippine local forms are the common case and are widened to +63:
 *   0917 123 4567 → 639171234567,  917 123 4567 → 639171234567.
 */
export function internationalDigits(raw: string): string | null {
  const s = raw.trim();
  if (!s || !PHONE_CHARS_RE.test(s)) return null;
  let d = s.replace(/\D/g, "");
  if (!s.startsWith("+")) {
    if (d.startsWith("00")) d = d.slice(2);
    else if (/^09\d{9}$/.test(d)) d = `63${d.slice(1)}`;
    else if (/^9\d{9}$/.test(d)) d = `63${d}`;
  }
  return d.length >= MIN_PHONE_DIGITS && d.length <= MAX_PHONE_DIGITS ? d : null;
}

export type ParsedChannel = { ok: true; value: BuyerChannel | null } | { ok: false; error: string };

/**
 * Untrusted admin input → a clean channel. `null` / an empty handle clears it.
 * WhatsApp needs a phone number; Telegram takes a @username, a t.me link or a
 * phone number. Handles are stored canonical: "+639171234567" or "@username".
 */
export function parseBuyerChannelInput(input: unknown): ParsedChannel {
  if (input === null) return { ok: true, value: null };
  const o = (input ?? {}) as Record<string, unknown>;
  if (!isBuyerApp(o.app)) return { ok: false, error: "Choose WhatsApp or Telegram." };
  const raw = typeof o.handle === "string" ? o.handle.trim().slice(0, MAX_HANDLE_INPUT) : "";
  if (!raw) return { ok: true, value: null };

  if (o.app === "whatsapp") {
    const d = internationalDigits(raw);
    return d
      ? { ok: true, value: { app: "whatsapp", handle: `+${d}` } }
      : { ok: false, error: "Enter the buyer's WhatsApp number, e.g. 0917 123 4567 or +63 917 123 4567." };
  }

  const name = raw.replace(/^(https?:\/\/)?(t\.me|telegram\.me)\//i, "").replace(/^@/, "");
  if (TG_USERNAME_RE.test(name)) return { ok: true, value: { app: "telegram", handle: `@${name}` } };
  const d = internationalDigits(name);
  return d
    ? { ok: true, value: { app: "telegram", handle: `+${d}` } }
    : { ok: false, error: "Enter the buyer's Telegram @username or phone number." };
}

/** Lenient read of a STORED channel (already canonical) — anything off is dropped. */
export function normalizeBuyerChannel(input: unknown): BuyerChannel | null {
  if (!input || typeof input !== "object") return null;
  const parsed = parseBuyerChannelInput(input);
  return parsed.ok ? parsed.value : null;
}

/** The customer JSON with `reachedVia` set to `channel`, or removed when null. */
export function withBuyerChannel<T extends object>(customer: T, channel: BuyerChannel | null): T {
  const { reachedVia: _drop, ...rest } = customer as T & { reachedVia?: unknown };
  void _drop;
  return (channel ? { ...rest, reachedVia: channel } : rest) as T;
}

/**
 * The chat to open for this channel. WhatsApp can carry the message pre-typed;
 * Telegram cannot pre-fill a message to a specific person, so the caller copies
 * the text first and the link just opens the chat.
 */
export function buyerChannelLink(channel: BuyerChannel, text = ""): string {
  if (channel.app === "whatsapp") return buildWaLink(channel.handle.replace(/\D/g, ""), text);
  return channel.handle.startsWith("@")
    ? `https://t.me/${channel.handle.slice(1)}`
    : `https://t.me/+${channel.handle.replace(/\D/g, "")}`;
}

/** Does opening the link deliver the text, or must it be pasted? */
export function linkCarriesText(channel: BuyerChannel): boolean {
  return channel.app === "whatsapp";
}

export type ChannelSource = "order" | "customer" | "checkout";
export type ResolvedChannel = { channel: BuyerChannel; source: ChannelSource };

/**
 * The channel to show for `order`:
 *   1. the one saved on this order;
 *   2. else the newest one saved on the SAME customer's other orders (same
 *      email, else phone, else name — customerKeyOf), so a repeat buyer is
 *      already linked;
 *   3. else the WhatsApp number the buyer typed at checkout, as a suggestion.
 * Only (1) is saved; (2) and (3) are pre-fills the admin confirms.
 */
export function resolveBuyerChannel(
  order: Pick<Order, "id" | "customer">,
  others: ReadonlyArray<Pick<Order, "id" | "customer" | "date">> = [],
): ResolvedChannel | null {
  const own = order.customer?.reachedVia;
  if (own) return { channel: own, source: "order" };

  const key = customerKeyOf(order);
  if (key) {
    let best: { channel: BuyerChannel; t: number } | null = null;
    for (const o of others) {
      const ch = o.customer?.reachedVia;
      if (!ch || o.id === order.id || customerKeyOf(o) !== key) continue;
      const t = new Date(o.date).getTime() || 0;
      if (!best || t > best.t) best = { channel: ch, t };
    }
    if (best) return { channel: best.channel, source: "customer" };
  }

  const typed = order.customer?.whatsapp ? internationalDigits(order.customer.whatsapp) : null;
  return typed ? { channel: { app: "whatsapp", handle: `+${typed}` }, source: "checkout" } : null;
}
