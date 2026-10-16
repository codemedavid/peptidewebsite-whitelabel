import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, View } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { UploadResponse, WelcomeMessage } from "@contract";
import { useSetWelcome } from "../hooks/useCommunityData";
import { PickError, pickImage, pickVideo, uploadDraft, uploadVideo } from "../hooks/usePickers";
import { bubbleImageSize } from "../lib/attachments";
import {
  WELCOME_MAX_MESSAGES,
  WELCOME_TEXT_MAX,
  draftsFromWelcome,
  itemProblem,
  itemSummary,
  moveItem,
  removeItem,
  toWelcomeRequest,
  upsertItem,
  welcomeCardLine,
  welcomeProblem,
  type DraftItem,
  type DraftMedia,
} from "../lib/welcome";
import { CHAT, GUTTER, INTER, RADII, SHADOWS, useChatBrand } from "../theme";
import { ChatButton, IconButton, type IconName } from "./ChatKit";
import { ChatText } from "./ChatText";
import { ChatVideo } from "./ChatVideo";
import { Field, FormError } from "./Form";
import { CHAT_IMAGE_BLURHASH } from "./Media";
import { Sheet } from "./Surfaces";

/*
 * The store's welcome: a short run of private messages every new member gets,
 * in order, the first time they open Chats. Each message is text, a photo or
 * a video — or a photo/video with a caption, like WhatsApp. The Sheet has two
 * views: the ordered list (add, reorder, delete, Save) and one message's
 * editor. Nothing reaches the server until Save.
 */

const THUMB = 52;
const PREVIEW_WIDTH = 260;

let localKeys = 0;
const newKey = () => `local-${Date.now().toString(36)}-${++localKeys}`;

function tap() {
  void Haptics.selectionAsync().catch(() => undefined);
}

// ── list view ────────────────────────────────────────────────────────────────

function Thumb({ item }: { item: DraftItem }) {
  const b = useChatBrand();
  const m = item.media;
  const still = m ? (m.kind === "image" ? m.previewUri : m.posterUrl) : null;
  return (
    <View style={{ width: THUMB, height: THUMB, borderRadius: RADII.md, overflow: "hidden", backgroundColor: m ? CHAT.night : b.brandTint, alignItems: "center", justifyContent: "center" }}>
      {still ? <Image source={{ uri: still }} placeholder={{ blurhash: CHAT_IMAGE_BLURHASH }} contentFit="cover" style={{ position: "absolute", inset: 0 }} /> : null}
      {!m ? <Ionicons name="chatbubble-ellipses" size={22} color={b.brandText} /> : null}
      {m?.kind === "video" ? (
        <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(15,17,21,0.55)" }}>
          <Ionicons name="play" size={13} color="#fff" style={{ marginLeft: 2 }} />
        </View>
      ) : null}
    </View>
  );
}

type ItemRowProps = {
  item: DraftItem;
  index: number;
  count: number;
  onEdit: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
};

