import { useState } from "react";
import { Alert, Linking, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { BuyerChannelApp, OrderDetail } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { Field, Segmented } from "@/ui/inputs";
import { AppText, Button, Card, SectionLabel } from "@/ui/primitives";
import { useOnline } from "@/ui/feedback";
import { buyerChannelLink, linkCarriesText } from "./buyer-link";
import { OrderConflict, useUpdateOrder } from "./hooks";
import { STATUS_META } from "./status";

/**
 * Where the buyer reached the store (WhatsApp number / Telegram @username or
 * number) and the ready-to-send update for the order's current status. The
 * server validates the contact and writes the message (lib/orders/
 * buyer-update-message.ts), so the app and the website say the same thing.
 * Like the website, the owner can edit the message before sending (Reset
 * brings the server's text back); the chat link is rebuilt from the edit.
 */

const APP_LABEL: Record<BuyerChannelApp, string> = { whatsapp: "WhatsApp", telegram: "Telegram" };
const APP_SEGMENTS = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "telegram", label: "Telegram" },
] as const;
const SOURCE_HINT = {
  customer: "Remembered from this buyer's earlier order. Save to link it here too.",
  checkout: "The WhatsApp number the buyer typed at checkout. Save to confirm it.",
} as const;

type Props = { order: OrderDetail };

