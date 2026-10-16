import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { UploadFile } from "@/api/client";
import { withAlpha } from "@/features/community/lib/color";
import { PickError, pickImage, type ImageSource } from "@/features/community/hooks/usePickers";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";

const AVATAR = 96;
const BADGE = 32;

type PhotoPickerProps = {
  photo: UploadFile | null;
  onChange: (photo: UploadFile | null) => void;
  /** The screen's accent (focus/link colour). */
  accent: string;
  disabled?: boolean;
};

/**
 * The optional profile photo on Create account: a round slot that opens
 * library / camera, shows the pick, and can be changed or removed. Nothing is
 * uploaded here — the photo goes up once the account exists (it needs the
 * new session), so a cancelled sign-up leaves nothing behind.
 */
export function PhotoPicker({ photo, onChange, accent, disabled }: PhotoPickerProps) {
  const t = useTheme();

  async function pick(source: ImageSource) {
    try {
      const draft = await pickImage(source);
      if (draft) onChange({ uri: draft.uri, name: draft.name, type: draft.mimeType });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Please try another photo.";
      Alert.alert(e instanceof PickError ? "Can't use that photo" : "Photo not added", message);
    }
  }

  function choose() {
    void Haptics.selectionAsync().catch(() => undefined);
    const options = [
      { text: "Choose from library", onPress: () => void pick("library") },
      { text: "Take a photo", onPress: () => void pick("camera") },
      ...(photo ? [{ text: "Remove photo", style: "destructive" as const, onPress: () => onChange(null) }] : []),
      { text: "Cancel", style: "cancel" as const },
    ];
    Alert.alert("Profile photo", undefined, options);
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={photo ? "Change profile photo" : "Add a profile photo (optional)"}
        disabled={disabled}
        onPress={choose}
        style={({ pressed }) => [styles.slot, { opacity: pressed ? 0.75 : 1 }]}
      >
        {photo ? (
          <Image source={{ uri: photo.uri }} contentFit="cover" style={styles.avatar} accessibilityIgnoresInvertColors />
        ) : (
          <View
            style={[
              styles.avatar,
              styles.empty,
              { backgroundColor: withAlpha(accent, 0.08), borderColor: withAlpha(accent, 0.45) },
            ]}
          >
            <Ionicons name="person" size={AVATAR * 0.44} color={withAlpha(accent, 0.55)} />
          </View>
        )}
        <View style={[styles.badge, { backgroundColor: accent, borderColor: t.colors.bg }]}>
          <Ionicons name={photo ? "pencil" : "camera"} size={15} color="#FFFFFF" />
        </View>
      </Pressable>
      <AppText variant="caption" color="muted">
        {photo ? "Tap to change your photo" : "Add a profile photo (optional)"}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: SPACE.sm },
  slot: { width: AVATAR, height: AVATAR },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
  empty: { borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
});
