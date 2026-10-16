// The composer's attach menu, the long-press message menu and the in-chat search bar.
import { useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CommunityMessage } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { attachmentLabel, type Attachment } from "../lib/attachments";
import { saveAsReplyFrom } from "../lib/savedReplies";
import { isSearchable } from "../lib/search";
import { pickDocument, pickImage, PickError, type ImageSource } from "../hooks/usePickers";
import { useLiveGroupBuy } from "../hooks/useCommunityData";
import type { InChatSearch } from "../hooks/useSearch";
import { CHAT, GUTTER, INTER, RADII, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";
import { IconButton, SearchBar, type IconName } from "./ChatKit";
import { ProductPicker } from "./ProductPicker";
import { ProtocolPicker } from "./ProtocolPicker";
import { Sheet } from "./Surfaces";

// ── Attach menu ──────────────────────────────────────────────────────────────

type Choice = "groupbuy" | "product" | "protocol" | "document" | ImageSource;
type Option = { key: Choice; label: string; hint: string; icon: IconName; tint: string };

// Same order as the inspiration: things from the store first, then media.
const OPTIONS: Option[] = [
  { key: "groupbuy", label: "Group buy", hint: "The live round", icon: "people", tint: "#0E6E5C" },
  { key: "product", label: "Product", hint: "A listing from the shop", icon: "pricetag", tint: "#B8325A" },
  { key: "protocol", label: "Protocol", hint: "A dosing guide", icon: "clipboard", tint: "#7A3FB8" },
  { key: "camera", label: "Camera", hint: "Take a photo", icon: "camera", tint: "#C43A24" },
  { key: "library", label: "Gallery", hint: "From your photos", icon: "images", tint: "#1F63D1" },
  { key: "files", label: "Files", hint: "Photo from a folder", icon: "folder-open", tint: "#1B7F46" },
  { key: "document", label: "Document", hint: "PDF, Word, Excel", icon: "document-text", tint: "#4E5663" },
];

type Picker = "product" | "protocol" | null;

/** The composer's "+": choose what to share, then the matching picker. */
export function AttachMenu({ visible, onClose, onAttach }: { visible: boolean; onClose: () => void; onAttach: (a: Attachment) => void }) {
  const { me } = useSignedIn();
  // Customers share from the shop they browse; the store team needs catalog access.
  const canPickProducts = me.mode === "customer" || me.can.products || me.can.inventory;
  const [picker, setPicker] = useState<Picker>(null);
  // iOS drops a modal presented while another is still animating away, so a
  // choice waits for the menu's onDismiss there.
  const [pending, setPending] = useState<Choice | null>(null);
  const menuVisible = visible && picker === null && pending === null;
  // Only while a round is open — the server refuses anything else.
  const live = useLiveGroupBuy(visible);
  const round = live.data?.groupBuy?.status === "open" ? live.data.groupBuy : null;
  const options = OPTIONS.filter((o) => (o.key !== "product" || canPickProducts) && (o.key !== "groupbuy" || !!round));

  const finish = () => {
    setPicker(null);
    setPending(null);
    onClose();
  };

  const attach = async (run: () => Promise<Attachment | null>, what: string) => {
    try {
      const a = await run();
      if (a) onAttach(a);
    } catch (e) {
      Alert.alert(`${what} not added`, e instanceof PickError ? e.message : "Something went wrong opening your files. Try again.");
    }
  };

  const run = (choice: Choice) => {
    setPending(null);
    if (choice === "product" || choice === "protocol") {
      setPicker(choice);
      return;
    }
    finish();
    if (choice === "groupbuy") {
      if (round) onAttach({ type: "groupbuy", groupBuy: round });
      return;
    }
    if (choice === "document") void attach(pickDocument, "Document");
    else void attach(() => pickImage(choice), "Photo");
  };
  const choose = (choice: Choice) => (Platform.OS === "ios" ? setPending(choice) : run(choice));

  return (
    <>
      <Sheet visible={menuVisible} onClose={finish} onDismiss={() => pending && run(pending)} fit>
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 12, paddingBottom: 6, gap: 12 }}>
          <ChatText variant="overline" accessibilityRole="header">
            Share in chat
          </ChatText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 16 }}>
            {options.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => choose(o.key)}
                accessibilityRole="button"
                accessibilityLabel={o.label}
                accessibilityHint={o.hint}
                style={({ pressed }) => ({ width: "33.33%", alignItems: "center", gap: 6, transform: [{ scale: pressed ? 0.94 : 1 }] })}
              >
                <View style={{ width: 58, height: 58, borderRadius: RADII.lg, backgroundColor: o.tint, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={o.icon} size={26} color="#fff" />
                </View>
                <View style={{ alignItems: "center" }}>
                  <ChatText variant="bodyStrong" style={{ fontSize: 14 }}>
                    {o.label}
                  </ChatText>
                  <ChatText variant="caption">{o.hint}</ChatText>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      </Sheet>
      {canPickProducts ? (
        <ProductPicker visible={picker === "product"} onClose={finish} onPick={(product) => onAttach({ type: "product", product })} />
      ) : null}
      <ProtocolPicker visible={picker === "protocol"} onClose={finish} onPick={(protocol) => onAttach({ type: "protocol", protocol })} />
    </>
  );
}

// ── Message actions ──────────────────────────────────────────────────────────

type Action = { key: string; label: string; icon: IconName; destructive?: boolean; run: (m: CommunityMessage) => void };

