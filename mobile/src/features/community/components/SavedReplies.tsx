// Saved replies (store team): the team's shared quick answers, Business Suite
// style. A sheet to search, use, add, edit and delete them, and a strip of
// matches above the composer while a message starts with "/". A reply can
// also carry photos (SavedReplyPhotos.tsx), sent after its text.
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { SavedReply, SavedReplyImage } from "@contract";
import { useChangeSavedReply, useSavedReplies } from "../hooks/useCommunityData";
import { formatRelative } from "../lib/format";
import { formPhotosProblem, matchSavedReplies, photoLabel, savedReplySummary, shortcutQuery, toSavedReplyRequest, type FormPhoto } from "../lib/savedReplies";
import { CHAT, GUTTER, INTER, RADII, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";
import { ChatButton, ChatEmpty, IconButton, SearchBar } from "./ChatKit";
import { Field, FormError } from "./Form";
import { photosFromSaved, SavedReplyPhotoEditor, SavedReplyPhotoStrip } from "./SavedReplyPhotos";
import { Sheet } from "./Surfaces";

/** Mirrors src/lib/community/saved-replies.ts — the server re-checks both. */
const TITLE_MAX = 60;
const BODY_MAX = 2000;
const SUGGESTION_LIMIT = 4;

type Draft = { id: string | null; title: string; body: string; photos: FormPhoto[] };

/** What a reply starts from: text, plus photos when a team photo message is saved. */
export type SavedReplySeed = { body: string; images: SavedReplyImage[] };

const newDraft = (seed: SavedReplySeed): Draft => ({ id: null, title: "", body: seed.body, photos: photosFromSaved(seed.images) });

function ShortcutTag({ title }: { title: string }) {
  const b = useChatBrand();
  return (
    <View style={{ backgroundColor: b.brandSoft, borderRadius: RADII.sm, paddingHorizontal: 6, paddingVertical: 1, maxWidth: "70%" }}>
      <ChatText variant="caption" color={b.brandText} numberOfLines={1} style={{ fontFamily: INTER.semibold }}>
        {`/${title}`}
      </ChatText>
    </View>
  );
}

function ReplyRow({ reply, onUse, onEdit }: { reply: SavedReply; onUse: () => void; onEdit: () => void }) {
  const edited = reply.updatedBy && reply.updatedAt !== reply.createdAt ? `Edited by ${reply.updatedBy}` : `Saved by ${reply.createdBy}`;
  return (
    <Pressable
      onPress={onUse}
      accessibilityRole="button"
      accessibilityLabel={`Use saved reply ${reply.title}`}
      accessibilityHint="Puts it in your message"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 12,
        paddingLeft: GUTTER,
        paddingRight: 6,
        backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface,
        borderBottomWidth: 1,
        borderBottomColor: CHAT.hairline,
      })}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ChatText variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {reply.title}
          </ChatText>
          <ShortcutTag title={reply.title} />
        </View>
        <ChatText variant="callout" color={CHAT.inkSoft} numberOfLines={2}>
          {savedReplySummary(reply)}
        </ChatText>
        <SavedReplyPhotoStrip images={reply.images} />
        <ChatText variant="caption">{[edited, formatRelative(reply.updatedAt)].filter(Boolean).join(" · ")}</ChatText>
      </View>
      <IconButton name="pencil-outline" label={`Edit ${reply.title}`} size={44} iconSize={19} onPress={onEdit} />
    </Pressable>
  );
}

