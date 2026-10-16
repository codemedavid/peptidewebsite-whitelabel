import { forwardRef, useState, type ReactNode } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardState } from "react-native-keyboard-controller";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CommunityMessage } from "@contract";
import { attachmentLabel, type Attachment } from "../lib/attachments";
import { fileTypeLabel, formatBytes } from "../lib/documents";
import { useReducedMotion } from "../hooks/useMotion";
import { CHAT, INTER, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";
import type { IconName } from "./ChatKit";
import { FileBadge, ProductImage } from "./Media";

type Props = {
  disabled?: boolean;
  disabledReason?: string;
  attachment: Attachment | null;
  onClearAttachment: () => void;
  replyTo: CommunityMessage | null;
  onClearReply: () => void;
  /** A sent message being edited: the field holds its text and send saves the change. */
  editing?: CommunityMessage | null;
  onCancelEdit?: () => void;
  onAttach: () => void;
  /** The draft, owned by the screen so a failed send or edit can put it back. */
  text: string;
  onChangeText: (text: string) => void;
  /**
   * Hands the draft off. A new message resolves as soon as it is queued (the
   * optimistic bubble shows), so the field unlocks at once; an edit resolves
   * when saved.
   */
  onSend: (body: string) => Promise<void>;
  /** Store team: opens the saved replies. The button shows only when this is set. */
  onOpenSaved?: () => void;
  /** Shown above the field, e.g. saved-reply matches while typing "/". */
  suggestions?: ReactNode;
  /** Something besides the text will go out (queued saved-reply photos), so send works with an empty field. */
  hasExtra?: boolean;
  /** The empty field's prompt, e.g. "What are you looking for?" in a resellers hub. */
  placeholder?: string;
};

const MAX_LENGTH = 2000;

function ContextBar({ icon, thumb, title, body, onClear, clearLabel = "Remove attachment" }: { icon: IconName; thumb?: ReactNode; title: string; body: string; onClear: () => void; clearLabel?: string }) {
  const b = useChatBrand();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 14, paddingRight: 4, paddingTop: 8 }}>
      <Ionicons name={icon} size={20} color={b.brandText} />
      <View style={{ width: 2, alignSelf: "stretch", backgroundColor: b.brand, borderRadius: 1 }} />
      {thumb}
      <View style={{ flex: 1 }}>
        <ChatText variant="subhead" color={b.brandText} numberOfLines={1} style={{ fontFamily: INTER.semibold }}>
          {title}
        </ChatText>
        <ChatText variant="footnote" numberOfLines={1}>
          {body}
        </ChatText>
      </View>
      <Pressable onPress={onClear} hitSlop={4} accessibilityRole="button" accessibilityLabel={clearLabel} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="close" size={20} color={CHAT.inkMuted} />
      </Pressable>
    </View>
  );
}

/** What is about to be sent, above the field. */
function AttachmentBar({ attachment, onClear }: { attachment: Attachment; onClear: () => void }) {
  switch (attachment.type) {
    case "product": {
      const p = attachment.product;
      return (
        <ContextBar
          icon="pricetag"
          thumb={<ProductImage uri={p.imageUrl} name={p.name} width={36} height={36} radius={6} />}
          title={p.name}
          body={`${p.variationName ? `${p.variationName} · ` : ""}${p.priceLabel} · sends as a listing`}
          onClear={onClear}
        />
      );
    }
    case "protocol":
      return <ContextBar icon="clipboard" title={attachment.protocol.name} body="Sends as a protocol" onClear={onClear} />;
    case "groupbuy":
      return <ContextBar icon="people" title={attachment.groupBuy.name} body="Live group buy · sends as a card anyone can join from" onClear={onClear} />;
    case "image":
      return (
        <ContextBar
          icon="image"
          thumb={<Image source={{ uri: attachment.uri }} contentFit="cover" style={{ width: 36, height: 36, borderRadius: 6 }} accessibilityLabel="Photo to send" />}
          title="Photo"
          body="Add a caption or tap send"
          onClear={onClear}
        />
      );
    case "file": {
      const type = fileTypeLabel(attachment.mimeType, attachment.name);
      return (
        <ContextBar
          icon="document-text"
          thumb={<FileBadge type={type} size={36} />}
          title={attachment.name}
          body={[type, formatBytes(attachment.size), "sends as a document"].filter(Boolean).join(" · ")}
          onClear={onClear}
        />
      );
    }
  }
}

