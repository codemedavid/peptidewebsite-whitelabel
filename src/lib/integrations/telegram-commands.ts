// Text the store's admin types at the bot.
//
// Two routes to the same place, because Telegram gives no good single answer for
// "collect one value from a human":
//
//   /track HPG-1042 JT9876543210      explicit, works anywhere, easy to retry
//   (reply to the bot's prompt)       fewer keystrokes after tapping a button
//
// Both are STATELESS. The reply route reads the order number back out of the
// prompt the reply is attached to, so nothing has to survive between two webhook
// invocations — which matters because a webhook is not a session, and any
// conversation state would have to live somewhere and expire correctly.

/** What the admin supplied: which order, and the number to put on it. */
export interface TrackInput {
  orderNumber: string;
  tracking: string;
}

/** Order numbers are short codes like HPG-1042; match generously, cap hard. */
const ORDER_NUMBER_MAX = 64;
const TRACKING_MAX = 120;

/** `/track <orderNumber> <tracking…>` — the tracking number may contain spaces. */
export function parseTrackCommand(text: unknown): TrackInput | null {
  if (typeof text !== "string") return null;
  const parts = text.trim().split(/\s+/);
  const head = (parts[0] ?? "").split("@")[0].toLowerCase();
  if (head !== "/track") return null;

  const orderNumber = (parts[1] ?? "").trim().toUpperCase().slice(0, ORDER_NUMBER_MAX);
  // Couriers print numbers with spaces in them; keep the rest of the line whole
  // rather than silently truncating at the first gap.
  const tracking = parts.slice(2).join(" ").trim().slice(0, TRACKING_MAX);
  if (!orderNumber || !tracking) return null;
  return { orderNumber, tracking };
}

/** The message the bot sends when the admin taps "Add tracking number". */
export function buildTrackPrompt(orderNumber: string): string {
  return `Reply to this message with the tracking number for order ${orderNumber}.`;
}

/**
 * Correlate a reply against the prompt it answers. Returns null unless the
 * replied-to text really is one of our prompts — a reply to anything else is
 * ordinary chatter and must not be mistaken for a tracking number.
 */
export function parseTrackReply(promptText: unknown, replyText: unknown): TrackInput | null {
  if (typeof promptText !== "string" || typeof replyText !== "string") return null;
  const m = /tracking number for order ([A-Za-z0-9-]{1,64})\.?$/.exec(promptText.trim());
  if (!m) return null;
  const tracking = replyText.trim().slice(0, TRACKING_MAX);
  if (!tracking) return null;
  return { orderNumber: m[1].toUpperCase(), tracking };
}
