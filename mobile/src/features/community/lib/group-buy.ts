// Where a member can drop the live group-buy card — pure (npm run test:mobile-group-buy).
import type { InboxResponse, ThreadType } from "@contract";

export type ShareTarget = {
  type: ThreadType;
  /** A topic id (a channel's General) or a DM conversation id. */
  id: string;
  title: string;
  emoji: string | null;
  /** DMs: the other person, for the avatar. */
  peerKey: string | null;
  lastMessageAt: string | null;
};

const recency = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Channels this member can post in (into their General topic) and their DMs,
 * most recently active first. Chats with people they blocked are left out.
 */
export function shareTargets(inbox: InboxResponse | undefined, blocked: ReadonlySet<string>): ShareTarget[] {
  if (!inbox) return [];
  const channels: ShareTarget[] = inbox.channels
    .filter((c) => c.canPost)
    .map((c) => ({ type: "topic", id: c.generalTopicId, title: c.name, emoji: c.emoji, peerKey: null, lastMessageAt: c.lastMessageAt }));
  const dms: ShareTarget[] = inbox.conversations
    .filter((d) => d.peer.isTeam || !blocked.has(d.peer.key))
    .map((d) => ({ type: "dm", id: d.id, title: d.peer.name, emoji: null, peerKey: d.peer.key, lastMessageAt: d.lastMessageAt }));
  return [...dms, ...channels].sort((a, b) => recency(b.lastMessageAt) - recency(a.lastMessageAt));
}
