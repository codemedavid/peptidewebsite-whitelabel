import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSignedIn } from "@/auth/SessionProvider";
import { disablePush, enablePush, isPushEnabledHere, markAsked, permissionStatus, type PushSetup } from "@/notifications/push";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText, Button, Card, Pill, type IconName } from "@/ui/primitives";

function Benefit({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const t = useTheme();
  return (
    <View style={styles.benefit}>
      <View style={[styles.benefitIcon, { backgroundColor: t.tone("info").bg }]}>
        <Ionicons name={icon} size={20} color={t.tone("info").fg} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="caption" color="muted">{body}</AppText>
      </View>
    </View>
  );
}

/** Explains the benefit BEFORE the OS prompt; doubles as the on/off setting. */
export default function NotificationsScreen() {
  const t = useTheme();
  const { me } = useSignedIn();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<PushSetup | null>(null);

  useEffect(() => {
    void markAsked();
    void (async () => {
      setEnabled(await isPushEnabledHere());
      setDenied((await permissionStatus()) === "denied");
    })();
  }, []);

  async function turnOn() {
    setBusy(true);
    const res = await enablePush({ newOrders: me.can.orders, storeName: me.store.name });
    setBusy(false);
    if (res.ok) {
      setEnabled(true);
      setProblem(null);
      router.back();
    } else {
      setProblem(res);
      setDenied(res.reason === "denied");
    }
  }

  async function turnOff() {
    setBusy(true);
    await disablePush();
    setBusy(false);
    setEnabled(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={[styles.hero, { backgroundColor: t.brand.primary }]}>
          <Ionicons name="notifications" size={30} color={t.brand.onPrimary} />
        </View>
        <AppText variant="title" brandFont accessibilityRole="header">
          Never miss an order
        </AppText>
        <AppText variant="body" color="muted">
          {`Get a notification on this phone the moment ${me.store.name} receives an order.`}
        </AppText>

        <Card style={{ gap: SPACE.lg }}>
          <Benefit icon="flash-outline" title="Instant" body="Tap the alert to open the order and confirm it right away." />
          <Benefit icon="lock-closed-outline" title="Private on your lock screen" body="Only the order number shows — never the customer's name, items or amount." />
          <Benefit icon="phone-portrait-outline" title="Only this phone, only this store" body="Signing out or switching stores stops them here." />
        </Card>

        {enabled === null ? (
          <ActivityIndicator color={t.brand.link} />
        ) : enabled ? (
          <>
            <Pill tone="success" icon="checkmark-circle" label="On for this phone" />
            <Button label="Turn off on this phone" variant="secondary" loading={busy} onPress={() => void turnOff()} />
            <Button label="Done" variant="ghost" onPress={() => router.back()} />
          </>
        ) : (
          <>
            {problem && !problem.ok ? (
              <View style={[styles.problem, { backgroundColor: t.tone("warning").bg }]} accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle" size={18} color={t.tone("warning").fg} />
                <AppText variant="label" color={t.tone("warning").fg} style={{ flex: 1 }}>{problem.message}</AppText>
              </View>
            ) : null}
            {denied ? (
              <Button label="Open phone settings" icon="settings-outline" onPress={() => void Linking.openSettings()} />
            ) : (
              <Button label="Turn on notifications" icon="notifications" loading={busy} onPress={() => void turnOn()} />
            )}
            <Button label="Not now" variant="ghost" onPress={() => router.back()} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.xl, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  hero: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginTop: SPACE.lg },
  benefit: { flexDirection: "row", gap: SPACE.md, alignItems: "flex-start" },
  benefitIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  problem: { flexDirection: "row", gap: SPACE.sm, alignItems: "center", padding: SPACE.md, borderRadius: RADIUS.md },
});
