import { memo, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CommunityChannel, CommunityConversation, CommunityTopic, MessagePreview, SearchHit } from "@contract";
import { useMinuteClock } from "../hooks/useMinuteClock";
import { channelTarget } from "../lib/inbox";
import { hueFromString } from "../lib/color";
import { formatRelative, pluralize } from "../lib/format";
import { hitText, snippetAround } from "../lib/search";
import { CHAT, GUTTER, INTER, useChatBrand } from "../theme";
import { EmojiAvatar, ParticipantAvatar } from "./Avatar";
import { ChatText } from "./ChatText";
import { CountBadge } from "./ChatKit";
import { HighlightedText } from "./Media";

export const CHAT_ROW_AVATAR = 54;

/** "5m", "Yesterday"… — the only part of a row that ticks with the clock. */
function RelativeTime({ iso, color, fontFamily }: { iso: string | null; color: string; fontFamily: string }) {
  const now = useMinuteClock();
  return (
    <ChatText variant="footnote" style={{ color, fontFamily }}>
      {formatRelative(iso, now)}
    </ChatText>
  );
}

type ChatRowProps = {
  emoji: string;
  imageUrl?: string | null;
  title: string;
  /** Hue seed for the avatar gradient. */
  seed: string;
  broadcast?: boolean;
  /** The Verified Resellers Hub — marked with a verified shield. */
  hub?: boolean;
  square?: boolean;
  pinned?: boolean;
  /** Small brand-coloured prefix, e.g. the topic count. */
  context?: string | null;
  preview: MessagePreview | null;
  fallback: string;
  time: string | null;
  unread: number;
  onPress: () => void;
  onLongPress?: () => void;
  /** Replaces the emoji avatar (a person on a DM row). */
  avatar?: ReactNode;
  /** A DM: only my own messages get an author prefix ("You: …"). */
  oneToOne?: boolean;
};

