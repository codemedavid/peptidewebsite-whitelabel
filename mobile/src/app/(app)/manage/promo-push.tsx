import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PromoPushStatus } from "@contract";
import { ApiError } from "@/api/client";
import { promoApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { FormPage, Hint, Loadable, Section } from "@/features/admin/setup/ui";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { BrandMark } from "@/ui/BrandMark";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";

/**
 * Send a promo or event notification to the store's app customers
 * (server: lib/mobile/promo-push.ts). It reaches ONLY customers who turned on
 * "Promos & events" — App Store 4.5.4 — and is titled with the store's name.
 * At most 3 a day. The limits mirror the server's (Metro can't bundle server
 * runtime values); the server re-checks everything.
 */
const HEADLINE_MAX = 60;
const MESSAGE_MAX = 180;
const DAILY_CAP = 3;

const timeOf = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

export default function PromoPushScreen() {
  const { scope } = useSignedIn();
  const status = useQuery({ queryKey: qk.promoPush(scope), queryFn: promoApi.status });
  return (
    <>
      <Stack.Screen options={{ title: "Promo notification" }} />
      <Loadable query={status}>{(s) => <Composer status={s} />}</Loadable>
    </>
  );
}

function Composer({ status }: { status: PromoPushStatus }) {
  const t = useTheme();
  const { me, scope } = useSignedIn();
  const queryClient = useQueryClient();
  const [headline, setHeadline] = useState("");
  const [message, setMessage] = useState("");
  const store = me.store.name;
  const send = useMutation({
    mutationFn: () => promoApi.send({ headline: headline.trim(), message: message.trim() }),
    onSuccess: (res) => {
      setHeadline("");
      setMessage("");
      void queryClient.invalidateQueries({ queryKey: qk.promoPush(scope) });
      Alert.alert("Sent", res.recipients === 1 ? "It's on its way to 1 phone." : `It's on its way to ${res.recipients} phones.`);
    },
    onError: (e) => Alert.alert("Couldn't send", e instanceof ApiError ? e.message : "Check your connection and try again."),
  });

  const ready = headline.trim().length > 0 && message.trim().length > 0;
  const canSend = ready && status.sendsLeft > 0 && !send.isPending;
  const previewBody = `${headline.trim() || "Your headline"} — ${message.trim() || "your message"}`;

  const confirmSend = () =>
    Alert.alert(
      "Send this notification?",
      status.audience === 0
        ? "Nobody has turned on Promos & events yet, so no phone will get it. It still counts toward today's 3."
        : `It goes to ${status.audience === 1 ? "1 phone" : `${status.audience} phones`} right away. You can't unsend it.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Send", onPress: () => send.mutate() },
      ],
    );

  return (
    <FormPage
      footer={
        <View style={{ gap: SPACE.sm }}>
          <Button label={send.isPending ? "Sending…" : "Send notification"} icon="paper-plane" loading={send.isPending} disabled={!canSend} onPress={confirmSend} />
          <AppText variant="caption" color="faint" style={{ textAlign: "center" }}>
            {status.sendsLeft > 0
              ? `${status.sendsLeft} of ${DAILY_CAP} left in the last 24 hours`
              : `Limit reached${status.nextFreeAt ? ` · next one ${timeOf(status.nextFreeAt)}` : ""}`}
          </AppText>
        </View>
      }
    >
      <Section title="Who gets it">
        <View style={styles.audience}>
          <View style={[styles.audienceIcon, { backgroundColor: t.tone(status.audience > 0 ? "success" : "neutral").bg }]}>
            <Ionicons name="phone-portrait-outline" size={20} color={t.tone(status.audience > 0 ? "success" : "neutral").fg} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{status.audience === 1 ? "1 phone" : `${status.audience} phones`}</AppText>
            <AppText variant="caption" color="muted">
              Customers who turned on Promos & events
            </AppText>
          </View>
        </View>
        <Hint>
          {status.audience === 0
            ? "Nobody has turned it on yet. Customers switch it on in the app under Me → Promos & events. Tell them in a drop or on your website."
            : "Only customers who said yes get promos, as Apple and Google require. They can turn it off any time."}
        </Hint>
      </Section>

      <Section title="Your message">
        <Field
          label="Headline"
          value={headline}
          onChangeText={(v) => setHeadline(v.slice(0, HEADLINE_MAX))}
          placeholder="11.11 Mega Sale"
          maxLength={HEADLINE_MAX}
          hint={`${headline.length}/${HEADLINE_MAX}`}
        />
        <Field
          label="Message"
          value={message}
          onChangeText={(v) => setMessage(v.slice(0, MESSAGE_MAX))}
          placeholder="20% off everything until Sunday. Shop now in the app."
          multiline
          maxLength={MESSAGE_MAX}
          hint={`${message.length}/${MESSAGE_MAX}`}
        />
      </Section>

      <Section title="Preview" hint="How it looks on a customer's lock screen. Tapping it opens your shop.">
        <View style={[styles.preview, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]} accessible accessibilityLabel={`Preview: ${store}. ${previewBody}`}>
          <View style={styles.previewHead}>
            <BrandMark size={20} />
            <AppText variant="caption" color="muted" style={{ flex: 1 }}>
              PEPWORLD
            </AppText>
            <AppText variant="caption" color="faint">
              now
            </AppText>
          </View>
          <AppText variant="bodyStrong">{store}</AppText>
          <AppText variant="body" color={headline || message ? "default" : "faint"} numberOfLines={4}>
            {previewBody}
          </AppText>
        </View>
      </Section>

      {status.recent.length > 0 ? (
        <Section title="Sent before">
          {status.recent.map((r) => (
            <View key={r.id} style={styles.recent}>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {r.headline}
                </AppText>
                <AppText variant="caption" color="muted" numberOfLines={2}>
                  {r.message}
                </AppText>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <AppText variant="caption" color="faint">
                  {timeOf(r.sentAt)}
                </AppText>
                <AppText variant="caption" color="muted">
                  {r.recipients === 1 ? "1 phone" : `${r.recipients} phones`}
                </AppText>
              </View>
            </View>
          ))}
        </Section>
      ) : null}
    </FormPage>
  );
}

const styles = StyleSheet.create({
  audience: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  audienceIcon: { width: 40, height: 40, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center" },
  preview: { borderRadius: 18, borderWidth: 1, padding: SPACE.md, gap: 2 },
  previewHead: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, marginBottom: 4 },
  recent: { flexDirection: "row", gap: SPACE.md, alignItems: "flex-start" },
});
