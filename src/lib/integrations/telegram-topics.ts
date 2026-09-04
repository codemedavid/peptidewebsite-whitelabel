// Routing each order status to its own forum topic.
//
// A Telegram supergroup with Topics enabled gives the store a column per order
// status: New, Confirmed, Shipped… Posting into one is just `message_thread_id`
// on sendMessage — but nowhere in the Telegram UI can a person read that number.
// What they CAN do is copy a link to the topic. So the operator pastes links and
// this module turns them into thread ids.
//
// Everything here refuses rather than guesses. A thread id that is wrong by one
// posts a store's orders into the wrong column silently, so an unreadable link
// must become "no topic" (fall back to the chat itself) and never 0 — which
// Telegram would happily accept as "the General topic".

import { ORDER_STATUSES } from "@/lib/storefront/order-status";
import type { OrderStatus } from "@/storefront/types";

/** status → forum thread id. A status with no entry posts to the chat itself. */
export type StatusTopics = Partial<Record<OrderStatus, number>>;

/**
 * The forum thread id inside a pasted topic link, or null when unreadable.
 *
 * Accepted shapes, all seen in the wild when someone taps "Copy link" on a topic:
 *   https://t.me/c/2345678901/12        private supergroup topic
 *   https://t.me/c/2345678901/12/3456   a MESSAGE inside that topic
 *   https://t.me/novalabs/7             public group topic
 *   12                                  the bare id, for anyone who knows it
 *
 * The message case is the subtle one: for a forum, the topic id is the FIRST
 * numeric segment after the chat, and the message id trails it. Taking the last
 * number would route every order to whatever message happened to be copied.
 */
export function parseTopicLink(input: unknown): number | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  // A bare id.
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return n > 0 ? n : null;
  }

  const m = /^https?:\/\/(?:www\.)?t\.me\/(.+)$/i.exec(raw.split("?")[0]);
  if (!m) return null;

  const parts = m[1].split("/").filter(Boolean);
  // t.me/c/<chat>/<topic>[/<message>]  → the topic is the 2nd segment after "c"
  // t.me/<name>/<topic>[/<message>]    → the topic is the 1st after the name
  const numeric = parts[0] === "c" ? parts.slice(2) : parts.slice(1);
  const first = numeric[0];
  if (!first || !/^\d+$/.test(first)) return null;
  const n = Number(first);
  // 0 is "General", which is where a store's orders end up when a link failed to
  // parse — exactly the silent mis-routing this function exists to prevent.
  return n > 0 ? n : null;
}

/** Coerce the operator's untrusted per-status input into a clean topic map. */
export function normalizeStatusTopics(input: unknown): StatusTopics {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const src = input as Record<string, unknown>;
  const out: StatusTopics = {};
  for (const status of ORDER_STATUSES) {
    const thread = parseTopicLink(src[status]);
    if (thread !== null) out[status] = thread;
  }
  return out;
}

/**
 * The thread an order of this status belongs in, or undefined to post to the
 * chat itself. Undefined rather than a "default topic" on purpose: falling back
 * to another status' topic would file orders under a status they don't have.
 */
export function resolveTopicFor(
  status: string,
  topics: StatusTopics | null | undefined,
): number | undefined {
  if (!topics) return undefined;
  const thread = (topics as Record<string, unknown>)[status];
  return typeof thread === "number" && thread > 0 ? thread : undefined;
}
