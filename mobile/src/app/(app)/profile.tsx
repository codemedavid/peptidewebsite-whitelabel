import { useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSignedIn } from "@/auth/SessionProvider";
import { useAccountPhoto, useSaveAccountProfile } from "@/features/account/useAccountProfile";
import { Avatar } from "@/features/community/components/Avatar";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { useOnline } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";

const NAME_MAX = 40; // lib/mobile/account-profile.ts
const NICKNAME_MAX = 24;
const AVATAR_SIZE = 108;

/** Your own profile: photo, name and nickname — owner, staff and customers alike. */
export default function ProfileScreen() {
  const t = useTheme();
  const online = useOnline();
  const { me } = useSignedIn();
  const account = me.account;
  const [name, setName] = useState(account.name);
  const [nickname, setNickname] = useState(account.nickname ?? "");
  const save = useSaveAccountProfile();
  const photo = useAccountPhoto();

  const tooShort = name.trim().length < 2;
  const dirty = name.trim() !== account.name || nickname.trim() !== (account.nickname ?? "");
  const preview = nickname.trim() || name.trim() || account.displayName;

  function submit() {
    save.mutate(
      { name: name.trim(), nickname: nickname.trim() || null },
      {
        onSuccess: () => router.back(),
        onError: (e) => Alert.alert("Profile not saved", e.message),
      },
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.photoBlock}>
          <Pressable
            onPress={photo.choose}
            disabled={!online || photo.busy}
            accessibilityRole="button"
            accessibilityLabel={account.avatarUrl ? "Change profile photo" : "Add a profile photo"}
            style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
          >
            <Avatar name={preview} hue={0} imageUrl={account.avatarUrl} size={AVATAR_SIZE} />
            <View style={[styles.cameraBadge, { backgroundColor: t.brand.primary, borderColor: t.colors.bg }]}>
              {photo.busy ? <ActivityIndicator size="small" color={t.brand.onPrimary} /> : <Ionicons name="camera" size={16} color={t.brand.onPrimary} />}
            </View>
          </Pressable>
          <AppText variant="heading" brandFont numberOfLines={1}>{preview}</AppText>
          <AppText variant="caption" color="muted" numberOfLines={1}>{me.actor.email}</AppText>
          {account.avatarUrl ? (
            <Pressable onPress={photo.confirmRemove} disabled={photo.busy} accessibilityRole="button" hitSlop={8}>
              <AppText variant="caption" color="muted" style={{ textDecorationLine: "underline" }}>Remove photo</AppText>
            </Pressable>
          ) : null}
        </View>

        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          maxLength={NAME_MAX}
          autoCapitalize="words"
          textContentType="name"
          autoComplete="name"
          error={name.length > 0 && tooShort ? "Use at least 2 characters." : null}
        />
        <Field
          label="Nickname (optional)"
          value={nickname}
          onChangeText={setNickname}
          maxLength={NICKNAME_MAX}
          autoCapitalize="words"
          hint="Shown instead of your name when set."
          placeholder="What people call you"
        />
        <Button label="Save profile" loading={save.isPending} disabled={!online || tooShort || !dirty || save.isPending} onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.xl, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  photoBlock: { alignItems: "center", gap: SPACE.xs, paddingVertical: SPACE.md },
  cameraBadge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
});
