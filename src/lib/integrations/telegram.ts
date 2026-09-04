// A minimal Telegram Bot API client.
//
// Deliberately small and total: every call returns a discriminated result and
// NEVER throws, because both callers are places where an exception would do real
// damage — checkout (an alert must not fail a paid order) and a webhook (an
// exception becomes a non-200, which makes Telegram redeliver forever).
//
// Every request is time-boxed. Telegram is a third party on the far side of the
// internet, and a hung socket inside next/server after() would hold a function
// instance open long past the response.

const API = "https://api.telegram.org";
const TIMEOUT_MS = 5_000;

export type BotResult<T> = { ok: true; result: T } | { ok: false; error: string };

async function call<T>(token: string, method: string, body: unknown): Promise<BotResult<T>> {
  if (!token) return { ok: false, error: "No bot token configured." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; result?: T; description?: string }
      | null;
    if (!json?.ok) {
      // Telegram's own description is the useful part ("chat not found", "bot was
      // blocked by the user") — surface it so the admin panel can say why.
      return { ok: false, error: json?.description || `Telegram ${method} failed (${res.status}).` };
    }
    return { ok: true, result: json.result as T };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("abort") ? "Telegram timed out." : msg };
  } finally {
    clearTimeout(timer);
  }
}

export interface BotIdentity {
  id: number;
  username?: string;
  first_name?: string;
}

/** Who this token belongs to — the store admin's "Test connection". */
export function getMe(token: string): Promise<BotResult<BotIdentity>> {
  return call<BotIdentity>(token, "getMe", {});
}

export interface SentMessage {
  message_id: number;
}

export function sendMessage(
  token: string,
  chatId: string,
  message: { text: string; parse_mode: "HTML"; reply_markup?: unknown },
  /** Forum thread to post into. Omitted → the chat's General area. */
  messageThreadId?: number,
): Promise<BotResult<SentMessage>> {
  return call<SentMessage>(token, "sendMessage", {
    chat_id: chatId,
    ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
    text: message.text,
    parse_mode: message.parse_mode,
    // Order alerts are self-contained; a link preview would just add noise.
    disable_web_page_preview: true,
    ...(message.reply_markup ? { reply_markup: message.reply_markup } : {}),
  });
}

/** Replace a sent alert's text (used to retire the Confirm button in place). */
export function editMessageText(
  token: string,
  chatId: string,
  messageId: number,
  text: string,
): Promise<BotResult<unknown>> {
  return call(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    // No reply_markup → the inline keyboard is removed along with the edit.
  });
}

/**
 * Acknowledge a button press. Telegram shows a spinner on the button until this
 * lands, so an unanswered callback looks like a hung app — it is called on the
 * refusal path too, not just on success.
 */
export function answerCallbackQuery(
  token: string,
  callbackId: string,
  text: string,
  alert = false,
): Promise<BotResult<unknown>> {
  return call(token, "answerCallbackQuery", {
    callback_query_id: callbackId,
    text: text.slice(0, 200),
    show_alert: alert,
  });
}

/**
 * Point the bot at this deployment's webhook. `secretToken` is echoed back by
 * Telegram in X-Telegram-Bot-Api-Secret-Token on every update, which is the
 * second half of the route's authenticity check (the first is the secret path).
 */
export function setWebhook(
  token: string,
  url: string,
  secretToken: string,
): Promise<BotResult<unknown>> {
  return call(token, "setWebhook", {
    url,
    secret_token: secretToken,
    // We only act on these two; asking for less means fewer wasted invocations.
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

export function deleteWebhook(token: string): Promise<BotResult<unknown>> {
  return call(token, "deleteWebhook", { drop_pending_updates: true });
}
