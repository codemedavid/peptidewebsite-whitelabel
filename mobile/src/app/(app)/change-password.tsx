import { useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { meApi } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { ChatButton } from "@/features/community/components/ChatKit";
import { ChatText } from "@/features/community/components/ChatText";
import { Field, FormError } from "@/features/community/components/Form";
import { NavBar } from "@/features/community/components/Headers";
import { CHAT, GUTTER, RADII, useChatBrand } from "@/features/community/theme";
import { useOnline } from "@/ui/feedback";

/** The website's customer rule (CUSTOMER_PASSWORD_MIN). */
const MIN_LENGTH = 8;

/** Four bars that fill as the new password gets longer and more varied. */
function strengthOf(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: "" };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(pw)).length;
  const score = pw.length < MIN_LENGTH ? 1 : Math.min(4, 1 + (pw.length >= 12 ? 1 : 0) + Math.max(0, kinds - 1));
  return { score, label: ["", "Too short", "Okay", "Good", "Strong"][score] };
}

/**
 * A member changes their own password — including the temporary one the store
 * sent after "Forgot password?". Same credential as the store's website; every
 * other phone and browser signed in to the account is signed out, this one stays.
 */
export default function ChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const b = useChatBrand();
  const online = useOnline();
  const { me } = useSignedIn();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const m = useMutation({
    mutationFn: () => meApi.changePassword(current, next),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setDone(true);
    },
  });

  const strength = strengthOf(next);
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSave = online && !!current && next.length >= MIN_LENGTH && next === confirm && !m.isPending;
  const barColor = [CHAT.hairline, CHAT.danger, CHAT.warning, b.brand, CHAT.success][strength.score];

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: CHAT.canvas }}>
        <NavBar title="Change password" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: GUTTER * 2, gap: 12 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: CHAT.successSoft }}>
            <Ionicons name="shield-checkmark" size={36} color={CHAT.success} />
          </View>
          <ChatText variant="title" accessibilityRole="header" style={{ textAlign: "center" }}>
            Password changed
          </ChatText>
          <ChatText variant="subhead" color={CHAT.inkMuted} style={{ textAlign: "center" }}>
            {`Use it next time you sign in, here and on ${me.store.name}'s website. Other devices have been signed out.`}
          </ChatText>
          <ChatButton label="Done" size="lg" onPress={() => router.back()} style={{ alignSelf: "stretch", marginTop: 12 }} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: CHAT.canvas }}>
      <NavBar title="Change password" />
      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: GUTTER, gap: 18, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <View style={{ flexDirection: "row", gap: 10, padding: 12, borderRadius: RADII.md, backgroundColor: b.brandTint }}>
          <Ionicons name="information-circle" size={18} color={b.brandText} style={{ marginTop: 1 }} />
          <ChatText variant="footnote" color={b.brandText} style={{ flex: 1 }}>
            Signed in with a temporary password from the store? Type it as your current password, then choose your own.
          </ChatText>
        </View>

        <Field
          label="Current password"
          icon="lock-closed-outline"
          value={current}
          onChangeText={setCurrent}
          secureTextEntry
          autoCapitalize="none"
          textContentType="password"
          autoComplete="current-password"
        />
        <View style={{ gap: 8 }}>
          <Field
            label="New password"
            icon="key-outline"
            value={next}
            onChangeText={setNext}
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
            autoComplete="new-password"
            hint={`At least ${MIN_LENGTH} characters.`}
          />
          {next ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }} accessible accessibilityLabel={`Password strength: ${strength.label}`}>
              <View style={{ flex: 1, flexDirection: "row", gap: 4 }}>
                {[1, 2, 3, 4].map((i) => (
                  <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= strength.score ? barColor : CHAT.hairline }} />
                ))}
              </View>
              <ChatText variant="caption" color={barColor} style={{ minWidth: 64, textAlign: "right", fontWeight: "600" }}>
                {strength.label}
              </ChatText>
            </View>
          ) : null}
        </View>
        <Field
          label="Confirm new password"
          icon="checkmark-done-outline"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoCapitalize="none"
          textContentType="newPassword"
          hint={mismatch ? "Passwords don't match yet." : undefined}
        />
        <FormError message={!online ? "You're offline." : (m.error?.message ?? null)} />
        <ChatButton label="Change password" size="lg" loading={m.isPending} disabled={!canSave} onPress={() => m.mutate()} />
      </KeyboardAwareScrollView>
    </View>
  );
}