export function BuyerContactSection({ order }: Props) {
  const t = useTheme();
  const online = useOnline();
  const update = useUpdateOrder(order.id);
  const channel = order.buyerChannel ?? null;
  const saved = channel?.source === "order" ? channel : null;

  const [app, setApp] = useState<BuyerChannelApp>(channel?.app ?? "whatsapp");
  const [handle, setHandle] = useState(channel?.handle ?? "");
  const [isEditing, setIsEditing] = useState(!saved);
  const [error, setError] = useState<string | null>(null);

  // Light up after a status change so the buyer gets told.
  const [prevStatus, setPrevStatus] = useState(order.status);
  const [isNudged, setIsNudged] = useState(false);
  if (prevStatus !== order.status) {
    setPrevStatus(order.status);
    setIsNudged(true);
  }

  async function save(value: { app: BuyerChannelApp; handle: string } | null) {
    setError(null);
    try {
      const next = await update.mutateAsync({ buyerChannel: value });
      const stored = next.buyerChannel?.source === "order" ? next.buyerChannel : null;
      setIsEditing(!stored);
      if (stored) {
        setApp(stored.app);
        setHandle(stored.handle);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (e) {
      if (e instanceof OrderConflict) {
        Alert.alert("This order just changed", "We've loaded the latest version. Check it and save again.");
      } else {
        setError(e instanceof Error ? e.message : "Couldn't save. Please try again.");
      }
    }
  }

  const msg = order.buyerUpdate;
  const generated = msg?.text ?? "";
  // The draft follows the server's text; a status/tracking change replaces any
  // edits (they were written for the old status) — the website's rule.
  const [draft, setDraft] = useState(generated);
  const [basis, setBasis] = useState(generated);
  if (basis !== generated) {
    setBasis(generated);
    setDraft(generated);
  }
  const text = draft.trim();
  // Rebuilt from the edit; without a known channel there's nowhere to send.
  const url = channel ? buyerChannelLink(channel, text) : msg?.url ?? null;
  const pasteFirst = channel ? !linkCarriesText(channel.app) : !!msg?.pasteFirst;

  async function send() {
    if (!url || !text) return;
    if (pasteFirst) {
      await Clipboard.setStringAsync(text);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
    setIsNudged(false);
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(`Couldn't open ${APP_LABEL[channel?.app ?? "whatsapp"]}`, "Is the app installed? The message was copied. Paste it in the chat.");
      await Clipboard.setStringAsync(text);
    }
  }
  async function copy() {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }

  const brandTone = channel?.app === "telegram" ? "info" : "success";
  const sendLabel = !url ? "Add a contact to send" : pasteFirst ? "Copy & open Telegram" : "Send on WhatsApp";
  const needsTracking = order.status === "shipped" && !order.trackingNumber.trim();

  return (
    <View>
      <SectionLabel>Buyer contact & update</SectionLabel>
      <Card style={[{ gap: SPACE.md }, isNudged ? { borderColor: t.brand.accent, borderWidth: 2 } : null]}>
        {saved && !isEditing ? (
          <View style={[styles.saved, { backgroundColor: t.tone(brandTone).bg }]}>
            <Ionicons name={saved.app === "telegram" ? "paper-plane" : "logo-whatsapp"} size={20} color={t.tone(brandTone).fg} />
            <View style={{ flex: 1 }}>
              <AppText variant="caption" color="muted">{`Contacted you on ${APP_LABEL[saved.app]}`}</AppText>
              <AppText variant="bodyStrong" selectable>{saved.handle}</AppText>
            </View>
            <Button label="Change" variant="ghost" onPress={() => setIsEditing(true)} />
          </View>
        ) : (
          <View style={{ gap: SPACE.sm }}>
            <AppText variant="label" color="muted">Where did the buyer contact you?</AppText>
            <Segmented segments={APP_SEGMENTS} value={app} onChange={(k) => { setApp(k); setError(null); }} />
            <Field
              label={app === "whatsapp" ? "WhatsApp number" : "Telegram username or number"}
              value={handle}
              onChangeText={setHandle}
              placeholder={app === "whatsapp" ? "e.g. 0917 123 4567" : "@username or phone number"}
              keyboardType={app === "whatsapp" ? "phone-pad" : "default"}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={64}
              error={error}
              hint={channel && channel.source !== "order" ? SOURCE_HINT[channel.source] : undefined}
            />
            <Button
              label="Save contact"
              icon="checkmark"
              loading={update.isPending}
              disabled={!online || !handle.trim()}
              onPress={() => void save({ app, handle })}
            />
            {saved ? (
              <View style={styles.inline}>
                <Button label="Cancel" variant="ghost" onPress={() => setIsEditing(false)} style={{ flex: 1 }} />
                <Button label="Remove" variant="ghost" disabled={!online || update.isPending} onPress={() => void save(null)} style={{ flex: 1 }} />
              </View>
            ) : null}
          </View>
        )}

        {msg ? (
          <View style={[styles.msg, { borderTopColor: t.colors.border }]}>
            <View style={styles.inline}>
              <AppText variant="label" color="muted" style={{ flex: 1 }}>{`Update message · ${STATUS_META[order.status].label}`}</AppText>
              {isNudged ? <AppText variant="caption" color={t.tone("warning").fg}>Status changed. Tell the buyer</AppText> : null}
            </View>
            {needsTracking ? (
              <AppText variant="caption" color="muted">Add the tracking number and it will be included in this message.</AppText>
            ) : null}
            <Field
              label="Message to the buyer"
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={2000}
              hint={draft !== generated ? "Edited. Reset brings back the suggested message." : undefined}
            />
            <Button
              label={sendLabel}
              icon={pasteFirst ? "paper-plane" : "logo-whatsapp"}
              disabled={!url || !text}
              onPress={() => void send()}
            />
            <View style={styles.inline}>
              <Button label="Copy message" variant="ghost" icon="copy-outline" disabled={!text} onPress={() => void copy()} style={{ flex: 1 }} />
              {draft !== generated ? (
                <Button label="Reset" variant="ghost" icon="refresh" onPress={() => setDraft(generated)} style={{ flex: 1 }} />
              ) : null}
            </View>
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  saved: { flexDirection: "row", alignItems: "center", gap: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.md },
  inline: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  msg: { gap: SPACE.sm, paddingTop: SPACE.md, borderTopWidth: StyleSheet.hairlineWidth },
});
