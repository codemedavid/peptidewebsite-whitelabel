import { useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { pickAndUploadImage } from "../setup/ImageField";
import { AppText, type IconName } from "@/ui/primitives";

/** Shared pieces for the content editors (FAQ, Lab Results, Protocols, Reviews). */

/** The website's checkbox, as a tappable icon + optional label. */
export function Checkbox({ checked, label, a11yLabel, onPress }: { checked: boolean; label?: string; a11yLabel?: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={a11yLabel ?? label ?? "Select"}
      hitSlop={8}
      onPress={onPress}
      style={styles.check}
    >
      <Ionicons name={checked ? "checkbox" : "square-outline"} size={24} color={checked ? t.brand.link : t.colors.textMuted} />
      {label ? <AppText variant="label">{label}</AppText> : null}
    </Pressable>
  );
}

/** A square thumbnail, or a placeholder icon when there is no image. */
export function Thumb({ uri, icon, size = 64, label }: { uri: string; icon: IconName; size?: number; label: string }) {
  const t = useTheme();
  return (
    <View style={[styles.thumb, { width: size, height: size, backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={label} transition={120} />
      ) : (
        <Ionicons name={icon} size={Math.round(size * 0.4)} color={t.colors.textFaint} />
      )}
    </View>
  );
}

/** Full-screen image viewer (the website's review viewer / certificate click-through). */
export function ImageViewer({
  uri,
  title,
  onClose,
  children,
}: {
  uri: string;
  title: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.viewer, { paddingTop: insets.top + SPACE.sm, paddingBottom: insets.bottom + SPACE.md }]}>
        <View style={styles.viewerBar}>
          <AppText variant="bodyStrong" color="#FFFFFF" numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
            {title}
          </AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose} style={styles.viewerClose}>
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </Pressable>
        </View>
        {uri ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1 }}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
          >
            <Image source={{ uri }} style={{ flex: 1, minHeight: 320 }} contentFit="contain" accessibilityLabel={title} />
          </ScrollView>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {children ? <View style={styles.viewerBody}>{children}</View> : null}
      </View>
    </Modal>
  );
}

/**
 * A capped image gallery: thumbnails with a remove button plus an "Add image"
 * tile (hidden at the cap). Each add uploads through the website's
 * uploadStorefrontImageAction, like the web's protocol gallery.
 */
export function GalleryEditor({
  images,
  max,
  label,
  onChange,
}: {
  images: readonly string[];
  max: number;
  label: string;
  onChange: (next: string[]) => void;
}) {
  const t = useTheme();
  const [uploading, setUploading] = useState(false);
  const atMax = images.length >= max;

  async function add() {
    try {
      const res = await pickAndUploadImage(() => setUploading(true));
      if (res) onChange([...images, res.url].slice(0, max));
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={styles.grid}>
      {images.map((src, k) => (
        <View key={`${src}-${k}`} style={[styles.tile, { borderColor: t.colors.border, backgroundColor: t.colors.surfaceAlt }]}>
          <Image source={{ uri: src }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={`${label} image ${k + 1}`} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${label} image ${k + 1}`}
            hitSlop={6}
            onPress={() => onChange(images.filter((_, idx) => idx !== k))}
            style={styles.tileRemove}
          >
            <Ionicons name="close" size={16} color="#FFFFFF" />
          </Pressable>
        </View>
      ))}
      {!atMax ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add image"
          disabled={uploading}
          onPress={() => void add()}
          style={({ pressed }) => [
            styles.tile,
            styles.tileAdd,
            { borderColor: t.colors.border, backgroundColor: t.colors.surface },
            pressed ? { opacity: 0.7 } : null,
          ]}
        >
          {uploading ? (
            <ActivityIndicator color={t.brand.link} />
          ) : (
            <>
              <Ionicons name="add" size={22} color={t.brand.link} />
              <AppText variant="caption" color="link">
                Add image
              </AppText>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const TILE = 96;

const styles = StyleSheet.create({
  check: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, minHeight: 40 },
  thumb: { borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  viewer: { flex: 1, backgroundColor: "#000000" },
  viewerBar: { flexDirection: "row", alignItems: "center", gap: SPACE.md, paddingHorizontal: SPACE.lg, minHeight: TOUCH },
  viewerClose: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" },
  viewerBody: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.md, gap: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  tile: { width: TILE, height: TILE, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  tileAdd: { alignItems: "center", justifyContent: "center", gap: 2, borderStyle: "dashed", borderWidth: 1 },
  tileRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
});
