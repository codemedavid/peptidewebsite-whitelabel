import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ApiError } from "@/api/client";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";
import { IconButton, Notice } from "./components";
import { askPhotoSource, pickPhotos, PhotoError, uploadProductPhoto, type PhotoSource } from "./images";
import {
  applyVariationPreset,
  assignVariationImages,
  blankVariation,
  makeMainPhoto,
  MAX_EXTRA_PHOTOS,
  withMainPhoto,
  VARIATION_PRESETS,
  type InclusionDraft,
  type VariationDraft,
} from "./product-form";

/** The product editor's list editors and photo field (AdminAddProduct.tsx's sub-components). */

type Update<T> = (fn: (prev: T) => T) => void;

/** Keep a numeric field typable: digits and (optionally) one decimal point. */
export function numeric(v: string, decimals = true): string {
  const cleaned = v.replace(decimals ? /[^0-9.]/g : /[^0-9]/g, "");
  if (!decimals) return cleaned;
  const [head, ...rest] = cleaned.split(".");
  return rest.length ? `${head}.${rest.join("")}` : head;
}

/** One AbortController per screen: an upload still running when the editor closes is cancelled. */
function useUploadSignal() {
  const ctrl = useRef(new AbortController());
  useEffect(() => () => ctrl.current.abort(), []);
  return ctrl.current.signal;
}

const isAbort = (e: unknown) => e instanceof ApiError && e.code === "aborted";

// ── Product image ────────────────────────────────────────────────────────────

