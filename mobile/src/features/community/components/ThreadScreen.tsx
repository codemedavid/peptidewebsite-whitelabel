import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, View, type FlatList, type TextInput } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import type { CommunityMessage, Participant, ThreadType } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { cartCount } from "@/features/shop/lib/cart";
import { useShop } from "@/features/shop/ShopProvider";
import { OfflineBanner } from "@/ui/feedback";
import { useInbox } from "../hooks/useInbox";
import { useInChatSearch } from "../hooks/useSearch";
import { useThread } from "../hooks/useThread";
import { useThreadActions } from "../hooks/useThreadActions";
import type { Attachment } from "../lib/attachments";
import { restoreDraft } from "../lib/messages";
import { hueFromString } from "../lib/color";
import { firstName } from "../lib/format";
import { CHAT } from "../theme";
import { EmojiAvatar, ParticipantAvatar } from "./Avatar";
import { ChatButton, ChatEmpty, IconButton } from "./ChatKit";
import { Composer } from "./Composer";
import { DropPinnedBar } from "./Drops";
import { NavBar } from "./Headers";
import { ProfileSheet } from "./ProfileSheet";
import { useOpenProduct } from "./Cards";
import { PhotoViewer } from "./Media";
import { openLink } from "../open";
import { AttachMenu, ChatSearchBar, MessageActions } from "./Sheets";
import { ThreadList, type Row } from "./ThreadList";

type Props = { type: ThreadType; id: string; q?: string; focus?: string };