function ItemRow({ item, index, count, onEdit, onMove, onDelete }: ItemRowProps) {
  const b = useChatBrand();
  const kindLabel = item.media?.kind === "video" ? "Video" : item.media?.kind === "image" ? "Photo" : "Text";
  const caption = item.media && item.text.trim() ? " + caption" : "";
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: RADII.lg, backgroundColor: CHAT.surface }, SHADOWS.hairline]}>
      <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: b.brandSoft }}>
        <ChatText style={{ fontFamily: INTER.bold, fontSize: 12, lineHeight: 15, color: b.brandText }}>{index + 1}</ChatText>
      </View>
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Message ${index + 1}, ${kindLabel}: ${itemSummary(item)}`}
        accessibilityHint="Opens this message to edit"
        style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, opacity: pressed ? 0.6 : 1 })}
      >
        <Thumb item={item} />
        <View style={{ flex: 1, gap: 2 }}>
          <ChatText variant="overline" color={CHAT.inkMuted}>{`${kindLabel}${caption}`}</ChatText>
          <ChatText variant="callout" numberOfLines={2} style={{ color: item.text.trim() ? CHAT.ink : CHAT.inkMuted }}>
            {item.text.trim() || (item.media ? "No caption" : "Empty message")}
          </ChatText>
        </View>
      </Pressable>
      <View style={{ alignItems: "center" }}>
        <IconButton name="chevron-up" label={`Move message ${index + 1} up`} size={32} iconSize={18} disabled={index === 0} onPress={() => onMove(-1)} />
        <IconButton name="chevron-down" label={`Move message ${index + 1} down`} size={32} iconSize={18} disabled={index === count - 1} onPress={() => onMove(1)} />
      </View>
      <IconButton name="trash-outline" label={`Delete message ${index + 1}`} size={36} iconSize={19} color={CHAT.danger} onPress={onDelete} />
    </View>
  );
}

// ── one message's editor ─────────────────────────────────────────────────────

type MediaPreviewProps = { media: DraftMedia; onReplace: () => void; onRemove: () => void; onRetry: () => void };

function MediaPreview({ media, onReplace, onRemove, onRetry }: MediaPreviewProps) {
  const size = bubbleImageSize(media.width, media.height, PREVIEW_WIDTH);
  const busy = media.status === "uploading";
  return (
    <View style={{ alignSelf: "center", gap: 10, alignItems: "center" }}>
      <View style={{ borderRadius: RADII.lg, overflow: "hidden" }}>
        {media.kind === "image" ? (
          <Image
            source={{ uri: media.previewUri }}
            placeholder={{ blurhash: CHAT_IMAGE_BLURHASH }}
            contentFit="cover"
            style={{ ...size, backgroundColor: CHAT.surfaceAlt }}
            accessibilityLabel="Photo for this message"
          />
        ) : (
          <ChatVideo
            video={{ url: media.url ?? media.previewUri, posterUrl: media.posterUrl, width: media.width, height: media.height, size: media.size }}
            radius={0}
            width={PREVIEW_WIDTH}
          />
        )}
        {busy ? (
          <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "rgba(15,17,21,0.45)" }}>
            <ActivityIndicator color="#fff" />
            <ChatText variant="subhead" color="#fff">
              {media.kind === "video" ? "Uploading video…" : "Uploading photo…"}
            </ChatText>
          </View>
        ) : null}
      </View>
      {media.status === "failed" ? (
        <ChatText variant="footnote" color={CHAT.danger} accessibilityLiveRegion="polite" style={{ textAlign: "center" }}>
          {media.error ?? "The upload failed."}
        </ChatText>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {media.status === "failed" ? <ChatButton label="Try again" icon="refresh" size="sm" tone="tinted" onPress={onRetry} /> : null}
        <ChatButton label="Replace" icon="swap-horizontal" size="sm" tone="outline" disabled={busy} onPress={onReplace} />
        <ChatButton label="Remove" icon="close" size="sm" tone="danger" onPress={onRemove} />
      </View>
    </View>
  );
}

function AddMediaTile({ icon, label, hint, onPress }: { icon: IconName; label: string; hint: string; onPress: () => void }) {
  const b = useChatBrand();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Add a ${label.toLowerCase()}`}
      accessibilityHint={hint}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: "center",
        gap: 6,
        paddingVertical: 18,
        borderRadius: RADII.lg,
        borderWidth: 1.5,
        borderStyle: "dashed",
        borderColor: pressed ? b.brand : b.brandEdge,
        backgroundColor: pressed ? b.brandSoft : b.brandTint,
      })}
    >
      <Ionicons name={icon} size={24} color={b.brandText} />
      <ChatText variant="bodyStrong" color={b.brandText}>
        {label}
      </ChatText>
      <ChatText variant="caption" color={CHAT.inkMuted}>
        {hint}
      </ChatText>
    </Pressable>
  );
}

type MediaPick = {
  kind: DraftMedia["kind"];
  previewUri: string;
  width: number | null;
  height: number | null;
  size: number;
  upload: (signal: AbortSignal) => Promise<UploadResponse>;
};

async function choose(kind: DraftMedia["kind"]): Promise<MediaPick | null> {
  if (kind === "image") {
    const draft = await pickImage("library");
    return draft ? { kind, previewUri: draft.uri, width: draft.width, height: draft.height, size: 0, upload: (signal) => uploadDraft(draft, signal) } : null;
  }
  const draft = await pickVideo();
  return draft ? { kind, previewUri: draft.uri, width: draft.width, height: draft.height, size: draft.size ?? 0, upload: (signal) => uploadVideo(draft, signal) } : null;
}

type MessageEditorProps = { initial: DraftItem; isNew: boolean; onDone: (item: DraftItem) => void; onDelete: () => void; onCancel: () => void };

