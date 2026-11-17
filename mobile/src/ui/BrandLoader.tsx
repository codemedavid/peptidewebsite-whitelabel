import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { MobileSplash } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { AppText } from "./primitives";

/**
 * The store's loading screen — the app's twin of the website's brand splash
 * (src/storefront/components/BrandSplash.tsx): the store's mark on its own
 * backdrop, animated with the design the operator picked, plus the optional
 * tagline. Colours and design come from theme.splash (/me.theme.splash, or the
 * linked store's preview before sign-in), so every store loads in its own look.
 *
 * Reduced motion: the mark holds still and the ring/bar stop moving; a static
 * indicator still shows, so the screen reads as "loading", not "empty".
 */

const MARK_SIZE = 96;
const RING_GAP = 14;
const RING_WIDTH = 3;
const BAR_WIDTH = 132;
const BAR_HEIGHT = 3;
const SPIN_MS = 900;
const PULSE_MS = 900;
const BAR_MS = 1100;
const FADE_MS = 600;

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "·"
  );
}

function Mark({ splash, name, fontFamily }: { splash: MobileSplash; name: string; fontFamily: string }) {
  const [failed, setFailed] = useState(false);
  if (splash.logoUrl && !failed) {
    return (
      <Image
        source={{ uri: splash.logoUrl }}
        accessibilityIgnoresInvertColors
        contentFit="contain"
        onError={() => setFailed(true)}
        style={{ width: MARK_SIZE, height: MARK_SIZE, borderRadius: MARK_SIZE * 0.22 }}
      />
    );
  }
  return (
    <View style={[styles.mono, { backgroundColor: splash.accent }]}>
      <AppText style={{ color: splash.background, fontFamily, fontSize: MARK_SIZE * 0.38, lineHeight: MARK_SIZE * 0.48 }}>
        {initialsOf(name)}
      </AppText>
    </View>
  );
}

/** A spinning arc around the mark ("ring"). */
function Ring({ color, still }: { color: string; still: boolean }) {
  const turn = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    turn.value = withRepeat(withTiming(1, { duration: SPIN_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [still, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
  const size = MARK_SIZE + RING_GAP * 2;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: RING_WIDTH,
          borderColor: `${color}33`,
          borderTopColor: color,
        },
        spin,
      ]}
    />
  );
}

/** An indeterminate bar under the mark ("bar"). */
function Bar({ color, still }: { color: string; still: boolean }) {
  const x = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    x.value = withRepeat(withTiming(1, { duration: BAR_MS, easing: Easing.inOut(Easing.cubic) }), -1, false);
    return () => cancelAnimation(x);
  }, [still, x]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: (x.value * 2 - 1) * BAR_WIDTH * 0.75 }] }));
  return (
    <View style={[styles.barTrack, { backgroundColor: `${color}2E` }]}>
      <Animated.View style={[styles.barFill, { backgroundColor: color, left: still ? BAR_WIDTH * 0.3 : 0 }, still ? null : slide]} />
    </View>
  );
}

/** The mark's own motion: pulse (logo-pulse), a one-time fade in (fade, wordmark), or none. */
function useMarkMotion(design: MobileSplash["design"], still: boolean) {
  const v = useSharedValue(design === "fade" || design === "wordmark" ? 0 : 1);
  useEffect(() => {
    if (still) {
      v.value = 1;
      return;
    }
    if (design === "logo-pulse") {
      v.value = withRepeat(withSequence(withTiming(0.55, { duration: PULSE_MS }), withTiming(1, { duration: PULSE_MS })), -1, false);
    } else if (design === "fade" || design === "wordmark") {
      v.value = withTiming(1, { duration: FADE_MS, easing: Easing.out(Easing.cubic) });
    }
    return () => cancelAnimation(v);
  }, [design, still, v]);
  return useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ scale: design === "logo-pulse" ? 0.94 + v.value * 0.06 : 1 }],
  }));
}

type BrandLoaderProps = {
  /** Accessible label; the store's name is added. */
  label?: string;
};

/** Full-screen branded loading. Fills its parent (use as a whole screen or an overlay). */
export function BrandLoader({ label = "Loading" }: BrandLoaderProps) {
  const t = useTheme();
  const splash = t.splash;
  const still = useReducedMotion();
  const markMotion = useMarkMotion(splash.design, still);
  const a11y = `${label} ${t.brand.name}`;

  // The operator turned the splash off: a plain spinner on the theme, like the website's unbranded wait.
  if (!splash.enabled) {
    return (
      <View accessible accessibilityRole="progressbar" accessibilityLabel={a11y} style={[styles.fill, { backgroundColor: t.colors.bg }]}>
        <ActivityIndicator color={t.brand.link} />
      </View>
    );
  }

  const isWordmark = splash.design === "wordmark";
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={a11y} style={[styles.fill, { backgroundColor: splash.background }]}>
      <View style={styles.markBox}>
        {splash.design === "ring" ? <Ring color={splash.accent} still={still} /> : null}
        <Animated.View style={markMotion}>
          {isWordmark ? (
            <AppText
              numberOfLines={2}
              style={{ color: splash.text, fontFamily: t.font.serif, fontSize: 34, lineHeight: 40, textAlign: "center", maxWidth: 300 }}
            >
              {t.brand.name}
            </AppText>
          ) : (
            <Mark splash={splash} name={t.brand.name} fontFamily={t.font.serif} />
          )}
        </Animated.View>
      </View>
      {splash.design === "bar" ? <Bar color={splash.accent} still={still} /> : null}
      {splash.tagline ? (
        <AppText style={{ color: splash.text, fontFamily: t.font.sansMedium, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 18, maxWidth: 280 }}>
          {splash.tagline}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  markBox: {
    width: MARK_SIZE + RING_GAP * 2,
    minHeight: MARK_SIZE + RING_GAP * 2,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: { position: "absolute" },
  mono: { width: MARK_SIZE, height: MARK_SIZE, borderRadius: MARK_SIZE * 0.28, alignItems: "center", justifyContent: "center" },
  barTrack: { width: BAR_WIDTH, height: BAR_HEIGHT, borderRadius: BAR_HEIGHT, overflow: "hidden", marginTop: 22 },
  barFill: { position: "absolute", top: 0, bottom: 0, width: BAR_WIDTH * 0.4, borderRadius: BAR_HEIGHT },
});