/** Telegram-style composer: attach, a growing field, send when there's something to send. */
export const Composer = forwardRef<TextInput, Props>(function Composer(
  { disabled, disabledReason, attachment, onClearAttachment, replyTo, onClearReply, editing, onCancelEdit, onAttach, text, onChangeText, onSend, onOpenSaved, suggestions, hasExtra = false, placeholder = "Message" },
  ref,
) {
  const insets = useSafeAreaInsets();
  const b = useChatBrand();
  const reduced = useReducedMotion();
  const [sending, setSending] = useState(false);
  // The home-indicator inset only matters while the keyboard is down.
  const keyboardOpen = useKeyboardState((k) => k.isVisible);
  const bottom = (keyboardOpen ? 0 : insets.bottom) + 6;

  const isEditing = !!editing;
  const hasContent = text.trim().length > 0 || !!attachment || (isEditing ? editing.kind !== "text" : hasExtra);
  const canSend = !disabled && !sending && hasContent;

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    try {
      await onSend(text);
    } finally {
      setSending(false);
    }
  };

  if (disabled) {
    return (
      <View
        accessibilityRole="text"
        style={{ paddingBottom: bottom + 4, paddingTop: 12, paddingHorizontal: 16, backgroundColor: CHAT.surface, borderTopWidth: 1, borderTopColor: CHAT.hairline, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}
      >
        <Ionicons name="megaphone-outline" size={16} color={CHAT.inkMuted} />
        <ChatText variant="subhead" color={CHAT.inkMuted}>
          {disabledReason ?? "Only the store team posts here."}
        </ChatText>
      </View>
    );
  }

  return (
    <View style={{ backgroundColor: CHAT.surface, borderTopWidth: 1, borderTopColor: CHAT.hairline, paddingBottom: bottom }}>
      {editing ? (
        <ContextBar icon="pencil" title="Edit message" body={editing.body ?? attachmentLabel(editing.kind) ?? ""} onClear={() => onCancelEdit?.()} clearLabel="Cancel edit" />
      ) : replyTo ? (
        <ContextBar
          icon="arrow-undo"
          title={`Reply to ${replyTo.mine ? "yourself" : (replyTo.sender?.name ?? "message")}`}
          body={attachmentLabel(replyTo.kind) ?? replyTo.body ?? ""}
          onClear={onClearReply}
          clearLabel="Cancel reply"
        />
      ) : null}
      {attachment && !editing ? <AttachmentBar attachment={attachment} onClear={onClearAttachment} /> : null}
      {suggestions}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, paddingHorizontal: 4, paddingTop: 6 }}>
        <Pressable
          onPress={onAttach}
          disabled={isEditing}
          accessibilityRole="button"
          accessibilityLabel="Attach a photo, document or listing"
          accessibilityState={{ disabled: isEditing }}
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? b.brandSoft : "transparent" })}
        >
          <Ionicons name="add-circle-outline" size={27} color={isEditing ? CHAT.inkFaint : CHAT.inkMuted} />
        </Pressable>
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "flex-end",
            backgroundColor: CHAT.surfaceAlt,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: CHAT.hairline,
            paddingLeft: 14,
            paddingRight: onOpenSaved ? 2 : 14,
            minHeight: 44,
            maxHeight: 132,
          }}
        >
          <TextInput
            ref={ref}
            value={text}
            onChangeText={onChangeText}
            maxLength={MAX_LENGTH}
            placeholder={attachment ? "Add a caption…" : placeholder}
            placeholderTextColor={CHAT.inkFaint}
            multiline
            accessibilityLabel={attachment ? "Caption" : "Message"}
            style={{ flex: 1, alignSelf: "center", fontFamily: INTER.regular, fontSize: 16, color: CHAT.ink, paddingTop: 10, paddingBottom: 10, lineHeight: 21 }}
          />
          {onOpenSaved ? (
            <Pressable
              onPress={onOpenSaved}
              accessibilityRole="button"
              accessibilityLabel="Saved replies"
              accessibilityHint="Quick answers your store team saved"
              hitSlop={2}
              style={({ pressed }) => ({ width: 40, height: 42, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? b.brandSoft : "transparent" })}
            >
              <Ionicons name="chatbox-ellipses-outline" size={22} color={CHAT.inkMuted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={submit}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel={isEditing ? "Save edit" : "Send"}
          accessibilityState={{ disabled: !canSend }}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: hasContent ? (pressed ? b.brandDeep : b.brand) : "transparent",
            alignItems: "center",
            justifyContent: "center",
            transform: [{ scale: pressed && !reduced ? 0.92 : 1 }],
          })}
        >
          <Ionicons
            name={isEditing ? "checkmark" : hasContent ? "arrow-up" : "chatbubble-ellipses-outline"}
            size={hasContent ? 21 : 22}
            color={hasContent ? b.onBrand : CHAT.inkFaint}
          />
        </Pressable>
      </View>
    </View>
  );
});
