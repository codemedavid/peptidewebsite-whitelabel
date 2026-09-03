// Untrusted Telegram JSON → a typed intent.
//
// The webhook receives whatever Telegram posts, and Telegram's update object is
// a wide union that grows over time. This module is the ONE place that shape is
// interpreted, so the route handler never reaches into raw JSON and every
// unrecognised update lands on a safe default instead of falling through.
//
// Pure and total: it never throws, and anything it does not understand becomes
// `ignore` with a reason. Ids are surfaced as STRINGS — Telegram chat ids for
// supergroups and channels exceed 2^53, so carrying them as JS numbers past this
// boundary would silently corrupt them.

export type TelegramIntent =
  | {
      kind: "pair";
      updateId: number;
      code: string;
      chatId: string;
      chatType: string;
      telegramUserId: string;
      label: string;
    }
  | {
      kind: "confirm";
      updateId: number;
      orderId: string;
      chatId: string;
      messageId: number;
      callbackId: string;
      telegramUserId: string;
      label: string;
    }
  | { kind: "unlink"; updateId: number; chatId: string; telegramUserId: string }
  | { kind: "ignore"; updateId: number; reason: string };

import { normalizePairingCode } from "./telegram-pairing";
import { parseConfirmCallback } from "./telegram-message";

type Obj = Record<string, unknown>;

const asObj = (v: unknown): Obj | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;

/** Telegram ids arrive as numbers; carry them as strings from here on. */
function idString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** A human label for the owner's recipient list: @username, then a name, then
 *  the bare id — never empty, so a row is always identifiable in the UI. */
function labelOf(from: Obj | null, chat: Obj | null): string {
  const username = typeof from?.username === "string" ? from.username.trim() : "";
  if (username) return `@${username}`;
  const title = typeof chat?.title === "string" ? chat.title.trim() : "";
  if (title) return title;
  const first = typeof from?.first_name === "string" ? from.first_name.trim() : "";
  if (first) return first;
  return idString(chat?.id) || "Unknown chat";
}

/** Strip Telegram's "@botname" suffix so /start@hpglowbot reads as /start. */
function commandOf(text: string): { name: string; arg: string } {
  const [head = "", ...rest] = text.trim().split(/\s+/);
  const name = head.split("@")[0].toLowerCase();
  return { name, arg: rest.join(" ") };
}

export function interpretTelegramUpdate(update: unknown): TelegramIntent {
  const u = asObj(update);
  const updateId = typeof u?.update_id === "number" ? u.update_id : -1;
  const ignore = (reason: string): TelegramIntent => ({ kind: "ignore", updateId, reason });

  if (!u) return ignore("not an object");

  // ── A button press ────────────────────────────────────────────────────────
  const cbq = asObj(u.callback_query);
  if (cbq) {
    const from = asObj(cbq.from);
    const telegramUserId = idString(from?.id);
    // No identifiable presser means there is nobody to authorize. Drop it rather
    // than carrying an empty id into findConfirmer.
    if (!telegramUserId) return ignore("callback with no from-user");

    const orderId = parseConfirmCallback(cbq.data);
    if (!orderId) return ignore("unknown callback action");

    const message = asObj(cbq.message);
    const chat = asObj(message?.chat);
    return {
      kind: "confirm",
      updateId,
      orderId,
      chatId: idString(chat?.id),
      messageId: typeof message?.message_id === "number" ? message.message_id : 0,
      callbackId: idString(cbq.id),
      telegramUserId,
      label: labelOf(from, chat),
    };
  }

  // ── A chat message ────────────────────────────────────────────────────────
  const message = asObj(u.message) ?? asObj(u.edited_message);
  if (!message) return ignore("no message or callback");

  const text = typeof message.text === "string" ? message.text : "";
  if (!text.startsWith("/")) return ignore("not a command");

  const chat = asObj(message.chat);
  const from = asObj(message.from);
  const chatId = idString(chat?.id);
  const telegramUserId = idString(from?.id);
  if (!chatId) return ignore("command with no chat");

  const { name, arg } = commandOf(text);

  if (name === "/start") {
    const code = normalizePairingCode(arg);
    // A bare /start is the button Telegram shows on every bot. It carries no
    // code, so it can link nothing — the route answers it with instructions.
    if (!code) return ignore("/start with no pairing code");
    if (!telegramUserId) return ignore("/start with no user");
    return {
      kind: "pair",
      updateId,
      code,
      chatId,
      chatType: typeof chat?.type === "string" ? chat.type : "private",
      telegramUserId,
      label: labelOf(from, chat),
    };
  }

  if (name === "/unlink") {
    return { kind: "unlink", updateId, chatId, telegramUserId };
  }

  return ignore(`unhandled command ${name}`);
}
