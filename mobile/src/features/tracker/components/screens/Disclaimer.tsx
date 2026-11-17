/**
 * The tracker's medical disclaimer (adapted from MamaMicaGlow
 * app/medical-disclaimer.tsx, tracker-specific). Reached from the Today
 * footer, onboarding and Tracker settings. Accurate for v1: tracking only, the
 * app never suggests or recommends a dose, and every amount is the user's own.
 */
import { ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSignedIn } from "@/auth/SessionProvider";
import { Card, IconButton, TText } from "../kit";
import { trackerHref } from "../routes";
import { TRADIUS, TSPACE, useTrackerTheme } from "../theme";
import { DISCLAIMER_LINE } from "./Onboarding";

type Section = { title: string; body: string; tone?: "highlight" | "warning" };

function sections(store: string): Section[] {
  return [
    { title: "A personal log", body: "The tracker records what you tell it: what you take, when, where, and how you feel. It is a diary and reminder tool, not a medical device." },
    {
      title: "No dose suggestions",
      body: "This app never suggests, recommends or adjusts a dose. Every amount in it is one you entered. It only records them and counts a vial down from the doses you log.",
      tone: "highlight",
    },
    {
      title: "Talk to your doctor",
      body: "Talk to a qualified healthcare provider before starting, stopping or changing anything you take. Nothing in this app replaces their advice.",
      tone: "highlight",
    },
    {
      title: "Store guides",
      body: `If you copy one of ${store}’s guides into a protocol, it becomes your own editable draft. Check every number with your doctor before saving it.`,
    },
    { title: "Estimates are estimates", body: "Any level chart is a rough estimate from a half-life you enter. It is not a measurement and not a reason to change a dose." },
    {
      title: "Your data",
      body: `Your tracker is saved on this phone and in your account, so it survives a new phone. ${store} cannot see it, and it is never used for marketing. You can remove it from this phone in Tracker settings.`,
    },
    { title: "Emergencies", body: "If you feel unwell or think something is wrong, contact a doctor or your local emergency number right away. Don’t rely on this app.", tone: "warning" },
  ];
}

function close(): void {
  if (router.canGoBack()) router.back();
  else router.replace(trackerHref.home());
}

export function Disclaimer() {
  const th = useTrackerTheme();
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  return (
    <View style={[styles.screen, { backgroundColor: th.bg }]}>
      <View style={[styles.bar, { paddingTop: TSPACE.md }]}>
        <TText variant="title" accessibilityRole="header" style={styles.fill}>
          Not medical advice
        </TText>
        <IconButton icon="close" label="Close" tone="alt" onPress={close} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TSPACE.xxl }]}>
        <View style={[styles.lead, { backgroundColor: th.brandTint, borderColor: th.brandSoft }]}>
          <Ionicons name="shield-checkmark-outline" size={26} color={th.brandText} />
          <TText variant="headline" style={styles.fill}>
            {DISCLAIMER_LINE}
          </TText>
        </View>
        {sections(me.store.name).map((s) => {
          const color = s.tone === "warning" ? th.status.missed.text : s.tone === "highlight" ? th.brandText : th.ink;
          return (
            <Card key={s.title} tone={s.tone === "warning" ? "alt" : "surface"}>
              <TText variant="headline" color={color} accessibilityRole="header">
                {s.title}
              </TText>
              <TText variant="body" color="soft">
                {s.body}
              </TText>
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: TSPACE.md, paddingHorizontal: TSPACE.gutter, paddingBottom: TSPACE.sm },
  content: { paddingHorizontal: TSPACE.gutter, gap: TSPACE.md },
  lead: { flexDirection: "row", alignItems: "flex-start", gap: TSPACE.md, padding: TSPACE.lg, borderRadius: TRADIUS.lg, borderWidth: 1 },
});