function ReplyForm({ draft, update, onDone }: { draft: Draft; update: (fn: (d: Draft) => Draft) => void; onDone: () => void }) {
  const change = useChangeSavedReply();
  const [error, setError] = useState<string | null>(null);
  const isNew = draft.id === null;
  const onChange = (next: Partial<Draft>) => update((d) => ({ ...d, ...next }));
  const photoProblem = formPhotosProblem(draft.photos);
  const hasContent = !!draft.body.trim() || draft.photos.length > 0;

  const save = () => {
    setError(null);
    const body = toSavedReplyRequest(draft.title, draft.body, draft.photos);
    change.mutate(draft.id === null ? { kind: "create", body } : { kind: "update", id: draft.id, body }, {
      onSuccess: onDone,
      onError: (e) => setError(e.message),
    });
  };
  const remove = (id: string) =>
    Alert.alert("Delete this saved reply?", "It's removed for the whole store team.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => change.mutate({ kind: "delete", id }, { onSuccess: onDone, onError: (e) => setError(e.message) }) },
    ]);

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 40, gap: 16 }}>
      <Field
        label="Title"
        icon="flash-outline"
        value={draft.title}
        onChangeText={(title) => onChange({ title })}
        maxLength={TITLE_MAX}
        counter
        placeholder="e.g. Payment details"
        hint={draft.title.trim() ? `Type /${draft.title.trim().replace(/^\/+/, "")} in any chat to find it fast.` : "Type / then the title in any chat to find it fast."}
        autoFocus={isNew && !draft.body}
        returnKeyType="next"
      />
      <Field
        label="Message"
        value={draft.body}
        onChangeText={(body) => onChange({ body })}
        maxLength={BODY_MAX}
        counter
        multiline
        placeholder="The answer you send again and again"
        hint="Optional when you add photos."
        style={{ maxHeight: 220 }}
      />
      <SavedReplyPhotoEditor photos={draft.photos} update={(fn) => update((d) => ({ ...d, photos: fn(d.photos) }))} disabled={change.isPending} />
      <FormError message={error ?? photoProblem} />
      <ChatButton
        label={isNew ? "Save reply" : "Save changes"}
        icon="checkmark"
        size="lg"
        loading={change.isPending}
        disabled={!draft.title.trim() || !hasContent || photoProblem !== null}
        onPress={save}
      />
      <ChatText variant="footnote" style={{ textAlign: "center" }}>
        Everyone on your store team sees and can use this reply.
      </ChatText>
      {draft.id !== null ? <ChatButton label="Delete reply" tone="danger" icon="trash-outline" disabled={change.isPending} onPress={() => remove(draft.id!)} /> : null}
    </ScrollView>
  );
}

type SheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Tap a reply: hand it to the composer (text into the field, photos queued). */
  onUse: (reply: SavedReply) => void;
  /** Open straight into a new reply holding this ("Save as reply" on a message). */
  startWith: SavedReplySeed | null;
  /** The composer's text, offered as the message of a new reply. */
  draft: string;
};

/** Search the team's replies, tap one to use it, or add / edit / delete. */
export function SavedRepliesSheet({ visible, onClose, onUse, startWith, draft }: SheetProps) {
  const b = useChatBrand();
  const q = useSavedReplies(visible);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<Draft | null>(null);
  const [wasVisible, setWasVisible] = useState(false);

  // Each opening starts fresh: the list, or the new-reply form when there's text to save.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setQuery("");
      setForm(startWith !== null ? newDraft(startWith) : null);
    }
  }

  const results = useMemo(() => matchSavedReplies(q.data ?? [], query), [q.data, query]);
  const typed = shortcutQuery(draft) === null ? draft.trim() : "";

  const title = form ? (form.id === null ? "New saved reply" : "Edit saved reply") : "Saved replies";
  const subtitle = form ? "Shared with your whole store team" : "Quick answers your whole team can send";

  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={subtitle}>
      {form ? (
        <>
          <View style={{ paddingHorizontal: GUTTER - 8, paddingBottom: 6, flexDirection: "row" }}>
            {startWith === null || form.id !== null ? (
              <ChatButton label="All replies" tone="ghost" size="sm" icon="chevron-back" onPress={() => setForm(null)} />
            ) : null}
          </View>
          <ReplyForm draft={form} update={(fn) => setForm((d) => (d ? fn(d) : d))} onDone={() => (startWith !== null ? onClose() : setForm(null))} />
        </>
      ) : (
        <>
          <View style={{ paddingHorizontal: GUTTER, paddingBottom: 10, gap: 10 }}>
            <SearchBar value={query} onChangeText={setQuery} placeholder="Search saved replies" />
            <ChatButton
              label={typed ? "Save what you typed as a reply" : "New saved reply"}
              tone="tinted"
              icon="add"
              onPress={() => setForm(newDraft({ body: typed, images: [] }))}
            />
          </View>
          {q.isPending ? (
            <ActivityIndicator color={b.brandText} style={{ marginTop: 32 }} accessibilityLabel="Loading saved replies" />
          ) : q.error ? (
            <ChatEmpty
              icon="cloud-offline-outline"
              title="Couldn't load saved replies"
              body={q.error.message}
              action={<ChatButton label="Try again" tone="outline" onPress={() => void q.refetch()} />}
            />
          ) : (
            <FlatList
              data={results}
              keyExtractor={(r) => r.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 40 }}
              ListEmptyComponent={
                <ChatEmpty
                  icon={query ? "search" : "chatbox-ellipses-outline"}
                  title={query ? "No matches" : "No saved replies yet"}
                  body={query ? "Try another word from the title or message." : "Save the answers you type again and again — payment details, shipping days, how to order. Your whole team can use them."}
                />
              }
              renderItem={({ item }) => (
                <ReplyRow
                  reply={item}
                  onUse={() => {
                    onUse(item);
                    onClose();
                  }}
                  onEdit={() => setForm({ id: item.id, title: item.title, body: item.body, photos: photosFromSaved(item.images) })}
                />
              )}
            />
          )}
        </>
      )}
    </Sheet>
  );
}

