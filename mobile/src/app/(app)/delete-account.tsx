import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useMutation } from "@tanstack/react-query";
import type { MeResponse } from "@contract";
import { meApi } from "@/api/endpoints";
import { useSession, useSignedIn } from "@/auth/SessionProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { useOnline } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button, Card } from "@/ui/primitives";

type Copy = { lead: string; points: string[]; keep: string; confirm: string };

/** What happens, in plain words — it differs for a shopper, an owner and staff. */
function copyFor(me: MeResponse): Copy {
  const store = me.store.name;
  if (me.mode === "customer") {
    return {
      lead: `Your ${store} account is deleted right away. This can't be undone.`,
      points: [
        "Your name, email, phone number and password",
        "Your profile photo, nickname and community membership",
        "What you posted in the community (it shows as from a former member, with the content removed)",
        "You're signed out on every phone",
      ],
      keep: `Your past orders stay with ${store} for its records, no longer linked to an account.`,
      confirm: "Your account and personal data will be deleted now.",
    };
  }
  if (me.actor.kind === "owner") {
    return {
      lead: "This sends a request to Pepweb to delete your owner login and your store's data.",
      points: [
        "Pepweb deletes your account and data within 30 days",
        `${store} stays as it is until then`,
        "You're signed out on every phone now",
      ],
      keep: "Changed your mind? Contact Pepweb support before the deletion is done.",
      confirm: "We'll send your request and sign you out on every phone.",
    };
  }
  return {
    lead: `This sends a request to delete your staff login at ${store}.`,
    points: ["Your login and personal details are deleted within 30 days", "You're signed out on every phone now"],
    keep: `The store and its orders belong to the owner and aren't affected.`,
    confirm: "We'll send your request and sign you out on every phone.",
  };
}

/** Start deleting your own account (Apple 5.1.1(v)) — owners, staff and customers. */
export default function DeleteAccount() {
  const t = useTheme();
  const online = useOnline();
  const { me } = useSignedIn();
  const { signOut } = useSession();
  const [password, setPassword] = useState("");
  const copy = copyFor(me);
  const danger = t.tone("danger");
  const m = useMutation({ mutationFn: () => meApi.deleteAccount(password) });

  function submit() {
    Alert.alert("Delete your account?", copy.confirm, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete account",
        style: "destructive",
        // Same teardown as Sign out (session, push token, query cache) — the
        // sign-in screen then shows the server's confirmation.
        onPress: () => m.mutate(undefined, { onSuccess: (res) => void signOut(res.message) }),
      },
    ]);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={[styles.banner, { backgroundColor: danger.bg }]}>
          <Ionicons name="warning-outline" size={22} color={danger.fg} />
          <AppText variant="bodyStrong" color={danger.fg} style={{ flex: 1 }}>
            {copy.lead}
          </AppText>
        </View>

        <Card style={styles.points}>
          {copy.points.map((point) => (
            <View key={point} style={styles.point}>
              <Ionicons name="close-circle-outline" size={18} color={danger.fg} style={styles.pointIcon} />
              <AppText variant="body" style={{ flex: 1 }}>
                {point}
              </AppText>
            </View>
          ))}
        </Card>
        <AppText variant="body" color="muted">
          {copy.keep}
        </AppText>

        <Field
          label="Enter your password to confirm"
          value={password}
          onChangeText={setPassword}
          password
          textContentType="password"
          autoComplete="current-password"
          error={m.isError ? m.error.message : null}
        />
        <Button
          label="Delete account"
          variant="danger"
          icon="trash-outline"
          loading={m.isPending}
          disabled={!online || !password.trim() || m.isPending}
          onPress={submit}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.xl, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  banner: { flexDirection: "row", alignItems: "flex-start", gap: SPACE.md, padding: SPACE.lg, borderRadius: RADIUS.lg },
  points: { gap: SPACE.md },
  point: { flexDirection: "row", alignItems: "flex-start", gap: SPACE.sm },
  pointIcon: { marginTop: 2 },
});
