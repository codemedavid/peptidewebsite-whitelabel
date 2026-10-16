import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import Animated, {
  cancelAnimation,
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useSession } from "@/auth/SessionProvider";
import { APP_NAME, PRIVACY_URL, TERMS_URL } from "@/config";
import { withAlpha } from "@/features/community/lib/color";
import { Banner, PrimaryCta, SecondaryCta, TextLink, useAuthAccent, type AuthAccent } from "@/features/session/sign-in/parts";
import { HeroStage, SHEET_OVERLAP } from "@/features/session/welcome/HeroStage";
import { useStoreLink } from "@/store-link/StoreLinkProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";

/**
 * The front door. Signed out, this is all the app shows: what PepWorld is,
 * and two ways in — create an account or sign in. Shop, cart and community
 * all start after sign-in (root layout guards; GUEST_BROWSING in config).
 *
 * On a phone linked to a store it wears that store: its logo on the stage,
 * its name in the headline, its colour on the buttons.
 */

/**
 * The stage fills whatever the sheet leaves, so both doors (create account,
 * sign in) sit above the fold on short phones — within these bounds.
 */
const STAGE_MIN = 260;
const STAGE_MAX = 520;
/** Before the sheet is measured, assume it takes about this share. */
const SHEET_GUESS = 0.55;
/** Short phones (SE class) get a tighter headline. */
const SHORT_SCREEN = 720;
const SHEET_MAX_WIDTH = 480;
const SHEET_RADIUS = 32;
/** Sheet lines rise in one after another. */
const STAGGER_MS = 70;
const ENTER_BASE_MS = 160;
const ENTER_MS = 520;

const enter = (i: number) =>
  FadeInDown.duration(ENTER_MS).delay(ENTER_BASE_MS + i * STAGGER_MS).easing(Easing.out(Easing.cubic));

export default function Welcome() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const { state } = useSession();
  const { linked, unlink } = useStoreLink();
  const accent = useAuthAccent(!!linked);
  const notice = state.status === "signedOut" ? state.notice : undefined;

  // A store whose app holds no customer community: only its team signs in.
  const canCreateAccount = !linked || linked.customerSignIn;
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  const sheetGuess = sheetHeight ?? height * SHEET_GUESS;
  const stageHeight = Math.round(Math.min(STAGE_MAX, Math.max(STAGE_MIN, height - sheetGuess + SHEET_OVERLAP)));
  const short = height < SHORT_SCREEN;
  const copy = welcomeCopy(linked?.name ?? null, canCreateAccount);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.surface }}>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <ScrollView
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        style={{ backgroundColor: t.colors.bg }}
      >
        <HeroStage width={width} height={stageHeight} topInset={insets.top} accent={accent} store={linked} />

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: t.colors.surface,
              paddingBottom: insets.bottom + SPACE.xl,
              boxShadow: `0 -18px 40px -24px ${withAlpha(t.colors.text, 0.35)}`,
            },
          ]}
        >
          <View
            style={styles.sheetInner}
            onLayout={(e) =>
              // Content + the sheet's own padding = what the stage must leave room for.
              setSheetHeight(Math.ceil(e.nativeEvent.layout.height) + SPACE.xxl + insets.bottom + SPACE.xl)
            }
          >
            <Animated.View entering={enter(0)} style={styles.eyebrow}>
              <LiveDot color={accent.tint} />
              <AppText variant="overline" color={accent.link} numberOfLines={1} style={styles.shrink}>
                {copy.eyebrow}
              </AppText>
            </Animated.View>

            <Animated.View entering={enter(1)} style={styles.intro}>
              <AppText variant="display" accessibilityRole="header" style={short ? styles.titleShort : styles.title}>
                {copy.lead}
                <AppText variant="display" italic color={accent.link} style={short ? styles.titleShort : styles.title}>
                  {copy.emphasis}
                </AppText>
              </AppText>
              <AppText variant="body" color="muted">
                {copy.body}
              </AppText>
            </Animated.View>

            {notice ? (
              <Animated.View entering={enter(2)}>
                <Banner tone="info" icon="information-circle" text={notice} />
              </Animated.View>
            ) : null}

            <Animated.View entering={enter(3)} style={styles.ctas}>
              {canCreateAccount ? (
                <>
                  <PrimaryCta label="Create an account" accent={accent} onPress={() => router.push("/create-account")} />
                  <SecondaryCta
                    label="I already have an account"
                    icon="log-in-outline"
                    accessibilityHint="Opens sign in"
                    onPress={() => router.push("/sign-in")}
                  />
                </>
              ) : (
                <PrimaryCta label="Sign in" icon="log-in-outline" accent={accent} onPress={() => router.push("/sign-in")} />
              )}
            </Animated.View>

            {linked ? (
              <Animated.View entering={enter(4)} style={styles.center}>
                <TextLink label="Not your store? Change store" color={t.colors.textMuted} onPress={() => void unlink()} />
              </Animated.View>
            ) : null}

            <Animated.View entering={enter(5)}>
              <Legal accent={accent} />
            </Animated.View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

