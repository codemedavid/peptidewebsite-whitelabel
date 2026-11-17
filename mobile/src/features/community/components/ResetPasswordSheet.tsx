import { useState } from "react";
import { Pressable, ScrollView, Share, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useMutation } from "@tanstack/react-query";
import type { MemberPasswordResponse } from "@contract";
import { communityApi } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { CHAT, GUTTER, INTER, RADII, useChatBrand } from "../theme";
import { ChatButton, type IconName } from "./ChatKit";
import { ChatText } from "./ChatText";
import { Field, FormError } from "./Form";
import { Sheet } from "./Surfaces";

/** The website's customer password rule (CUSTOMER_PASSWORD_MIN). */
const MIN_LENGTH = 8;

type Mode = "generate" | "custom";

const OPTIONS: { mode: Mode; title: string; body: string; icon: IconName }[] = [
  { mode: "generate", title: "Make one for me", body: "10 easy-to-read letters and numbers.", icon: "sparkles-outline" },
  { mode: "custom", title: "I'll type one", body: `At least ${MIN_LENGTH} characters.`, icon: "create-outline" },
];

type Member = { customerId: string; name: string; email: string };

/**
 * Store team → a member who forgot their password. Pick a generated or typed
 * password, then see it ONCE with Copy and Send (the phone's share sheet, so it
 * goes out on whatever app the member messaged from). Passwords are never
 * shown or stored in plain text anywhere else — this is the only moment.
 */
export function ResetPasswordSheet({ member, onClose }: { member: Member | null; onClose: () => void }) {
  return (
    <Sheet visible={!!member} onClose={onClose} title="Reset password" subtitle={member ? `For ${member.name}` : undefined}>
      {member ? <ResetFlow key={member.customerId} member={member} onClose={onClose} /> : null}
    </Sheet>
  );
}

