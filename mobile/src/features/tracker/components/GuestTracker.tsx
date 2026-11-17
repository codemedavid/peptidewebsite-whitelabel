/**
 * The Tracker tab for an app guest (Continue as guest): what the tracker does
 * and the way in. Nothing tracker-related is loaded or called — the server
 * refuses guests (TRACKER_GUEST_REFUSED) and the runtime isn't bound for them.
 */
import { ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSignedIn } from "@/auth/SessionProvider";
import { TrackerIllustration } from "./Illustration";
import { Card, DisclaimerFooter, PressButton, TText, type IconName } from "./kit";
import { trackerHref } from "./routes";
import { TRADIUS, TSPACE, useTrackerTheme } from "./theme";

const PERKS: { icon: IconName; text: string }[] = [
  { icon: "timer-outline", text: "A countdown to your next dose, logged in one tap" },
  { icon: "body-outline", text: "Injection-site rotation that remembers for you" },
  { icon: "flask-outline", text: "Vials that count down as you log" },
  { icon: "phone-portrait-outline", text: "Saved to your account, safe on a new phone" },
];

export function GuestTracker() {
  const th = useTrackerTheme();
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  return (
    <ScrollView style={{ backgroundColor: th.bg }} contentContainerStyle={styles.page}>
      <LinearGradient colors={[th.heroFrom, th.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, { paddingTop: insets.top + TSPACE.xl }]}>
        <TrackerIllustration size={140} onBrand />
        <TText variant="display" color="onBrand" accessibilityRole="header" style={styles.center}>
          Create your account to start tracking
        </TText>
        <TText variant="body" color="onBrandSoft" style={styles.center}>
          {`The tracker in ${me.store.name}’s app is free with an account. Your guest orders come with you.`}
        </TText>
      </LinearGradient>
      <Card style={styles.card}>
        {PERKS.map((p) => (
          <View key={p.text} style={styles.perk}>
            <View style={[styles.perkIcon, { backgroundColor: th.brandSoft }]}>
              <Ionicons name={p.icon} size={18} color={th.brandText} />
            </View>
            <TText variant="body" style={styles.fill}>
              {p.text}
            </TText>
          </View>
        ))}
        <PressButton label="Create a free account" icon="person-add-outline" onPress={() => router.push(trackerHref.createAccount())} />
        <PressButton label="I already have an account" tone="secondary" icon="log-in-outline" onPress={() => router.push(trackerHref.signIn())} />
      </Card>
      <View style={styles.footer}>
        <DisclaimerFooter />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: TSPACE.xxxl },
  fill: { flex: 1 },
  hero: { alignItems: "center", gap: TSPACE.md, paddingHorizontal: TSPACE.xl, paddingBottom: 64 },
  center: { textAlign: "center" },
  card: { marginTop: -40, marginHorizontal: TSPACE.gutter, borderRadius: TRADIUS.xl, gap: TSPACE.lg },
  perk: { flexDirection: "row", alignItems: "center", gap: TSPACE.md },
  perkIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  footer: { paddingHorizontal: TSPACE.gutter, marginTop: TSPACE.xl },
});