function MessageEditor({ initial, isNew, onDone, onDelete, onCancel }: MessageEditorProps) {
  const [text, setText] = useState(initial.text);
  const [media, setMedia] = useState<DraftMedia | null>(initial.media);
  const [pickError, setPickError] = useState<string | null>(null);
  const lastPick = useRef<MediaPick | null>(null);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => () => inflight.current?.abort(), []);

  const run = (pick: MediaPick) => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    lastPick.current = pick;
    setMedia({ kind: pick.kind, previewUri: pick.previewUri, url: null, posterUrl: null, width: pick.width, height: pick.height, size: pick.size, status: "uploading", error: null });
    pick
      .upload(ctrl.signal)
      .then((up) => {
        if (ctrl.signal.aborted) return;
        setMedia((m) => (m ? { ...m, url: up.url, size: up.size, width: up.width ?? m.width, height: up.height ?? m.height, status: "ready" } : m));
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setMedia((m) => (m ? { ...m, status: "failed", error: e instanceof Error ? e.message : "The upload failed." } : m));
      });
  };

  const add = async (kind: DraftMedia["kind"]) => {
    setPickError(null);
    try {
      const pick = await choose(kind);
      if (pick) run(pick);
    } catch (e) {
      setPickError(e instanceof PickError ? e.message : "Couldn't open your library. Try again.");
    }
  };

  const remove = () => {
    inflight.current?.abort();
    lastPick.current = null;
    setMedia(null);
  };

  const draft: DraftItem = { ...initial, text, media };
  const problem = itemProblem(draft);
  const showProblem = problem !== null && media?.status !== "uploading" && (text.length > 0 || media !== null);

  return (
    <ScrollView contentContainerStyle={{ padding: GUTTER, gap: 16 }} keyboardShouldPersistTaps="handled">
      {media ? (
        <MediaPreview media={media} onReplace={() => void add(media.kind)} onRemove={remove} onRetry={() => lastPick.current && run(lastPick.current)} />
      ) : (
        <View style={{ gap: 8 }}>
          <ChatText variant="overline" style={{ marginHorizontal: 2 }}>
            Attach (optional)
          </ChatText>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <AddMediaTile icon="image" label="Photo" hint="Up to 10 MB" onPress={() => void add("image")} />
            <AddMediaTile icon="videocam" label="Video" hint="Up to 50 MB" onPress={() => void add("video")} />
          </View>
        </View>
      )}
      <FormError message={pickError} />
      <Field
        label={media ? "Caption" : "Message"}
        value={text}
        onChangeText={setText}
        multiline
        maxLength={WELCOME_TEXT_MAX}
        counter
        placeholder={media ? "Add a caption (optional)" : "Hi! Welcome to our community. Ask us anything here."}
        hint={showProblem ? (problem ?? undefined) : undefined}
      />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <ChatButton label="Cancel" tone="outline" size="lg" style={{ flex: 1 }} onPress={onCancel} />
        <ChatButton label={isNew ? "Add message" : "Done"} size="lg" style={{ flex: 1 }} disabled={problem !== null} onPress={() => onDone({ ...draft, text: text.trim() })} />
      </View>
      {!isNew ? <ChatButton label="Delete this message" icon="trash-outline" tone="ghost" onPress={onDelete} /> : null}
    </ScrollView>
  );
}

// ── the sheet ────────────────────────────────────────────────────────────────

type Editing = { index: number | null; item: DraftItem };