/** Above the composer after picking a reply with photos: they go out right after the message. */
export function QueuedPhotosBar({ title, images, onClear }: { title: string; images: SavedReplyImage[]; onClear: () => void }) {
  const b = useChatBrand();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 14, paddingRight: 4, paddingTop: 8 }}>
      <Ionicons name="images" size={20} color={b.brandText} />
      <View style={{ width: 2, alignSelf: "stretch", backgroundColor: b.brand, borderRadius: 1 }} />
      <SavedReplyPhotoStrip images={images.slice(0, 3)} />
      <View style={{ flex: 1 }}>
        <ChatText variant="subhead" color={b.brandText} numberOfLines={1} style={{ fontFamily: INTER.semibold }}>
          {`${photoLabel(images.length)} · ${title}`}
        </ChatText>
        <ChatText variant="footnote" numberOfLines={1}>
          Sent after your message
        </ChatText>
      </View>
      <Pressable onPress={onClear} hitSlop={4} accessibilityRole="button" accessibilityLabel="Don't send the saved photos" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="close" size={20} color={CHAT.inkMuted} />
      </Pressable>
    </View>
  );
}

/** Matches above the composer while the message starts with "/". Renders nothing when there are none. */
export function SavedReplySuggestions({ draft, enabled, onPick }: { draft: string; enabled: boolean; onPick: (reply: SavedReply) => void }) {
  const b = useChatBrand();
  const query = enabled ? shortcutQuery(draft) : null;
  const q = useSavedReplies(enabled);
  const matches = useMemo(() => (query === null ? [] : matchSavedReplies(q.data ?? [], query, SUGGESTION_LIMIT)), [q.data, query]);
  if (query === null || matches.length === 0) return null;
  return (
    <View accessibilityLabel="Saved reply suggestions" style={{ marginHorizontal: 8, marginTop: 8, borderRadius: RADII.md, borderWidth: 1, borderColor: CHAT.hairline, backgroundColor: CHAT.surface, overflow: "hidden" }}>
      {matches.map((r, i) => (
        <Pressable
          key={r.id}
          onPress={() => onPick(r)}
          accessibilityRole="button"
          accessibilityLabel={`Use saved reply ${r.title}`}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 12,
            minHeight: 48,
            paddingVertical: 6,
            backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface,
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: CHAT.hairline,
          })}
        >
          <Ionicons name="flash" size={16} color={b.brandText} />
          <View style={{ flex: 1 }}>
            <ChatText variant="subhead" numberOfLines={1} style={{ fontFamily: INTER.semibold }}>
              {r.title}
            </ChatText>
            <ChatText variant="footnote" numberOfLines={1}>
              {r.images.length && r.body.trim() ? `${photoLabel(r.images.length)} · ${savedReplySummary(r)}` : savedReplySummary(r)}
            </ChatText>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