type MessageActionsProps = {
  message: CommunityMessage | null;
  canReply: boolean;
  onReply: (m: CommunityMessage) => void;
  onEdit: (m: CommunityMessage) => void;
  onDelete: (m: CommunityMessage) => void;
  onCopy: (m: CommunityMessage) => void;
  /** Product and drop messages: open the listing. */
  onViewProduct: (productId: string) => void;
  /** Image / file protocol guides: open the guide. */
  onViewProtocol: (m: CommunityMessage) => void;
  /** Someone else's message: send it to the safety inbox. */
  onReport: (m: CommunityMessage) => void;
  /** Set when the sender is a member you can block (never yourself or the store team). */
  onBlock?: (m: CommunityMessage) => void;
  /** Store team: keep this message's text as a saved reply. */
  onSaveReply?: (m: CommunityMessage) => void;
  onClose: () => void;
  /** iOS: the menu has finished closing (Modal onDismiss). */
  onDismiss?: () => void;
};

/** A protocol whose guide opens somewhere (text guides show everything on the card). */
export function protocolOpens(m: CommunityMessage): boolean {
  const p = m.protocol;
  return !!p && ((p.mode === "image" && !!p.imageUrl) || (p.mode === "file" && !!p.fileUrl));
}

/** Long-press menu: a quoted preview and a grouped action list (server decides edit/delete). */
export function MessageActions({ message, canReply, onReply, onEdit, onDelete, onCopy, onViewProduct, onViewProtocol, onReport, onBlock, onSaveReply, onClose, onDismiss }: MessageActionsProps) {
  const b = useChatBrand();
  const actions: Action[] = [];
  if (canReply) actions.push({ key: "reply", label: "Reply", icon: "arrow-undo-outline", run: onReply });
  const productId = message?.product?.id ?? message?.drop?.product.id;
  if (productId) actions.push({ key: "listing", label: "View listing", icon: "bag-handle-outline", run: () => onViewProduct(productId) });
  if (message && protocolOpens(message)) actions.push({ key: "protocol", label: "Read protocol", icon: "book-outline", run: onViewProtocol });
  if (message?.body) actions.push({ key: "copy", label: "Copy text", icon: "copy-outline", run: onCopy });
  if (message && onSaveReply && saveAsReplyFrom(message)) actions.push({ key: "save-reply", label: "Save as reply", icon: "chatbox-ellipses-outline", run: onSaveReply });
  if (message?.canEdit) actions.push({ key: "edit", label: "Edit", icon: "pencil-outline", run: onEdit });
  if (message?.canDelete) actions.push({ key: "delete", label: "Delete for everyone", icon: "trash-outline", destructive: true, run: onDelete });
  if (message && !message.mine && message.kind !== "system" && message.kind !== "order") {
    actions.push({ key: "report", label: "Report message", icon: "flag-outline", destructive: true, run: onReport });
  }
  if (message && onBlock) {
    actions.push({ key: "block", label: `Block ${message.sender?.name ?? "this member"}`, icon: "ban-outline", destructive: true, run: onBlock });
  }
  return (
    <Sheet visible={message != null} onClose={onClose} onDismiss={onDismiss} fit>
      {message ? (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 12, gap: 12 }}>
          <View style={{ backgroundColor: CHAT.surface, borderRadius: RADII.md, padding: 12, gap: 2 }}>
            <ChatText variant="subhead" color={b.brandText} style={{ fontFamily: INTER.semibold }}>
              {message.mine ? "You" : (message.sender?.name ?? "Message")}
            </ChatText>
            <ChatText variant="callout" numberOfLines={3}>
              {[attachmentLabel(message.kind), message.body].filter(Boolean).join(" · ")}
            </ChatText>
          </View>
          <View style={{ backgroundColor: CHAT.surface, borderRadius: RADII.md, overflow: "hidden" }}>
            {actions.map((a, i) => (
              <Pressable
                key={a.key}
                onPress={() => {
                  onClose();
                  a.run(message);
                }}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                  paddingHorizontal: 16,
                  height: 52,
                  backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: CHAT.hairline,
                })}
              >
                <Ionicons name={a.icon} size={21} color={a.destructive ? CHAT.danger : CHAT.inkSoft} />
                <ChatText color={a.destructive ? CHAT.danger : CHAT.ink}>{a.label}</ChatText>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

// ── In-chat search bar ───────────────────────────────────────────────────────

/** Replaces a chat's NavBar while searching: field, "2 of 5", ▲ older, ▼ newer. */
export function ChatSearchBar({ search }: { search: InChatSearch }) {
  const insets = useSafeAreaInsets();
  const b = useChatBrand();
  const { text, setText, total, index, searching, error, step, close } = search;
  const typed = isSearchable(text);
  const status = !typed || searching ? null : total === 0 ? "No results" : `${index + 1} of ${total}`;
  return (
    <View style={{ paddingTop: insets.top + 4, paddingBottom: 8, paddingHorizontal: 6, backgroundColor: CHAT.surface, borderBottomWidth: 1, borderBottomColor: CHAT.hairline }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
        <IconButton name="chevron-back" label="Close search" iconSize={26} color={b.brandText} onPress={close} />
        <SearchBar value={text} onChangeText={setText} placeholder="Search this chat" autoFocus style={{ flex: 1 }} />
        <IconButton name="chevron-up" label="Older match" disabled={total === 0 || index >= total - 1} onPress={() => step("older")} />
        <IconButton name="chevron-down" label="Newer match" disabled={total === 0 || index <= 0} onPress={() => step("newer")} />
      </View>
      {typed ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 48, paddingTop: 4, minHeight: 18 }}>
          {searching ? <ActivityIndicator size="small" color={b.brandText} /> : null}
          <ChatText variant="footnote" accessibilityLiveRegion="polite" style={{ color: error ? CHAT.danger : CHAT.inkMuted }}>
            {error ?? status ?? "Searching…"}
          </ChatText>
        </View>
      ) : null}
    </View>
  );
}
