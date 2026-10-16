import { memo } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CommunityMessage, Participant } from "@contract";
import { useCommunityTags } from "../hooks/useCommunityData";
import { senderColor } from "../lib/color";
import { formatClock } from "../lib/format";
import type { LocalMessage } from "../lib/messages";
import { CHAT, INTER, type ChatBrand } from "../theme";
import { ParticipantAvatar } from "./Avatar";
import { ProductChatCard, ProtocolChatCard } from "./Cards";
import { ChatText } from "./ChatText";
import { ChatVideo } from "./ChatVideo";
import { DropCard } from "./Drops";
import { GroupBuyChatCard } from "./GroupBuyChatCard";
import { OrderUpdateCard } from "./OrderUpdateCard";
import { ChatImage, FileCard, HighlightedText } from "./Media";

type Props = {
  message: LocalMessage;
  brand: ChatBrand;
  /** No older message from the same sender directly above → name, round top. */
  startsGroup: boolean;
  /** No newer message from the same sender directly below → avatar and tail. */
  endsGroup: boolean;
  onLongPress?: (m: CommunityMessage) => void;
  onEndDrop?: (dropId: string) => void;
  /** The tapped message rides along so the profile card can offer "Reply". */
  onPressSender?: (p: Participant, m: CommunityMessage) => void;
  /** One-to-one chats already say who is talking in the header. */
  hideName?: boolean;
  highlight?: string;
  focused?: boolean;
};

const R = 18;
const JOIN = 5;
const AVATAR = 32;
const TEXT = { fontSize: 15.5, lineHeight: 21 } as const;

function SystemLine({ text, icon }: { text: string; icon?: boolean }) {
  return (
    <View style={{ alignSelf: "center", backgroundColor: CHAT.pill, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginVertical: 6 }}>
      <ChatText variant="footnote" color="#fff">
        {icon ? "⚡ " : ""}
        {text}
      </ChatText>
    </View>
  );
}

function ReplyQuote({ reply, mine, brand }: { reply: NonNullable<CommunityMessage["replyTo"]>; mine: boolean; brand: ChatBrand }) {
  // The quoted person's name colour, same as their name above their bubbles.
  const accent = mine ? brand.onBubbleMine : reply.senderIsTeam || reply.senderHue === null ? brand.brandText : senderColor(reply.senderHue);
  return (
    <View
      accessible
      accessibilityLabel={`Replying to ${reply.senderName}: ${reply.text}`}
      style={{ flexDirection: "row", gap: 8, backgroundColor: mine ? "rgba(255,255,255,0.16)" : brand.brandTint, borderRadius: 8, paddingVertical: 5, paddingRight: 8, marginBottom: 5, overflow: "hidden" }}
    >
      <View style={{ width: 3, backgroundColor: accent }} />
      <View style={{ flexShrink: 1 }}>
        <ChatText numberOfLines={1} style={{ color: accent, fontFamily: INTER.semibold, fontSize: 12.5, lineHeight: 16 }}>
          {reply.senderName}
        </ChatText>
        <ChatText numberOfLines={1} style={{ color: mine ? brand.metaMine : CHAT.inkSoft, fontSize: 13, lineHeight: 17 }}>
          {reply.text || "Earlier message"}
        </ChatText>
      </View>
    </View>
  );
}

