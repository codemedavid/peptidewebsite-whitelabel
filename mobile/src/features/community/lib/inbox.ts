// The Chats list: Telegram-style folders and name search over the inbox.
import type { CommunityChannel, CommunityConversation, InboxResponse } from "@contract";

export type Folder = "all" | "unread" | "direct" | "groups" | "announcements";

export type ChatListRow =
  | { kind: "channel"; channel: CommunityChannel; at: string }
  | { kind: "direct"; conversation: CommunityConversation; at: string };

const EPOCH = new Date(0).toISOString();
const at = (iso: string | null) => iso ?? EPOCH;
const byRecent = (a: ChatListRow, b: ChatListRow) => Date.parse(b.at) - Date.parse(a.at);

function channelInFolder(c: CommunityChannel, folder: Folder): boolean {
  if (folder === "direct") return false;
  if (folder === "unread") return c.unread > 0;
  if (folder === "groups") return c.postRole === "everyone";
  if (folder === "announcements") return c.postRole === "admins";
  return true;
}

function directInFolder(d: CommunityConversation, folder: Folder): boolean {
  // A DM nobody has written in yet stays out of the list, like WhatsApp.
  if (d.messageCount === 0) return false;
  if (folder === "unread") return d.unread > 0;
  return folder === "all" || folder === "direct";
}

/** Channels and DMs for one folder, most recent first. */
export function buildChatRows(inbox: Pick<InboxResponse, "channels" | "conversations">, folder: Folder): ChatListRow[] {
  const channels: ChatListRow[] = inbox.channels
    .filter((c) => channelInFolder(c, folder))
    .map((channel) => ({ kind: "channel", channel, at: at(channel.lastMessageAt) }));
  const directs: ChatListRow[] = inbox.conversations
    .filter((d) => directInFolder(d, folder))
    .map((conversation) => ({ kind: "direct", conversation, at: at(conversation.lastMessageAt) }));
  return [...channels, ...directs].sort(byRecent);
}

/** Chats whose name contains the query (case-insensitive). */
export function matchChatsByName(inbox: Pick<InboxResponse, "channels" | "conversations">, query: string): ChatListRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const channels: ChatListRow[] = inbox.channels
    .filter((c) => c.name.toLowerCase().includes(q))
    .map((channel) => ({ kind: "channel", channel, at: at(channel.lastMessageAt) }));
  const directs: ChatListRow[] = inbox.conversations
    .filter((d) => d.peer.name.toLowerCase().includes(q))
    .map((conversation) => ({ kind: "direct", conversation, at: at(conversation.lastMessageAt) }));
  return [...channels, ...directs].sort(byRecent);
}

export function unreadIn(inbox: Pick<InboxResponse, "channels" | "conversations"> | undefined): number {
  if (!inbox) return 0;
  return (
    inbox.channels.filter((c) => c.unread > 0).length + inbox.conversations.filter((d) => d.unread > 0).length
  );
}

/** A channel with only its General topic opens that thread directly. */
export function channelTarget(channel: Pick<CommunityChannel, "id" | "topicCount" | "generalTopicId">):
  | { screen: "topic"; id: string }
  | { screen: "channel"; id: string } {
  return channel.topicCount <= 1 ? { screen: "topic", id: channel.generalTopicId } : { screen: "channel", id: channel.id };
}
