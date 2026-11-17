/**
 * First open of the Tracker tab (TRACKER.md §4 "First open"), three screens:
 *   1. what it does
 *   2. the disclaimer — "I understand" is required to continue (App Review 1.4.1)
 *   3. the notification ask (skippable) — asked here, never at app launch
 * Finishing marks the account's settings as onboarded (synced to every phone).
 */
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSignedIn } from "@/auth/SessionProvider";
import { ensureTrackerNotificationPermission } from "../../reminders";
import { BellIllustration, ShieldIllustration, TrackerIllustration } from "../Illustration";
import { haptic, PressButton, TText, type IconName } from "../kit";
import { markOnboarded } from "../onboarding-state";
import { trackerHref } from "../routes";
import { TOUCH_MIN, TRADIUS, TSPACE, useTrackerTheme } from "../theme";

export const DISCLAIMER_LINE = "For tracking only. Not medical advice. This app never suggests or recommends a dose. Talk to your doctor.";

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "timer-outline", title: "One tap to log", body: "A countdown to your next dose; log it with dose, site and vial filled in." },
  { icon: "body-outline", title: "Site rotation", body: "See which injection sites are ready and which need a rest." },
  { icon: "flask-outline", title: "Vials that count down", body: "Know how many doses are left and when a vial runs out." },
];

function finish(): void {
  markOnboarded();
  if (router.canGoBack()) router.back();
  else router.replace(trackerHref.home());
}

export function Onboarding() {
  const th = useTrackerTheme();
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  const [step, setStep] = useState(0);
  const [understood, setUnderstood] = useState(false);
  const [isAsking, setIsAsking] = useState(false);

  const allow = async () => {
    setIsAsking(true);
    await ensureTrackerNotificationPermission();
    setIsAsking(false);
    finish();
  };

  return (
    <View style={[styles.screen, { backgroundColor: th.bg, paddingTop: insets.top + TSPACE.md, paddingBottom: Math.max(insets.bottom, TSPACE.lg) }]}>
      <View style={styles.dots} accessible accessibilityLabel={`Step ${step + 1} of 3`}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.dot, { backgroundColor: i <= step ? th.brand : th.line, transform: [{ scaleX: i === step ? 2.4 : 1 }] }]} />
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {step === 0 ? (
          <>
            <TrackerIllustration size={170} />
            <TText variant="display" accessibilityRole="header" style={styles.center}>
              {`Your tracker, inside ${me.store.name}`}
            </TText>
            <View style={styles.features}>
              {FEATURES.map((f) => (
                <View key={f.title} style={styles.feature}>
                  <View style={[styles.featureIcon, { backgroundColor: th.brandSoft }]}>
                    <Ionicons name={f.icon} size={20} color={th.brandText} />
                  </View>
                  <View style={styles.fill}>
                    <TText variant="bodyStrong">{f.title}</TText>
                    <TText variant="meta" color="soft">
                      {f.body}
                    </TText>
                  </View>
                </View>
              ))}
            </View>
            <TText variant="meta" color="faint" style={styles.center}>
              {me.mode === "admin"
                ? "Saved on this phone and in your account. Only you see what you track: not your team, not your customers."
                : "Saved on this phone and in your account. The store never sees what you track."}
            </TText>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <ShieldIllustration size={140} />
            <TText variant="display" accessibilityRole="header" style={styles.center}>
              Before you start
            </TText>
            <View style={[styles.quote, { backgroundColor: th.surface, borderColor: th.line }]}>
              <TText variant="headline">{DISCLAIMER_LINE}</TText>
              <TText variant="body" color="soft">
                You enter every dose and schedule yourself; the amounts shown are the ones you enter. The tracker records what you tell it. It does not diagnose, treat or advise.
              </TText>
            </View>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: understood }}
              accessibilityLabel="I understand: tracking only, not medical advice"
              onPress={() => {
                haptic("select");
                setUnderstood((v) => !v);
              }}
              style={({ pressed }) => [styles.check, { borderColor: understood ? th.brand : th.line, backgroundColor: understood ? th.brandTint : th.surface }, pressed ? { opacity: 0.8 } : null]}
            >
              <View style={[styles.box, { borderColor: understood ? th.brand : th.inkFaint, backgroundColor: understood ? th.brand : "transparent" }]}>
                {understood ? <Ionicons name="checkmark" size={18} color={th.onBrand} /> : null}
              </View>
              <TText variant="bodyStrong" style={styles.fill}>
                I understand
              </TText>
            </Pressable>
            <PressButton label="Read the full disclaimer" tone="ghost" size="sm" onPress={() => router.push(trackerHref.disclaimer())} />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <BellIllustration size={150} />
            <TText variant="display" accessibilityRole="header" style={styles.center}>
              Never miss a dose
            </TText>
            <TText variant="body" color="soft" style={styles.center}>
              Get a reminder at each dose time, with Taken and Snooze right on the notification. Reminders are planned on this phone.
            </TText>
          </>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {step === 0 ? <PressButton label="Continue" trailingIcon="arrow-forward" onPress={() => setStep(1)} /> : null}
        {step === 1 ? (
          <PressButton label="Continue" trailingIcon="arrow-forward" isDisabled={!understood} accessibilityHint={understood ? undefined : "Tick I understand first"} onPress={() => setStep(2)} />
        ) : null}
        {step === 2 ? (
          <>
            <PressButton label="Turn on reminders" icon="notifications-outline" isLoading={isAsking} onPress={() => void allow()} />
            <PressButton label="Not now" tone="ghost" size="sm" onPress={finish} />
          </>
        ) : null}
        {step > 0 && !isAsking ? <PressButton label="Back" tone="ghost" size="sm" icon="chevron-back" onPress={() => setStep((s) => s - 1)} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: { flex: 1 },
  center: { textAlign: "center" },
  dots: { flexDirection: "row", justifyContent: "center", gap: TSPACE.md, paddingVertical: TSPACE.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  body: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: TSPACE.xl, paddingHorizontal: TSPACE.xl, paddingVertical: TSPACE.xl },
  features: { alignSelf: "stretch", gap: TSPACE.lg },
  feature: { flexDirection: "row", alignItems: "flex-start", gap: TSPACE.md },
  featureIcon: { width: 40, height: 40, borderRadius: TRADIUS.md, alignItems: "center", justifyContent: "center" },
  quote: { alignSelf: "stretch", gap: TSPACE.sm, padding: TSPACE.lg, borderRadius: TRADIUS.lg, borderWidth: StyleSheet.hairlineWidth },
  check: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: TSPACE.md, minHeight: TOUCH_MIN + 12, paddingHorizontal: TSPACE.lg, borderRadius: TRADIUS.md, borderWidth: 2 },
  box: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  footer: { paddingHorizontal: TSPACE.gutter, gap: TSPACE.sm },
});