function ResetFlow({ member, onClose }: { member: Member; onClose: () => void }) {
  const b = useChatBrand();
  const { me } = useSignedIn();
  const [mode, setMode] = useState<Mode>("generate");
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);
  const reset = useMutation({
    mutationFn: () => communityApi.resetMemberPassword(member.customerId, mode === "custom" ? typed : undefined),
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  });

  const tooShort = mode === "custom" && typed.length > 0 && typed.length < MIN_LENGTH;
  const spaced = mode === "custom" && typed.trim() !== typed;
  const canSubmit = mode === "generate" || (typed.length >= MIN_LENGTH && !spaced);

  if (reset.data) return <Reveal result={reset.data} member={member} storeName={me.store.name} copied={copied} setCopied={setCopied} onDone={onClose} />;

  return (
    <ScrollView contentContainerStyle={{ padding: GUTTER, gap: 16 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: "row", gap: 10, padding: 12, borderRadius: RADII.md, backgroundColor: CHAT.surfaceAlt }}>
        <Ionicons name="lock-closed-outline" size={18} color={CHAT.inkMuted} style={{ marginTop: 1 }} />
        <ChatText variant="footnote" style={{ flex: 1 }}>
          Passwords are private, so no one can see the old one. Set a new one and send it to them. They&apos;ll be signed out
          on every device until they sign in with it.
        </ChatText>
      </View>

      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        {OPTIONS.map((o) => {
          const on = o.mode === mode;
          return (
            <Pressable
              key={o.mode}
              onPress={() => setMode(o.mode)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${o.title}. ${o.body}`}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: 14,
                borderRadius: RADII.lg,
                borderWidth: 1.5,
                borderColor: on ? b.brand : CHAT.hairline,
                backgroundColor: pressed ? CHAT.surfacePressed : on ? b.brandTint : CHAT.surface,
              })}
            >
              <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: on ? b.brand : CHAT.surfaceAlt }}>
                <Ionicons name={o.icon} size={18} color={on ? b.onBrand : CHAT.inkMuted} />
              </View>
              <View style={{ flex: 1, gap: 1 }}>
                <ChatText variant="bodyStrong">{o.title}</ChatText>
                <ChatText variant="footnote">{o.body}</ChatText>
              </View>
              <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? b.brandText : CHAT.inkFaint} />
            </Pressable>
          );
        })}
      </View>

      {mode === "custom" ? (
        <Field
          label="New password"
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          textContentType="newPassword"
          maxLength={200}
          hint={tooShort ? `${MIN_LENGTH - typed.length} more character${MIN_LENGTH - typed.length === 1 ? "" : "s"}` : spaced ? "Remove the space at the start or end." : `At least ${MIN_LENGTH} characters.`}
        />
      ) : null}

      <FormError message={reset.error?.message ?? null} />
      <ChatButton label="Set new password" icon="key-outline" size="lg" loading={reset.isPending} disabled={!canSubmit} onPress={() => reset.mutate()} />
    </ScrollView>
  );
}

function Reveal({
  result,
  member,
  storeName,
  copied,
  setCopied,
  onDone,
}: {
  result: MemberPasswordResponse;
  member: Member;
  storeName: string;
  copied: boolean;
  setCopied: (v: boolean) => void;
  onDone: () => void;
}) {
  const b = useChatBrand();
  const first = member.name.split(/\s+/)[0] || "there";
  const message =
    `Hi ${first}! Here's your new password for ${storeName}:\n\n${result.password}\n\n` +
    `Sign in to the app with ${member.email || "your email"} and this password, then change it in Me → Change password.`;

  const copy = async () => {
    await Clipboard.setStringAsync(result.password);
    setCopied(true);
    void Haptics.selectionAsync().catch(() => undefined);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: GUTTER, gap: 16, alignItems: "stretch" }}>
      <View style={{ alignItems: "center", gap: 8, paddingTop: 4 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: CHAT.successSoft }}>
          <Ionicons name="checkmark" size={30} color={CHAT.success} />
        </View>
        <ChatText variant="headline" accessibilityRole="header" style={{ textAlign: "center" }}>
          New password is ready
        </ChatText>
        <ChatText variant="footnote" style={{ textAlign: "center" }}>
          {`${member.name} is signed out until they use it.`}
        </ChatText>
      </View>

      <Pressable
        onPress={() => void copy()}
        accessibilityRole="button"
        accessibilityLabel={`New password ${result.password.split("").join(" ")}. Double tap to copy.`}
        style={({ pressed }) => ({
          alignItems: "center",
          gap: 6,
          paddingVertical: 18,
          paddingHorizontal: 12,
          borderRadius: RADII.lg,
          borderWidth: 1.5,
          borderStyle: "dashed",
          borderColor: b.brand,
          backgroundColor: pressed ? b.brandSoft : b.brandTint,
        })}
      >
        <ChatText selectable style={{ fontFamily: INTER.bold, fontSize: 26, letterSpacing: 3, color: CHAT.ink, fontVariant: ["tabular-nums"] }}>
          {result.password}
        </ChatText>
        <ChatText variant="caption" color={b.brandText}>
          {copied ? "Copied ✓" : "Tap to copy"}
        </ChatText>
      </Pressable>

      <View style={{ flexDirection: "row", gap: 8, padding: 12, borderRadius: RADII.md, backgroundColor: CHAT.warningSoft }}>
        <Ionicons name="eye-off-outline" size={16} color={CHAT.warning} style={{ marginTop: 1 }} />
        <ChatText variant="footnote" color={CHAT.warning} style={{ flex: 1 }}>
          This is the only time it&apos;s shown. Send it before you close this.
        </ChatText>
      </View>

      <ChatButton
        label={`Send to ${first}`}
        icon="paper-plane-outline"
        size="lg"
        onPress={() => void Share.share({ message }).catch(() => undefined)}
        accessibilityLabel={`Send the new password to ${member.name}`}
      />
      <ChatButton label={copied ? "Copied" : "Copy password"} icon={copied ? "checkmark" : "copy-outline"} tone="outline" onPress={() => void copy()} />
      <ChatButton label="Done" tone="ghost" onPress={onDone} />
    </ScrollView>
  );
}
