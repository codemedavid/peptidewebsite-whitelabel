// Channel (topic) message pushes and per-member channel mutes — the pure part.
// Pure: no DB, no Next — covered by npm run test:community-core.
//
// Like DMs, the lock screen names the channel and the sender but never shows
// the message, and the payload is only a pointer ({type, threadId}).

import { customerKey } from "./keys";
import { firstName } from "./text";

export type TopicPushInput = {
  storeName: string;
  channel: { name: string; emoji: string };
  topic: { id: string; name: string; isGeneral: boolean };
  senderName: string;
  /** The store team posts as the store. */
  fromStore: boolean;
};

export type TopicPush = { title: string; body: string; data: { type: "topic"; threadId: string } };

export function buildTopicPush(i: TopicPushInput): TopicPush {
  const from = i.fromStore ? i.storeName.trim() || "The store" : firstName(i.senderName);
  return {
    title: `${i.channel.emoji} ${i.channel.name}`.trim(),
    body: i.topic.isGeneral ? `New message from ${from}` : `${from} posted in ${i.topic.name}`,
    data: { type: "topic", threadId: i.topic.id },
  };
}

/** The customers to push: each once, never the sender, never someone who muted the channel. */
export function topicPushAudience(customerIds: string[], opts: { senderKey: string; mutedKeys: ReadonlySet<string> }): string[] {
  const out = new Set<string>();
  for (const id of customerIds) {
    const key = customerKey(id);
    if (key !== opts.senderKey && !opts.mutedKeys.has(key)) out.add(id);
  }
  return [...out];
}

/**
 * The key a channel mute is stored under. Members mute as themselves (`c:<id>`);
 * the store team all post as `store`, so each team member mutes PERSONALLY
 * (`team:owner` / `team:s:<staffId>`) — one staff member silencing a busy
 * channel must not silence it for the owner. Null = this reader can't mute.
 */
export function channelMuteKey(actor: { key: string; isTeam?: boolean; authorKey: string | null; customerId?: string | null; preview?: unknown }): string | null {
  if (actor.isTeam) return actor.authorKey ? `team:${actor.authorKey}` : null;
  if (!actor.customerId || actor.preview) return null;
  return actor.key;
}

/** The team members to push (by author key): never the one who wrote it, never one who muted the channel. */
export function teamPushAudience(authorKeys: string[], opts: { senderAuthorKey: string | null; mutedKeys: ReadonlySet<string> }): string[] {
  const out = new Set<string>();
  for (const k of authorKeys) {
    if (k !== opts.senderAuthorKey && !opts.mutedKeys.has(`team:${k}`)) out.add(k);
  }
  return [...out];
}

/** PUT /community/channels/:id/mute { muted } — true / false, or null when malformed. */
export function parseMuteRequest(body: unknown): boolean | null {
  if (!body || typeof body !== "object") return null;
  const muted = (body as { muted?: unknown }).muted;
  return typeof muted === "boolean" ? muted : null;
}