function MessageBubbleImpl({ message, brand, startsGroup, endsGroup, onLongPress, onEndDrop, onPressSender, hideName = false, highlight, focused = false }: Props) {
  const tags = useCommunityTags();
  const mine = message.mine;
  const sender = message.sender;
  const name = sender?.name ?? "Member";

  if (message.kind === "system") return <SystemLine text={message.body ?? ""} />;
  if (message.kind === "order") return <OrderUpdateCard message={message} brand={brand} onLongPress={message.canDelete ? onLongPress : undefined} />;
  if (message.kind === "drop" && message.drop) {
    return (
      <View style={{ alignItems: "center", marginVertical: 12, gap: 8 }}>
        <SystemLine icon text={`Product drop · ${formatClock(message.createdAt)}`} />
        <DropCard drop={message.drop} onEnd={onEndDrop ? () => onEndDrop(message.drop!.id) : undefined} />
      </View>
    );
  }

  const deleted = !!message.deletedAt;
  // The safety bot hid it: the sender is told why; everyone else just sees it was removed.
  const moderated = deleted && message.moderated === true;
  const deletedLabel = !moderated ? "Message deleted" : mine ? "Removed by the safety bot — inviting members to other groups isn't allowed" : "Removed by the safety bot";
  const pending = !!message.pending;
  const isProduct = message.kind === "product" && !deleted;
  const isProtocol = message.kind === "protocol" && !deleted;
  const isGroupBuy = message.kind === "groupbuy" && !deleted;
  const imageUri = message.localUri && message.kind === "image" ? message.localUri : message.image?.url;
  const isImage = message.kind === "image" && !!imageUri && !deleted;
  const isVideo = message.kind === "video" && !!message.video && !deleted;
  const isFile = message.kind === "file" && !!message.file && !deleted;
  const isCard = isProduct || isProtocol || isGroupBuy || isImage || isVideo || isFile;
  const fg = mine ? brand.onBubbleMine : CHAT.ink;
  const meta = mine ? brand.metaMine : CHAT.inkMuted;
  const link = mine ? brand.onBubbleMine : CHAT.info;
  const longPress = deleted || pending || !onLongPress ? undefined : () => onLongPress(message);
  const openSender = sender && !mine && onPressSender ? () => onPressSender(sender, message) : undefined;
  const label = !mine && startsGroup && !hideName ? (message.authorName ? `${name} · ${message.authorName}` : name) : null;

  const corners = mine
    ? { borderTopLeftRadius: R, borderBottomLeftRadius: R, borderTopRightRadius: startsGroup ? R : JOIN, borderBottomRightRadius: endsGroup ? 4 : JOIN }
    : { borderTopRightRadius: R, borderBottomRightRadius: R, borderTopLeftRadius: startsGroup ? R : JOIN, borderBottomLeftRadius: endsGroup ? 4 : JOIN };

  const stamp = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-end", marginLeft: "auto", paddingLeft: 8, marginTop: isCard ? 0 : 4 }}>
      {message.editedAt && !deleted ? <ChatText style={{ fontSize: 11, lineHeight: 13, color: meta, fontStyle: "italic" }}>edited</ChatText> : null}
      <ChatText style={{ fontSize: 11, lineHeight: 13, color: meta, fontFamily: INTER.medium }}>{formatClock(message.createdAt)}</ChatText>
      {mine ? (
        <Ionicons
          name={pending ? "time-outline" : "checkmark-done"}
          size={14}
          color={meta}
          accessibilityLabel={pending ? "Sending" : "Sent"}
        />
      ) : null}
    </View>
  );

  const a11y = [mine ? "You" : name, deleted ? deletedLabel : (message.body ?? ""), pending ? "sending" : formatClock(message.createdAt)]
    .filter(Boolean)
    .join(", ");

  return (
    <View
      style={{
        flexDirection: mine ? "row-reverse" : "row",
        alignItems: "flex-end",
        gap: 6,
        marginTop: startsGroup ? 8 : 2,
        paddingHorizontal: 8,
        backgroundColor: focused ? CHAT.searchHitWash : undefined,
      }}
    >
      {!mine ? (
        <View style={{ width: AVATAR }}>
          {endsGroup && sender ? (
            <Pressable onPress={openSender} disabled={!openSender} hitSlop={6} accessibilityRole="button" accessibilityLabel={`View ${name}'s profile`}>
              <ParticipantAvatar person={sender} size={AVATAR} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Pressable
        onLongPress={longPress}
        delayLongPress={280}
        accessibilityLabel={isCard ? undefined : a11y}
        accessibilityHint={longPress ? "Long press for actions" : undefined}
        accessibilityActions={longPress ? [{ name: "longpress", label: "Message actions" }] : undefined}
        onAccessibilityAction={longPress ? () => longPress() : undefined}
        style={({ pressed }) => [
          {
            maxWidth: "80%",
            backgroundColor: deleted ? (mine ? brand.deletedMine : "rgba(255,255,255,0.75)") : mine ? brand.bubbleMine : CHAT.bubbleTheirs,
            paddingHorizontal: isCard ? 4 : 11,
            paddingTop: isCard ? 4 : 7,
            paddingBottom: 6,
            opacity: pending ? 0.8 : pressed ? 0.85 : 1,
            shadowColor: "#2A1420",
            shadowOpacity: mine ? 0 : 0.06,
            shadowRadius: 2,
            shadowOffset: { width: 0, height: 1 },
            elevation: mine ? 0 : 1,
          },
          corners,
        ]}
      >
        {label ? (
          <Pressable onPress={openSender} disabled={!openSender} accessibilityRole="button" accessibilityLabel={`View ${name}'s profile`} style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
            <ChatText
              numberOfLines={1}
              style={{
                color: sender?.isTeam ? brand.brandText : senderColor(sender?.avatarHue ?? 340),
                fontFamily: INTER.semibold,
                fontSize: 13,
                lineHeight: 17,
                marginBottom: 2,
                paddingHorizontal: isCard ? 7 : 0,
                paddingTop: isCard ? 3 : 0,
              }}
            >
              {sender?.isTeam ? `🛡 ${label}` : [label, sender?.isAdmin ? tags.admin.label : null, sender?.isVerifiedReseller ? `✓ ${tags.reseller.label}` : null].filter(Boolean).join(" · ")}
            </ChatText>
          </Pressable>
        ) : null}

        {message.replyTo && !deleted ? <ReplyQuote reply={message.replyTo} mine={mine} brand={brand} /> : null}

        {deleted ? (
          <View style={{ flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap" }}>
            <Ionicons name={moderated ? "shield-outline" : "ban-outline"} size={14} color={meta} style={{ marginRight: 4, marginBottom: 2 }} />
            <ChatText style={{ ...TEXT, fontStyle: "italic", color: meta }}>{deletedLabel}</ChatText>
            {stamp}
          </View>
        ) : isCard ? (
          <View style={{ gap: 6 }}>
            {isProduct ? (
              <ProductChatCard product={message.product} />
            ) : isProtocol ? (
              <ProtocolChatCard protocol={message.protocol} />
            ) : isGroupBuy ? (
              <GroupBuyChatCard round={message.groupBuy} onLongPress={longPress} />
            ) : isVideo ? (
              <ChatVideo video={message.video!} radius={R - 4} onLongPress={longPress} />
            ) : isFile ? (
              <FileCard
                name={message.file!.name}
                url={message.file!.url || null}
                size={message.file!.size}
                mime={message.file!.mime}
                mine={mine}
                onMineColor={brand.onBubbleMine}
                pending={pending}
                highlight={highlight}
                onLongPress={longPress}
              />
            ) : (
              <ChatImage uri={imageUri!} width={message.image?.width ?? null} height={message.image?.height ?? null} radius={R - 4} uploading={pending} onLongPress={longPress} />
            )}
            <View style={{ flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 7 }}>
              {message.body ? (
                <HighlightedText highlight={highlight} linkColor={link} style={{ ...TEXT, color: fg, flexShrink: 1 }}>
                  {message.body}
                </HighlightedText>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              {stamp}
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end" }}>
            <HighlightedText highlight={highlight} linkColor={link} style={{ ...TEXT, color: fg, flexShrink: 1 }}>
              {message.body ?? ""}
            </HighlightedText>
            {stamp}
          </View>
        )}
      </Pressable>
    </View>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);