type WelcomeCopy = { eyebrow: string; lead: string; emphasis: string; body: string };

function welcomeCopy(storeName: string | null, canCreateAccount: boolean): WelcomeCopy {
  const app = APP_NAME.toUpperCase();
  if (!storeName) {
    return {
      eyebrow: `WELCOME TO ${app}`,
      lead: "Your favourite shops, ",
      emphasis: "all in one place.",
      body: "Shop new drops, join group buys, chat with the community and follow every order from checkout to your door.",
    };
  }
  return {
    eyebrow: `${storeName.toUpperCase()} · ON ${app}`,
    lead: "Welcome to ",
    emphasis: `${storeName}.`,
    body: canCreateAccount
      ? `Create a free account to shop, join group buys and chat with the ${storeName} community.`
      : `Sign in with your ${storeName} store team account to get started.`,
  };
}

/** Fine print with real links (the legal pages on the website). */
function Legal({ accent }: { accent: AuthAccent }) {
  const t = useTheme();
  const open = (url: string) => () => void WebBrowser.openBrowserAsync(url);
  // A raw fontWeight would drop Android to the system font — use the family.
  const link = [styles.legalLink, { color: accent.link, fontFamily: t.font.sansSemi }];
  return (
    <AppText variant="caption" color="faint" style={styles.legal}>
      By continuing, you agree to {APP_NAME}&apos;s{" "}
      <Text accessibilityRole="link" onPress={open(TERMS_URL)} style={link}>
        Terms
      </Text>{" "}
      and{" "}
      <Text accessibilityRole="link" onPress={open(PRIVACY_URL)} style={link}>
        Privacy Policy
      </Text>
      .
    </AppText>
  );
}

const PULSE_MS = 1800;

/** A small "live" dot with a ring that breathes out from it. */
function LiveDot({ color }: { color: string }) {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withTiming(1, { duration: PULSE_MS, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(pulse);
  }, [reduced, pulse]);
  const ring = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - pulse.value),
    transform: [{ scale: 1 + pulse.value * 1.6 }],
  }));
  return (
    <View style={styles.dotBox}>
      <Animated.View style={[styles.dotRing, { backgroundColor: color }, ring]} />
      <View style={[styles.dot, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1 },
  sheet: {
    flexGrow: 1,
    marginTop: -SHEET_OVERLAP,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    paddingTop: SPACE.xxl,
    paddingHorizontal: SPACE.xl,
  },
  sheetInner: { width: "100%", maxWidth: SHEET_MAX_WIDTH, alignSelf: "center", gap: SPACE.xl },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm + 2, marginBottom: -SPACE.sm },
  shrink: { flexShrink: 1 },
  intro: { gap: SPACE.md },
  title: { fontSize: 40, lineHeight: 44 },
  titleShort: { fontSize: 34, lineHeight: 38 },
  ctas: { gap: SPACE.md },
  center: { alignItems: "center", marginTop: -SPACE.md },
  legal: { textAlign: "center", paddingHorizontal: SPACE.md },
  legalLink: { textDecorationLine: "underline" },
  dotBox: { width: 10, height: 10, alignItems: "center", justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotRing: { position: "absolute", width: 8, height: 8, borderRadius: 4 },
});
