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

/** PUT /community/channels/:id/mute { muted } — true / false, or null when malformed. */
export function parseMuteRequest(body: unknown): boolean | null {
  if (!body || typeof body !== "object") return null;
  const muted = (body as { muted?: unknown }).muted;
  return typeof muted === "boolean" ? muted : null;
}
