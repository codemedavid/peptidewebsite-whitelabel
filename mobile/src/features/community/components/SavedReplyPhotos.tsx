// Photos on a saved reply: the editor grid in the form (pick many at once,
// each uploads in the background) and the small strip on a list row.
import { useRef } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { SavedReplyImage } from "@contract";
import type { ImageDraft } from "../lib/attachments";
import { photoLabel, type FormPhoto } from "../lib/savedReplies";
import { pickImages, PickError, uploadDraft } from "../hooks/usePickers";
import { CHAT, RADII, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";

const THUMB = 76;
/** Uploads running at once — the rest wait their turn. */
const UPLOAD_CONCURRENCY = 3;
const STRIP_MAX = 4;

let seq = 0;
const newKey = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

export function photosFromSaved(images: SavedReplyImage[]): FormPhoto[] {
  return images.map((i) => ({ key: i.url, previewUri: i.url, url: i.url, width: i.width, height: i.height, status: "ready" }));
}

async function runQueue<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, items.length) }, async () => {
    while (next < items.length) await worker(items[next++]);
  });
  await Promise.all(lanes);
}

type EditorProps = {
  photos: FormPhoto[];
  /** Functional so background uploads always patch the latest list. */
  update: (fn: (photos: FormPhoto[]) => FormPhoto[]) => void;
  disabled?: boolean;
};

/** The form's photo grid: add as many as you like, tap ✕ to remove, tap a failed one to retry. */
export function SavedReplyPhotoEditor({ photos, update, disabled }: EditorProps) {
  const b = useChatBrand();
  // The picked files, so a failed upload can be retried without picking again.
  const sources = useRef(new Map<string, ImageDraft>());

  const patch = (key: string, change: Partial<FormPhoto>) => update((list) => list.map((p) => (p.key === key ? { ...p, ...change } : p)));

  const upload = async (key: string) => {
    const draft = sources.current.get(key);
    if (!draft) return;
    patch(key, { status: "uploading" });
    try {
      const done = await uploadDraft(draft);
      patch(key, { status: "ready", url: done.url, width: done.width, height: done.height });
    } catch {
      patch(key, { status: "failed" });
    }
  };

  const add = async () => {
    try {
      const { drafts, skipped } = await pickImages();
      if (skipped) Alert.alert(`${photoLabel(skipped)} left out`, "Photos over 10 MB can't be sent. Pick smaller ones.");
      if (drafts.length === 0) return;
      const added = drafts.map((d) => {
        const key = newKey();
        sources.current.set(key, d);
        return { key, previewUri: d.uri, url: null, width: d.width, height: d.height, status: "uploading" as const };
      });
      update((list) => [...list, ...added]);
      await runQueue(added, (p) => upload(p.key));
    } catch (e) {
      Alert.alert("Photos not added", e instanceof PickError ? e.message : "Something went wrong opening your photos. Try again.");
    }
  };

  const remove = (key: string) => {
    sources.current.delete(key);
    update((list) => list.filter((p) => p.key !== key));
  };

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginHorizontal: 2 }}>
        <ChatText variant="overline">Photos</ChatText>
        {photos.length ? <ChatText variant="caption">{photoLabel(photos.length)}</ChatText> : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {photos.map((p, i) => (
          <View key={p.key} style={{ width: THUMB, height: THUMB }}>
            <Pressable
              onPress={p.status === "failed" ? () => void upload(p.key) : undefined}
              disabled={p.status !== "failed"}
              accessibilityRole={p.status === "failed" ? "button" : "image"}
              accessibilityLabel={p.status === "failed" ? `Photo ${i + 1} failed to upload. Tap to try again` : `Photo ${i + 1}${p.status === "uploading" ? ", uploading" : ""}`}
              style={{ flex: 1, borderRadius: RADII.md, overflow: "hidden", backgroundColor: CHAT.surfaceAlt }}
            >
              <Image source={{ uri: p.previewUri }} contentFit="cover" style={{ flex: 1 }} />
              {p.status !== "ready" ? (
                <View
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: p.status === "failed" ? "rgba(180,30,40,0.55)" : "rgba(0,0,0,0.35)",
                  }}
                >
                  {p.status === "uploading" ? <ActivityIndicator color="#fff" /> : <Ionicons name="refresh" size={24} color="#fff" />}
                </View>
              ) : null}
            </Pressable>
            <Pressable
              onPress={() => remove(p.key)}
              disabled={disabled}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${i + 1}`}
              style={{ position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: CHAT.night, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: CHAT.surface }}
            >
              <Ionicons name="close" size={13} color="#fff" />
            </Pressable>
          </View>
        ))}
        <Pressable
          onPress={() => void add()}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Add photos"
          accessibilityHint="Pick as many photos as you like"
          style={({ pressed }) => ({
            width: THUMB,
            height: THUMB,
            borderRadius: RADII.md,
            borderWidth: 1.5,
            borderStyle: "dashed",
            borderColor: b.brand,
            backgroundColor: pressed ? b.brandSoft : CHAT.surface,
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
          })}
        >
          <Ionicons name="images-outline" size={22} color={b.brandText} />
          <ChatText variant="caption" color={b.brandText}>
            Add
          </ChatText>
        </Pressable>
      </View>
      <ChatText variant="footnote" style={{ marginHorizontal: 2 }}>
        Sent after the message, one photo at a time, in this order.
      </ChatText>
    </View>
  );
}

/** A list row's preview: the first few photos and "+N". */
export function SavedReplyPhotoStrip({ images }: { images: SavedReplyImage[] }) {
  if (images.length === 0) return null;
  const shown = images.slice(0, STRIP_MAX);
  const more = images.length - shown.length;
  return (
    <View accessibilityLabel={photoLabel(images.length)} style={{ flexDirection: "row", gap: 4, marginTop: 2 }}>
      {shown.map((img) => (
        <Image key={img.url} source={{ uri: img.url }} contentFit="cover" style={{ width: 40, height: 40, borderRadius: RADII.sm, backgroundColor: CHAT.surfaceAlt }} />
      ))}
      {more > 0 ? (
        <View style={{ width: 40, height: 40, borderRadius: RADII.sm, backgroundColor: CHAT.surfaceAlt, alignItems: "center", justifyContent: "center" }}>
          <ChatText variant="caption">{`+${more}`}</ChatText>
        </View>
      ) : null}
    </View>
  );
}