export function ProductImageField({
  image,
  onChange,
  onBusy,
}: {
  image: string;
  onChange: (url: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const t = useTheme();
  const signal = useUploadSignal();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function upload(source: PhotoSource) {
    setError("");
    try {
      const picked = await pickPhotos(source);
      if (!picked?.[0]) return;
      setUploading(true);
      onBusy(true);
      onChange(await uploadProductPhoto(picked[0], signal));
    } catch (e) {
      if (!isAbort(e)) setError(e instanceof Error ? e.message : "Upload failed — please try again.");
    } finally {
      setUploading(false);
      onBusy(false);
    }
  }

  return (
    <View style={{ gap: SPACE.md }}>
      <View style={[styles.preview, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]}>
        {uploading ? (
          <View style={styles.previewEmpty}>
            <ActivityIndicator color={t.brand.link} />
            <AppText variant="caption" color="muted">
              Uploading…
            </AppText>
          </View>
        ) : image ? (
          <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel="Product image preview" />
        ) : (
          <View style={styles.previewEmpty}>
            <Ionicons name="image-outline" size={32} color={t.colors.textFaint} />
            <AppText variant="caption" color="muted">
              No image yet — optional
            </AppText>
          </View>
        )}
      </View>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <View style={styles.buttonRow}>
        <Button label="Take photo" icon="camera-outline" variant="secondary" disabled={uploading} onPress={() => void upload("camera")} style={{ flex: 1 }} />
        <Button label="Library" icon="images-outline" variant="secondary" disabled={uploading} onPress={() => void upload("library")} style={{ flex: 1 }} />
      </View>
      {image && !uploading ? <Button label="Remove image" variant="ghost" onPress={() => onChange("")} /> : null}
      <Field
        label="Or enter image URL"
        value={image.startsWith("data:") ? "" : image}
        onChangeText={onChange}
        placeholder="https://…"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        hint="JPG, PNG, WebP, GIF or HEIC — max 10 MB."
      />
    </View>
  );
}

// ── Extra photos ─────────────────────────────────────────────────────────────

/**
 * A row of extra photos: add several at once, reorder, promote to main, remove
 * (the website's PhotoStrip.tsx). Tap a photo for its actions. It edits the
 * EXTRAS only; `onMakeMain` lets the parent swap one with its main photo.
 */
export function PhotoStrip({
  photos,
  onChange,
  onMakeMain,
  onBusy,
  label,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  onMakeMain: (url: string) => void;
  onBusy: (busy: boolean) => void;
  /** Names the owner in labels ("the product", "Silk Barbie"). */
  label: string;
}) {
  const t = useTheme();
  const signal = useUploadSignal();
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const room = Math.max(0, MAX_EXTRA_PHOTOS - photos.length);

  // Sequential, like the website: the action takes one file, and a failure
  // part-way keeps the photos that already made it.
  async function add() {
    setError("");
    const source = await askPhotoSource(`More photos of ${label}`);
    if (!source) return;
    let picked;
    try {
      picked = await pickPhotos(source, source === "library");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open your photos.");
      return;
    }
    if (!picked?.length) return;
    const batch = picked.slice(0, room);
    onBusy(true);
    const urls: string[] = [];
    let firstError = "";
    for (const [i, photo] of batch.entries()) {
      setBusy({ done: i, total: batch.length });
      try {
        urls.push(await uploadProductPhoto(photo, signal));
      } catch (e) {
        if (isAbort(e)) break;
        if (!firstError) firstError = e instanceof Error ? e.message : "Upload failed.";
      }
    }
    setBusy(null);
    onBusy(false);
    if (urls.length) onChange([...photos, ...urls].slice(0, MAX_EXTRA_PHOTOS));
    if (firstError) setError(`${firstError} (${urls.length} of ${batch.length} uploaded)`);
    else if (picked.length > batch.length) setError(`Only ${MAX_EXTRA_PHOTOS} extra photos fit — ${picked.length - batch.length} skipped.`);
  }

  function move(from: number, delta: number) {
    const to = from + delta;
    if (to < 0 || to >= photos.length) return;
    const next = [...photos];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  }

  function actions(url: string, i: number) {
    Alert.alert(`Photo ${i + 2} of ${label}`, undefined, [
      { text: "Set as main photo", onPress: () => onMakeMain(url) },
      ...(i > 0 ? [{ text: "Move earlier", onPress: () => move(i, -1) }] : []),
      ...(i < photos.length - 1 ? [{ text: "Move later", onPress: () => move(i, 1) }] : []),
      { text: "Remove photo", style: "destructive" as const, onPress: () => onChange(photos.filter((u) => u !== url)) },
      { text: "Cancel", style: "cancel" as const },
    ]);
  }

  return (
    <View style={{ gap: SPACE.sm }}>
      <View style={styles.wrapRow}>
        {photos.map((url, i) => (
          <Pressable
            key={url}
            accessibilityRole="button"
            accessibilityLabel={`Photo ${i + 2} of ${label}`}
            accessibilityHint="Opens move, set as main and remove"
            disabled={busy !== null}
            onPress={() => actions(url, i)}
            style={[styles.stripTile, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]}
          >
            <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" />
          </Pressable>
        ))}
        {room > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add more photos of ${label}`}
            disabled={busy !== null}
            onPress={() => void add()}
            style={({ pressed }) => [
              styles.stripTile,
              styles.stripAdd,
              { borderColor: t.colors.border, backgroundColor: t.colors.surface, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            {busy ? (
              <AppText variant="caption" color="link">{`${busy.done + 1}/${busy.total}…`}</AppText>
            ) : (
              <>
                <Ionicons name="add" size={20} color={t.brand.link} />
                <AppText variant="caption" color="link">
                  Add
                </AppText>
              </>
            )}
          </Pressable>
        ) : null}
      </View>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </View>
  );
}

// ── Variations ───────────────────────────────────────────────────────────────

export function VariationsEditor({
  items,
  update,
  currency,
  showGbPrice,
  onBusy,
}: {
  items: VariationDraft[];
  update: Update<VariationDraft[]>;
  currency: string;
  /** Per-option group-buy price: only a group-buy product can carry one. */
  showGbPrice: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const t = useTheme();
  const signal = useUploadSignal();
  const [busyRow, setBusyRow] = useState<number | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const busy = busyRow !== null || bulk !== null;

  const patch = (i: number, p: Partial<VariationDraft>) => update((prev) => prev.map((it, j) => (j === i ? { ...it, ...p } : it)));
  const remove = (i: number) => update((prev) => prev.filter((_, j) => j !== i));

  async function rowPhoto(i: number) {
    const name = items[i]?.name.trim() || "this option";
    if (items[i]?.image) {
      const choice = await new Promise<"change" | "remove" | null>((resolve) =>
        Alert.alert(`Photo for ${name}`, undefined, [
          { text: "Change photo", onPress: () => resolve("change") },
          { text: "Remove photo", style: "destructive", onPress: () => resolve("remove") },
          { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
        ]),
      );
      if (choice === "remove") patch(i, { image: "" });
      if (choice !== "change") return;
    }
    const source = await askPhotoSource(`Photo for ${name}`);
    if (!source) return;
    setError("");
    try {
      const picked = await pickPhotos(source);
      if (!picked?.[0]) return;
      setBusyRow(i);
      onBusy(true);
      const url = await uploadProductPhoto(picked[0], signal);
      patch(i, { image: url });
    } catch (e) {
      if (!isAbort(e)) setError(e instanceof Error ? e.message : "Upload failed — please try again.");
    } finally {
      setBusyRow(null);
      onBusy(false);
    }
  }

  /**
   * Every option's photo at once: upload one at a time (the action takes one
   * file), then match them to options by filename. A failure part-way keeps
   * the photos that already made it.
   */
  async function bulkPhotos() {
    setError("");
    let picked;
    try {
      picked = await pickPhotos("library", true);
    } catch (e) {
      setError(e instanceof PhotoError || e instanceof Error ? e.message : "Couldn't open your photos.");
      return;
    }
    if (!picked?.length) return;
    onBusy(true);
    const uploaded: { fileName: string; url: string }[] = [];
    let firstError = "";
    for (const [i, photo] of picked.entries()) {
      setBulk({ done: i, total: picked.length });
      try {
        uploaded.push({ fileName: photo.originalName, url: await uploadProductPhoto(photo, signal) });
      } catch (e) {
        if (isAbort(e)) break;
        if (!firstError) firstError = e instanceof Error ? e.message : "Upload failed.";
      }
    }
    setBulk(null);
    onBusy(false);
    if (uploaded.length) update((prev) => assignVariationImages(prev, uploaded));
    if (firstError) setError(`${firstError} (${uploaded.length} of ${picked.length} uploaded)`);
  }

  return (
    <View style={{ gap: SPACE.md }}>
      {items.map((it, i) => (
        <View key={i} style={[styles.variation, { borderColor: t.colors.border }]}>
          <View style={styles.variationHead}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={it.image ? `Change photo for ${it.name || "this option"}` : `Add a photo for ${it.name || "this option"}`}
              disabled={busy}
              onPress={() => void rowPhoto(i)}
              style={[styles.vThumb, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]}
            >
              {busyRow === i ? (
                <ActivityIndicator color={t.brand.link} />
              ) : it.image ? (
                <Image source={{ uri: it.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Ionicons name="camera-outline" size={20} color={t.colors.textFaint} />
              )}
            </Pressable>
            <View style={{ flex: 1 }}>
              <Field label="Option" value={it.name} onChangeText={(name) => patch(i, { name })} placeholder="e.g. 5mg" />
            </View>
            <View style={{ paddingTop: 26 }}>
              <IconButton icon="close" label={`Remove ${it.name || "this option"}`} tone="danger" disabled={busy} onPress={() => remove(i)} />
            </View>
          </View>
          <View style={styles.pair}>
            <View style={{ flex: 1 }}>
              <Field label={`Price (${currency})`} value={it.price} onChangeText={(v) => patch(i, { price: numeric(v) })} keyboardType="decimal-pad" placeholder="0" />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Stock"
                value={it.stock}
                onChangeText={(v) => patch(i, { stock: numeric(v, false) })}
                keyboardType="number-pad"
                placeholder="Shared"
                accessibilityHint="Leave blank to share the product's stock; enter a number to track this option separately."
              />
            </View>
          </View>
          <View style={{ gap: SPACE.xs }}>
            <AppText variant="caption" color="muted">
              {it.image || it.extraImages?.length ? "More photos of this option — tap one to move, set as main or remove." : "Add photos — the first becomes this option's main photo."}
            </AppText>
            <PhotoStrip
              photos={it.extraImages ?? []}
              label={it.name.trim() || "this option"}
              onBusy={onBusy}
              onChange={(extraImages) => patch(i, withMainPhoto(it.image, extraImages))}
              onMakeMain={(url) => patch(i, makeMainPhoto(it.image, it.extraImages ?? [], url))}
            />
          </View>
          {showGbPrice ? (
            <Field
              label={`Group buy price (${currency})`}
              value={it.gbPrice}
              onChangeText={(v) => patch(i, { gbPrice: numeric(v) })}
              keyboardType="decimal-pad"
              placeholder="None — sells at its own price"
            />
          ) : null}
        </View>
      ))}
      {items.length ? (
        <AppText variant="caption" color="faint">
          Blank stock shares the product's stock; a number tracks that option on its own.
        </AppText>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <View style={styles.wrapRow}>
        <Button label="Add variation" icon="add" variant="secondary" onPress={() => update((prev) => [...prev, blankVariation()])} />
        {VARIATION_PRESETS.filter((p) => !items.some((it) => it.name.trim().toLowerCase() === p.toLowerCase())).map((preset) => (
          <Button key={preset} label={preset} icon="add" variant="secondary" onPress={() => update((prev) => applyVariationPreset(prev, preset))} />
        ))}
      </View>
      {items.length > 1 ? (
        <Button
          label={bulk ? `Uploading ${bulk.done + 1} of ${bulk.total}…` : "Upload photos for all options"}
          icon="images-outline"
          variant="ghost"
          disabled={busy}
          accessibilityHint="Pick many photos — each is matched to the option whose name it shares."
          onPress={() => void bulkPhotos()}
        />
      ) : null}
    </View>
  );
}

// ── Complete-set inclusions ──────────────────────────────────────────────────

export function InclusionsEditor({ items, update }: { items: InclusionDraft[]; update: Update<InclusionDraft[]> }) {
  const patch = (i: number, p: Partial<InclusionDraft>) => update((prev) => prev.map((it, j) => (j === i ? { ...it, ...p } : it)));
  return (
    <View style={{ gap: SPACE.md }}>
      {items.map((it, i) => (
        <View key={i} style={styles.pair}>
          <View style={{ flex: 1 }}>
            <Field label="Item" value={it.name} onChangeText={(name) => patch(i, { name })} placeholder="e.g. Sterile water" />
          </View>
          <View style={{ width: 84 }}>
            <Field label="Qty" value={it.qty} onChangeText={(v) => patch(i, { qty: numeric(v, false) })} keyboardType="number-pad" />
          </View>
          <View style={{ paddingTop: 26 }}>
            <IconButton icon="close" label={`Remove ${it.name || "item"}`} tone="danger" onPress={() => update((prev) => prev.filter((_, j) => j !== i))} />
          </View>
        </View>
      ))}
      <Button label="Add inclusion" icon="add" variant="secondary" onPress={() => update((prev) => [...prev, { name: "", qty: "1" }])} />
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { height: 200, borderRadius: RADIUS.lg, borderWidth: 1, overflow: "hidden" },
  previewEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: SPACE.sm },
  buttonRow: { flexDirection: "row", gap: SPACE.md },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  variation: { gap: SPACE.md, paddingBottom: SPACE.md, borderBottomWidth: StyleSheet.hairlineWidth },
  variationHead: { flexDirection: "row", alignItems: "flex-start", gap: SPACE.md },
  vThumb: { width: 52, height: 52, marginTop: 25, borderRadius: RADIUS.md, borderWidth: 1, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  stripTile: { width: 64, height: 64, borderRadius: RADIUS.md, borderWidth: 1, overflow: "hidden" },
  stripAdd: { alignItems: "center", justifyContent: "center", borderStyle: "dashed" },
  pair: { flexDirection: "row", alignItems: "flex-start", gap: SPACE.md },
});
