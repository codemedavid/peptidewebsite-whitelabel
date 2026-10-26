import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE, TOUCH } from "@/theme/tokens";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";
import type { PromptAction, QueueRow } from "./model";

/** The decisions that need words first: a reason the member sees, or a refund reference. */

const COPY: Record<PromptAction, { title: string; label: string; placeholder: string; confirm: string; max: number }> = {
  reject: {
    title: "Reject this request",
    label: "Reason (the member sees this)",
    placeholder: "e.g. This round is for returning customers only",
    confirm: "Reject",
    max: 500,
  },
  reject_payment: {
    title: "Reject this proof",
    label: "What's wrong (the member sees this)",
    placeholder: "e.g. The amount on the receipt is short",
    confirm: "Reject proof",
    max: 500,
  },
  refund: {
    title: "Mark refunded",
    label: "Refund reference number",
    placeholder: "e.g. the GCash reference of your refund",
    confirm: "Mark refunded",
    max: 64,
  },
  revoke: {
    title: "Remove access",
    label: "Reason (the member sees this)",
    placeholder: "e.g. Shared the group-buy prices",
    confirm: "Remove access",
    max: 500,
  },
};

export type Prompt = { row: QueueRow; action: PromptAction };

type Props = {
  prompt: Prompt | null;
  roundName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (text: string) => void;
};

export function ReasonSheet({ prompt, roundName, busy, onCancel, onConfirm }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const copy = prompt ? COPY[prompt.action] : null;
  const close = () => {
    setText("");
    onCancel();
  };
  return (
    <Modal visible={!!prompt} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
        <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: t.colors.surface, paddingBottom: insets.bottom + SPACE.lg }]}>
          {copy && prompt ? (
            <>
              <AppText variant="heading">{copy.title}</AppText>
              <AppText variant="caption" color="muted">
                {roundName ? `${prompt.row.customerName} · ${roundName}` : prompt.row.customerName}
              </AppText>
              <Field
                label={copy.label}
                value={text}
                onChangeText={setText}
                placeholder={copy.placeholder}
                multiline={prompt.action !== "refund"}
                autoFocus
                maxLength={copy.max}
                autoCapitalize={prompt.action === "refund" ? "characters" : "sentences"}
              />
              <View style={styles.actions}>
                <Button label="Cancel" variant="secondary" onPress={close} style={styles.action} />
                <Button
                  label={copy.confirm}
                  variant={prompt.action === "refund" ? "primary" : "danger"}
                  loading={busy}
                  disabled={!text.trim()}
                  onPress={() => {
                    onConfirm(text.trim());
                    setText("");
                  }}
                  style={styles.action}
                />
              </View>
            </>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { padding: SPACE.lg, gap: SPACE.md, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  action: { flexGrow: 1, minHeight: TOUCH },
});
