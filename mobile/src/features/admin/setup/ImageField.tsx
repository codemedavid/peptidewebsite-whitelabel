import { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import { PickError, pickImage } from "@/features/community/hooks/usePickers";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { adminBridge, unwrap } from "../bridge";
import { AppText, Button } from "@/ui/primitives";

/**
 * Pick a photo and upload it through the website's uploadStorefrontImageAction
 * (the store's own ImageKit folder — or an inline data URL where hosting isn't
 * set up, exactly like the web). Resolves the hosted URL, or null when the
 * owner cancelled or it failed (the reason has already been shown).
 */
export async function pickAndUploadImage(onUploading?: () => void): Promise<{ url: string; name: string } | null> {
  let draft;
  try {
    // Store images (banners, certificates, QR codes) keep their full detail.
    draft = await pickImage("library", { lighten: false });
  } catch (e) {
    Alert.alert("Couldn't use that photo", e instanceof PickError ? e.message : "Please try another one.");
    return null;
  }
  if (!draft) return null;
  onUploading?.();
  try {
    const res = unwrap(
      await adminBridge.upload<{ url: string } | { error: string }>("uploadStorefrontImageAction", "file", {
        uri: draft.uri,
        name: draft.name,
        type: draft.mimeType,
      }),
    );
    return { url: res.url, name: draft.name };
  } catch (e) {
    Alert.alert("Upload failed", e instanceof Error ? e.message : "Please try again.");
    return null;
  }
}

/** Upload / replace / clear one image, with a preview. `validate` may veto an uploaded URL. */
export function ImageField({
  label,
  hint,
  value,
  onChange,
  validate,
  previewAspect = 1,
  disabled,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (url: string, fileName?: string) => void;
  /** Return a message to refuse the upload (e.g. too large to store). */
  validate?: (url: string) => string | null;
  previewAspect?: number;
  disabled?: boolean;
}) {
  const t = useTheme();
  const [uploading, setUploading] = useState(false);

  async function choose() {
    try {
      const res = await pickAndUploadImage(() => setUploading(true));
      if (!res) return;
      const problem = validate?.(res.url);
      if (problem) {
        Alert.alert("Couldn't use that image", problem);
        return;
      }
      onChange(res.url, res.name);
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={{ gap: SPACE.sm }}>
      <AppText variant="label" color="muted">
        {label}
      </AppText>
      <View style={[styles.preview, { aspectRatio: previewAspect, backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]}>
        {uploading ? (
          <View style={styles.center}>
            <ActivityIndicator color={t.brand.link} />
            <AppText variant="caption" color="muted">
              Uploading…
            </AppText>
          </View>
        ) : value ? (
          <Image source={{ uri: value }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel={`${label} preview`} />
        ) : (
          <View style={styles.center}>
            <Ionicons name="image-outline" size={28} color={t.colors.textFaint} />
            <AppText variant="caption" color="faint">
              No image yet
            </AppText>
          </View>
        )}
      </View>
      {hint ? (
        <AppText variant="caption" color="faint">
          {hint}
        </AppText>
      ) : null}
      <View style={styles.actions}>
        <Button
          label={value ? "Replace" : "Choose photo"}
          icon="cloud-upload-outline"
          variant="secondary"
          disabled={disabled || uploading}
          onPress={() => void choose()}
          style={{ flex: 1 }}
        />
        {value ? <Button label="Remove" variant="ghost" disabled={disabled || uploading} onPress={() => onChange("")} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { width: "100%", maxHeight: 320, borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  actions: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
});