/** The welcome editor itself — the Members card and the admin panels open it. */
export function WelcomeSheet({ welcome, visible, onClose }: { welcome: WelcomeMessage; visible: boolean; onClose: () => void }) {
  const b = useChatBrand();
  const save = useSetWelcome();
  const [enabled, setEnabled] = useState(welcome.enabled);
  const [items, setItems] = useState<DraftItem[]>(() => draftsFromWelcome(welcome));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const problem = welcomeProblem(enabled, items);
  const full = items.length >= WELCOME_MAX_MESSAGES;

  const change = (next: DraftItem[]) => {
    setItems(next);
    setError(null);
  };

  const submit = () => {
    if (problem || save.isPending) return;
    setError(null);
    save.mutate(toWelcomeRequest(enabled, items), {
      onSuccess: () => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        onClose();
      },
      onError: (e) => setError(e.message),
    });
  };

  if (editing) {
    const isNew = editing.index === null;
    return (
      <Sheet
        visible={visible}
        onClose={() => setEditing(null)}
        title={isNew ? "New welcome message" : `Message ${(editing.index ?? 0) + 1}`}
        subtitle="Text, a photo or a video — add a caption to send them together."
      >
        <MessageEditor
          key={editing.item.key}
          initial={editing.item}
          isNew={isNew}
          onCancel={() => setEditing(null)}
          onDone={(item) => {
            tap();
            // Writing the first message is the clearest sign they want it sent.
            if (items.length === 0) setEnabled(true);
            change(upsertItem(items, editing.index, item));
            setEditing(null);
          }}
          onDelete={() => {
            tap();
            if (editing.index !== null) change(removeItem(items, editing.index));
            setEditing(null);
          }}
        />
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Welcome messages" subtitle="Sent once, in this order, as private messages from the store when someone joins.">
      <ScrollView contentContainerStyle={{ padding: GUTTER, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={() => (setEnabled((v) => !v), setError(null))}
          accessibilityRole="switch"
          accessibilityState={{ checked: enabled }}
          accessibilityLabel="Send welcome messages"
          style={[{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: RADII.lg, backgroundColor: CHAT.surface }, SHADOWS.hairline]}
        >
          <View style={{ flex: 1, gap: 1 }}>
            <ChatText variant="bodyStrong">Send welcome messages</ChatText>
            <ChatText variant="footnote">{enabled ? "New members get them the first time they open Chats." : "Off. New members get nothing."}</ChatText>
          </View>
          <Switch
            value={enabled}
            onValueChange={(v) => (setEnabled(v), setError(null))}
            trackColor={{ true: b.brand, false: CHAT.hairlineStrong }}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </Pressable>

        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginHorizontal: 2, marginTop: 4 }}>
          <ChatText variant="overline">Messages · in order</ChatText>
          <ChatText variant="caption" color={CHAT.inkMuted}>{`${items.length}/${WELCOME_MAX_MESSAGES}`}</ChatText>
        </View>

        {items.length === 0 ? (
          <View style={{ alignItems: "center", gap: 6, paddingVertical: 22, paddingHorizontal: 16, borderRadius: RADII.lg, backgroundColor: CHAT.surface }}>
            <Ionicons name="hand-left-outline" size={26} color={b.brandText} />
            <ChatText variant="bodyStrong">No welcome messages yet</ChatText>
            <ChatText variant="footnote" style={{ textAlign: "center" }}>
              Add a greeting, a photo of your shop, or a short video on how to order.
            </ChatText>
          </View>
        ) : (
          items.map((item, i) => (
            <ItemRow
              key={item.key}
              item={item}
              index={i}
              count={items.length}
              onEdit={() => setEditing({ index: i, item })}
              onMove={(dir) => (tap(), change(moveItem(items, i, dir)))}
              onDelete={() => (tap(), change(removeItem(items, i)))}
            />
          ))
        )}

        <ChatButton
          label={full ? `Up to ${WELCOME_MAX_MESSAGES} messages` : "Add a message"}
          icon="add"
          tone="tinted"
          disabled={full}
          onPress={() => setEditing({ index: null, item: { key: newKey(), id: null, text: "", media: null } })}
        />

        <ChatText variant="footnote" style={{ marginHorizontal: 2 }}>
          Changes apply to people who join after you save. Members who already joined won&apos;t get them again.
        </ChatText>
        <FormError message={error ?? (enabled && items.length === 0 ? problem : null)} />
        <ChatButton label="Save" size="lg" loading={save.isPending} disabled={problem !== null} onPress={submit} />
      </ScrollView>
    </Sheet>
  );
}

/** A compact row under "Who can join" that opens the welcome editor. */
export function WelcomeCard({ welcome }: { welcome: WelcomeMessage }) {
  const b = useChatBrand();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Welcome messages, ${welcome.enabled ? `on, ${welcome.messages.length}` : "off"}`}
        accessibilityHint="Opens the welcome messages editor"
        style={({ pressed }) => [
          {
            marginHorizontal: GUTTER,
            marginTop: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderRadius: RADII.lg,
            backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface,
          },
          SHADOWS.hairline,
        ]}
      >
        <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: welcome.enabled ? b.brandTint : CHAT.surfaceAlt }}>
          <Ionicons name="hand-left" size={17} color={welcome.enabled ? b.brandText : CHAT.inkMuted} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <ChatText variant="bodyStrong">Welcome messages</ChatText>
          <ChatText variant="footnote" numberOfLines={1}>
            {welcomeCardLine(welcome)}
          </ChatText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={CHAT.inkFaint} />
      </Pressable>
      {open ? <WelcomeSheet welcome={welcome} visible={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
