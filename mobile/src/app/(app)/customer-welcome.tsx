import { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSignedIn } from "@/auth/SessionProvider";
import { communityAccess } from "@/features/community/lib/access";
import { enablePush, markAsked, permissionStatus, type PushSetup } from "@/notifications/push";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText, Button, Card, type IconName } from "@/ui/primitives";

type BenefitProps = { icon: IconName; title: string; body: string };

function Benefit({ icon, title, body }: BenefitProps) {
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

/** The community line: what chats mean for THIS shopper right now. */
function communityBenefit(store: string, access: ReturnType<typeof communityAccess>): BenefitProps | null {
  if (access.inCommunity) {
    return { icon: "chatbubbles-outline", title: "Chat with the store", body: `Messages, drops and group buys from ${store} land in Chats.` };
  }
  if (access.membershipCard === "pending") {
    return { icon: "hourglass-outline", title: "Community in review", body: `${store} checks every new member. We'll tell you the moment you're in.` };
  }
  return null;
}

/**
 * A customer's first sign-in on this phone: what the app does for them, and
 * the one ask that makes it work — notifications, asked here in shopper terms
 * BEFORE the OS prompt. Shown once (markAsked); Me → Notifications turns them
 * on later.
 */
export default function CustomerWelcome() {
  const t = useTheme();
  const { me } = useSignedIn();
  const store = me.store.name;
  const community = communityBenefit(store, communityAccess(me));
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [problem, setProblem] = useState<PushSetup | null>(null);

  useEffect(() => {
    void markAsked();
    void permissionStatus().then((s) => setDenied(s === "denied"));
  }, []);

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  async function turnOn() {
    setBusy(true);
    const res = await enablePush({ newOrders: false, storeName: store });
    setBusy(false);
    if (res.ok) {
      close();
      return;
    }
    setProblem(res);
    setDenied(res.reason === "denied");
  }

  const firstName = me.account.nickname || me.account.name.split(" ")[0] || me.account.displayName;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={[styles.hero, { backgroundColor: t.brand.primary }]}>
          <Ionicons name="sparkles" size={30} color={t.brand.onPrimary} />
        </View>
        <AppText variant="title" brandFont accessibilityRole="header">
          {`Welcome to ${store}, ${firstName}!`}
        </AppText>
        <AppText variant="body" color="muted">
          {"Your account is ready. It works here and on the store's website."}
        </AppText>

        <Card style={{ gap: SPACE.lg }}>
          <Benefit icon="storefront-outline" title="Shop the catalog" body="Browse, add to cart and check out right in the app." />
          <Benefit icon="receipt-outline" title="Track your orders" body="Payment, packing and tracking updates as they happen." />
          {community ? <Benefit {...community} /> : null}
        </Card>

        <AppText variant="bodyStrong">Get updates on this phone?</AppText>
        <AppText variant="caption" color="muted">
          {`We'll only notify you about your orders${community ? " and the store's messages" : ""}. Turn them off any time from Me.`}
        </AppText>

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
        <Button label="Not now, start shopping" variant="ghost" onPress={close} />
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
