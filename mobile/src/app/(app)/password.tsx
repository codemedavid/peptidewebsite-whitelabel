import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { meApi } from "@/api/endpoints";
import { SPACE } from "@/theme/tokens";
import { useOnline } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";

const MIN_LENGTH = 6; // the website's rule (changeStorefrontAdminPasswordAction)

/** Change your own password — the same rule and the same credential as the website. */
export default function ChangePassword() {
  const online = useOnline();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const m = useMutation({ mutationFn: () => meApi.changePassword(current, next) });

  const mismatch = confirm.length > 0 && confirm !== next;
  const tooShort = next.length > 0 && next.trim().length < MIN_LENGTH;
  const canSave = online && current && next.trim().length >= MIN_LENGTH && next === confirm && !m.isPending;

  function save() {
    m.mutate(undefined, {
      onSuccess: () => {
        Alert.alert("Password changed", "Use your new password on the website too. Other phones signed in to this account have been signed out.");
        router.back();
      },
    });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <AppText variant="body" color="muted">
          This is the same password you use for your website's admin.
        </AppText>
        <Field label="Current password" value={current} onChangeText={setCurrent} password textContentType="password" autoComplete="current-password" />
        <Field
          label="New password"
          value={next}
          onChangeText={setNext}
          password
          textContentType="newPassword"
          autoComplete="new-password"
          hint={`At least ${MIN_LENGTH} characters.`}
          error={tooShort ? `Use at least ${MIN_LENGTH} characters.` : null}
        />
        <Field
          label="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          password
          textContentType="newPassword"
          error={mismatch ? "Passwords don't match." : m.isError ? m.error.message : null}
        />
        <Button label="Change password" loading={m.isPending} disabled={!canSave} onPress={save} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.xl, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
});