/** A topic or DM: header, pinned drop, wallpapered list, composer, sheets. */
export function ThreadScreen({ type, id, q, focus }: Props) {
  const thread = useThread(type, id);
  const actions = useThreadActions(type, id);
  const inbox = useInbox();
  const search = useInChatSearch({ type, id, ready: !thread.loading, loadThrough: thread.loadThrough, initial: q && focus ? { query: q, focusId: focus } : null });
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [replyTo, setReplyTo] = useState<CommunityMessage | null>(null);
  const [editing, setEditing] = useState<CommunityMessage | null>(null);
  const [draft, setDraft] = useState("");
  const [menuFor, setMenuFor] = useState<CommunityMessage | null>(null);
  const [profileFor, setProfileFor] = useState<Participant | null>(null);
  // The message whose sender was tapped, so the card can offer "Reply in community".
  const [profileFrom, setProfileFrom] = useState<CommunityMessage | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const { me } = useSignedIn();
  const shop = useShop();
  const inCart = me.mode === "customer" ? cartCount(shop.lines) : 0;
  const openProduct = useOpenProduct();
  const listRef = useRef<FlatList<Row>>(null);
  const inputRef = useRef<TextInput>(null);

  const info = thread.state?.thread ?? null;
  const peer = info?.peer ?? null;
  const dm = type === "dm";
  const title = info?.title ?? (dm ? "Direct message" : "Chat");
  const canPost = info?.canPost ?? false;
  const liveDrop = !dm ? (inbox.data?.drops.find((d) => d.isActive && d.topicId === id) ?? inbox.data?.drops.find((d) => d.isActive)) : undefined;

  const { send, edit, remove, endDrop } = actions;

  const startEdit = useCallback((m: CommunityMessage) => {
    setReplyTo(null);
    setEditing(m);
    setDraft(m.body ?? "");
    inputRef.current?.focus();
  }, []);
  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft("");
  }, []);

  const handleSend = useCallback(
    async (body: string) => {
      if (editing) {
        const target = editing;
        const text = body.trim();
        if (target.kind === "text" && !text) {
          Alert.alert("Message is empty", "A message can't be empty. Delete it instead.");
          return;
        }
        if (text === (target.body ?? "").trim()) {
          cancelEdit();
          return;
        }
        // Keep the text in the field until the edit is saved.
        const err = await edit(target, text);
        if (err) {
          Alert.alert("Edit not saved", err);
          return;
        }
        cancelEdit();
        return;
      }
      const current = attachment;
      const replying = replyTo;
      setDraft("");
      setAttachment(null);
      setReplyTo(null);
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      // Not awaited: the optimistic bubble is queued, so the composer unlocks
      // now while any upload runs. A failure puts the draft back.
      void send({ body, attachment: current, replyTo: replying }).then((err) => {
        if (!err) return;
        Alert.alert("Message not sent", err);
        setDraft((now) => restoreDraft(now, body));
        setAttachment((now) => now ?? current);
        setReplyTo((now) => now ?? replying);
      });
    },
    [attachment, cancelEdit, edit, editing, replyTo, send],
  );

  const showProfile = useCallback((person: Participant, from: CommunityMessage | null = null) => {
    setProfileFor(person);
    setProfileFrom(from);
  }, []);
  const closeProfile = () => {
    setProfileFor(null);
    setProfileFrom(null);
  };
  const startReply = (m: CommunityMessage) => {
    if (editing) cancelEdit();
    setReplyTo(m);
    inputRef.current?.focus();
  };

  const openShared = () => router.push({ pathname: "/community/media/[type]/[id]", params: { type, id, title } });
  const confirmDelete = (m: CommunityMessage) =>
    Alert.alert("Delete message?", dm ? `It will show as deleted for you and ${peer ? firstName(peer.name) : "them"}.` : "It will show as deleted for everyone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void remove(m).then((err) => err && Alert.alert("Couldn't delete", err)) },
    ]);
  // Stable: it's a prop of every memoised bubble.
  const confirmEndDrop = useCallback(
    (dropId: string) =>
      Alert.alert("End this drop?", "The buy button turns off everywhere.", [
        { text: "Cancel", style: "cancel" },
        { text: "End drop", style: "destructive", onPress: () => void endDrop(dropId).then((err) => err && Alert.alert("Couldn't end the drop", err)) },
      ]),
    [endDrop],
  );

  if (thread.error && !thread.state) {
    return (
      <View style={{ flex: 1, backgroundColor: CHAT.surface }}>
        <NavBar title={title} />
        <ChatEmpty icon="alert-circle-outline" title="Couldn't open this chat" body={thread.error} action={<ChatButton label="Try again" tone="outline" onPress={() => void thread.reload()} />} />
      </View>
    );
  }

  const leading = dm ? (
    <Pressable onPress={() => peer && showProfile(peer)} disabled={!peer} accessibilityRole="button" accessibilityLabel={`View ${title}'s profile`}>
      {peer ? <ParticipantAvatar person={peer} size={38} /> : null}
    </Pressable>
  ) : info ? (
    <EmojiAvatar emoji={info.emoji ?? "#"} imageUrl={info.imageUrl} hue={hueFromString(info.channelId ?? id)} size={38} />
  ) : null;

  return (
    // keyboard-controller's view tracks the keyboard on both platforms, including Android edge-to-edge.
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: CHAT.surface }}>
      {search.open ? (
        <ChatSearchBar search={search} />
      ) : (
        <NavBar
          title={title}
          subtitle={info?.subtitle || (dm ? (peer ? "Private chat · tap photo for profile" : "Private chat") : undefined)}
          leading={leading}
          onPressTitle={openShared}
          titleHint="Shows media, links and docs"
          right={
            <>
              {info?.canManage && !dm && info.channelId ? (
                <IconButton name="flash" label="Broadcast a drop" variant="tinted" size={36} iconSize={17} onPress={() => router.push({ pathname: "/community/drop-new", params: { channel: info.channelId! } })} />
              ) : null}
              <IconButton name="search" label="Search this chat" onPress={search.start} />
              <IconButton name="images-outline" label="Media, links and docs" onPress={openShared} />
              {me.mode === "customer" ? <IconButton name="bag-handle-outline" label="Cart" badge={inCart} onPress={() => router.push(shop.paths.cart)} /> : null}
            </>
          }
        />
      )}
      <OfflineBanner />
      {liveDrop ? <DropPinnedBar drop={liveDrop} /> : null}

      <ThreadList
        messages={thread.state?.messages ?? []}
        loading={thread.loading}
        hasMore={!!thread.state?.olderCursor}
        loadingOlder={thread.loadingOlder}
        onLoadOlder={() => void thread.loadOlder()}
        listRef={listRef}
        empty={
          dm
            ? { emoji: "🔒", title: `Say hi to ${firstName(title)}`, body: "This chat is private. Only the two of you can see it." }
            : { emoji: "👋", title: "No messages here yet", body: canPost ? "Say hi, or tap + to share a photo or a document." : "Announcements from the store will show up here." }
        }
        onLongPressMessage={setMenuFor}
        onPressSender={showProfile}
        hideNames={dm}
        onEndDrop={info?.canManage ? confirmEndDrop : undefined}
        highlight={search.highlight}
        focusId={search.focusId}
      />

      <Composer
        ref={inputRef}
        disabled={!!info && !canPost}
        disabledReason={info?.postBlockedReason ?? undefined}
        attachment={attachment}
        onClearAttachment={() => setAttachment(null)}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        editing={editing}
        onCancelEdit={cancelEdit}
        onAttach={() => setAttachOpen(true)}
        text={draft}
        onChangeText={setDraft}
        onSend={handleSend}
      />

      <AttachMenu visible={attachOpen} onClose={() => setAttachOpen(false)} onAttach={setAttachment} />
      <MessageActions
        message={menuFor}
        canReply={canPost}
        onReply={startReply}
        onEdit={startEdit}
        onCopy={(m) => void Clipboard.setStringAsync(m.body ?? "")}
        onViewProduct={openProduct}
        onViewProtocol={(m) => {
          const p = m.protocol;
          if (p?.mode === "image" && p.imageUrl) setViewing(p.imageUrl);
          else if (p?.mode === "file" && p.fileUrl) void openLink(p.fileUrl);
        }}
        onDelete={confirmDelete}
        onClose={() => setMenuFor(null)}
      />
      <PhotoViewer uri={viewing} onClose={() => setViewing(null)} />
      <ProfileSheet
        person={profileFor}
        currentConversationPeer={dm ? peer?.key : undefined}
        onReplyInGroup={!dm && canPost && profileFrom ? () => startReply(profileFrom) : undefined}
        onClose={closeProfile}
      />
    </KeyboardAvoidingView>
  );
}