/** One WhatsApp/Telegram chat-list row. */
export const ChatRow = memo(function ChatRow({ emoji, imageUrl, title, seed, broadcast = false, hub = false, square = false, pinned = false, context, preview, fallback, time, unread, onPress, onLongPress, avatar, oneToOne = false }: ChatRowProps) {
  const b = useChatBrand();
  const author = preview?.author && (!oneToOne || preview.author === "You") ? preview.author : null;
  const line = preview?.text ?? fallback;
  const hasUnread = unread > 0;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}${hub ? ", verified resellers hub" : ""}${hasUnread ? `, ${unread} unread` : ""}. ${author ? `${author}: ` : ""}${line}`}
      accessibilityHint={onLongPress ? "Long press for options" : undefined}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingLeft: GUTTER, backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface })}
    >
      {avatar ?? <EmojiAvatar emoji={emoji} imageUrl={imageUrl} hue={hueFromString(seed)} size={CHAT_ROW_AVATAR} broadcast={broadcast} square={square} />}
      <View style={{ flex: 1, marginLeft: 12, paddingVertical: 10, paddingRight: GUTTER, borderBottomWidth: 1, borderBottomColor: CHAT.hairline, gap: 3, minHeight: 74, justifyContent: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          {broadcast ? <Ionicons name="megaphone" size={14} color={CHAT.inkSoft} /> : null}
          {hub ? <Ionicons name="shield-checkmark" size={14} color={CHAT.inkSoft} /> : null}
          <ChatText numberOfLines={1} style={{ flexShrink: 1, fontFamily: INTER.semibold, fontSize: 16, lineHeight: 21 }}>
            {title}
          </ChatText>
          <View style={{ flex: 1 }} />
          {preview?.author === "You" ? <Ionicons name="checkmark-done" size={15} color={b.brandText} /> : null}
          <RelativeTime iso={preview?.at ?? time} color={hasUnread ? b.brandText : CHAT.inkMuted} fontFamily={hasUnread ? INTER.semibold : INTER.regular} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ChatText numberOfLines={2} style={{ flex: 1, fontSize: 14.5, lineHeight: 19, color: CHAT.inkMuted }}>
            {context ? <ChatText style={{ color: b.brandText, fontFamily: INTER.semibold }}>{`${context} · `}</ChatText> : null}
            {author ? <ChatText style={{ color: CHAT.inkSoft, fontFamily: INTER.medium }}>{`${author}: `}</ChatText> : null}
            {line}
          </ChatText>
          {hasUnread ? (
            <CountBadge count={unread} />
          ) : pinned ? (
            <Ionicons name="pin" size={15} color={CHAT.inkFaint} style={{ transform: [{ rotate: "45deg" }] }} accessibilityLabel="Pinned" />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});

export function openChannel(channel: Pick<CommunityChannel, "id" | "topicCount" | "generalTopicId">): void {
  const t = channelTarget(channel);
  if (t.screen === "topic") router.push({ pathname: "/community/topic/[id]", params: { id: t.id } });
  else router.push({ pathname: "/community/channel/[id]", params: { id: t.id } });
}

/** A channel in the Chats list; `onMenu` must be stable (it is, from useCallback). */
export const ChannelRowItem = memo(function ChannelRowItem({ channel: ch, onMenu }: { channel: CommunityChannel; onMenu: (c: CommunityChannel) => void }) {
  const multi = ch.topicCount > 1;
  return (
    <ChatRow
      emoji={ch.emoji}
      imageUrl={ch.imageUrl}
      seed={ch.id}
      title={ch.name}
      broadcast={ch.postRole === "admins"}
      hub={ch.audience === "hub"}
      // Like the inspiration: which topic the latest message is in, in brand colour.
      context={multi ? (ch.preview && ch.previewTopic ? ch.previewTopic : pluralize(ch.topicCount, "topic")) : null}
      preview={ch.preview}
      fallback={ch.description ?? (multi ? "Tap to join in" : "No messages yet · say hi 👋")}
      time={ch.lastMessageAt}
      unread={ch.unread}
      pinned={ch.postRole === "admins"}
      onPress={() => openChannel(ch)}
      onLongPress={ch.canManage ? () => onMenu(ch) : undefined}
    />
  );
});

export const DirectRowItem = memo(function DirectRowItem({ conversation: c }: { conversation: CommunityConversation }) {
  return (
    <ChatRow
      emoji="✉️"
      seed={c.id}
      title={c.peer.name}
      avatar={<ParticipantAvatar person={c.peer} size={CHAT_ROW_AVATAR} />}
      preview={c.preview}
      fallback="Direct message"
      oneToOne
      time={c.lastMessageAt}
      unread={c.unread}
      onPress={() => router.push({ pathname: "/community/dm/[id]", params: { id: c.id } })}
    />
  );
});

export const TopicRowItem = memo(function TopicRowItem({ topic, onMenu }: { topic: CommunityTopic; onMenu: (t: CommunityTopic) => void }) {
  return (
    <ChatRow
      emoji={topic.emoji}
      imageUrl={topic.imageUrl}
      seed={topic.id}
      square
      title={topic.name}
      pinned={topic.isPinned || topic.isGeneral}
      preview={topic.preview}
      fallback={topic.isGeneral ? "The main room for this channel" : topic.messageCount === 0 ? "No messages yet · start the thread" : pluralize(topic.messageCount, "message")}
      time={topic.lastMessageAt}
      unread={topic.unread}
      onPress={() => router.push({ pathname: "/community/topic/[id]", params: { id: topic.id } })}
      onLongPress={topic.canManage ? () => onMenu(topic) : undefined}
    />
  );
});

/** A message result in the Chats tab search: chat, date and the matching line. */
export const MessageHitRow = memo(function MessageHitRow({ hit, query }: { hit: SearchHit; query: string }) {
  const m = hit.message;
  const text = hitText(m, query);
  const author = m.mine ? "You" : (m.sender?.name.split(/\s+/)[0] ?? null);
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: hit.thread.type === "dm" ? "/community/dm/[id]" : "/community/topic/[id]",
          params: { id: hit.thread.id, q: query, focus: m.id },
        })
      }
      accessibilityRole="button"
      accessibilityLabel={`Message in ${hit.thread.title}${author ? ` from ${author}` : ""}: ${text}`}
      style={({ pressed }) => ({ paddingLeft: GUTTER, backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface })}
    >
      <View style={{ paddingVertical: 10, paddingRight: GUTTER, borderBottomWidth: 1, borderBottomColor: CHAT.hairline, gap: 3, minHeight: 56 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ChatText numberOfLines={1} style={{ flex: 1, fontFamily: INTER.semibold, fontSize: 15, lineHeight: 20 }}>
            {hit.thread.title}
          </ChatText>
          <RelativeTime iso={m.createdAt} color={CHAT.inkMuted} fontFamily={INTER.regular} />
        </View>
        <HighlightedText numberOfLines={2} highlight={query} style={{ fontSize: 14.5, lineHeight: 19, color: CHAT.inkMuted }}>
          {`${author ? `${author}: ` : ""}${snippetAround(text, query)}`}
        </HighlightedText>
      </View>
    </Pressable>
  );
});

/** A grey section label inside a list. */
export function ListSection({ title }: { title: string }) {
  return (
    <View style={{ paddingHorizontal: GUTTER, paddingTop: 14, paddingBottom: 6, backgroundColor: CHAT.surfaceAlt, borderBottomWidth: 1, borderBottomColor: CHAT.hairline }}>
      <ChatText variant="overline" accessibilityRole="header">
        {title}
      </ChatText>
    </View>
  );
}
