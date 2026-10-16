import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useNow, useReducedMotion } from "@/features/community/hooks/useMotion";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { useCatalog } from "../../hooks";
import { liveStrip, type UrgencyTone } from "../../lib/group-buy";
import { useShop } from "../../ShopProvider";
import { groupBuyBand, LiveDot, URGENCY_COLOR } from "./GroupBuyParts";

const MINUTE = 60_000;
const ENTER_MS = 320;

type LiveStripViewProps = {
  headline: string;
  message: string;
  ctaLabel: string;
  statusLabel: string;
  tone: UrgencyTone;
  a11y: string;
  /** Absent = a static preview (the admin's editor). */
  onPress?: () => void;
};

/**
 * The strip itself — what customers see above the tab bar, and what the
 * admin's Group buys editor previews. Brand-tinted band, breathing LIVE dot,
 * headline over countdown + message, and a pill that says what tapping does.
 */
export function LiveStripView({ headline, message, ctaLabel, statusLabel, tone, a11y, onPress }: LiveStripViewProps) {
  const t = useTheme();
  const band = groupBuyBand(t.brand.primary);
  const body = (
    <LinearGradient colors={[band.top, band.bottom]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.band}>
      <View style={styles.live} importantForAccessibility="no-hide-descendants">
        <LiveDot live size={7} />
        <AppText variant="overline" color={band.text} style={styles.liveWord}>
          Live
        </AppText>
      </View>
      <View style={styles.copy}>
        <AppText variant="bodyStrong" color={band.text} numberOfLines={1}>
          {headline}
        </AppText>
        <AppText variant="caption" color={band.muted} numberOfLines={1}>
          <AppText variant="caption" color={URGENCY_COLOR[tone]}>
            {statusLabel}
          </AppText>
          {` · ${message}`}
        </AppText>
      </View>
      <View style={[styles.cta, { backgroundColor: band.text }]}>
        <AppText variant="label" color={band.bottom} numberOfLines={1}>
          {ctaLabel}
        </AppText>
        <Ionicons name="arrow-forward" size={14} color={band.bottom} />
      </View>
    </LinearGradient>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={a11y}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="Opens the group buy"
      style={({ pressed }) => ({ opacity: pressed ? 0.88 : 1 })}
    >
      {body}
    </Pressable>
  );
}

/**
 * Pinned above the customer tab bar on every tab while a group buy is open
 * and the owner left the strip on (Manage → Group buys → Live banner). Reads
 * the shop catalog the Shop tab already caches — no extra request.
 */
export function LiveGroupBuyStrip() {
  const { paths } = useShop();
  const catalog = useCatalog();
  const now = useNow(MINUTE);
  const round = catalog.data?.groupBuy;
  const strip = liveStrip(round, now);
  if (!strip || !round) return null;
  return (
    <SlideIn key={round.id}>
      <LiveStripView
        headline={strip.headline}
        message={strip.message}
        ctaLabel={strip.ctaLabel}
        statusLabel={strip.urgency.label}
        tone={strip.urgency.tone}
        a11y={strip.a11y}
        onPress={() => router.push(paths.groupBuy)}
      />
    </SlideIn>
  );
}

/** Rises in from the tab bar once per round; no motion under Reduce Motion. */
function SlideIn({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [enter] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) {
      enter.setValue(1);
      return;
    }
    Animated.timing(enter, { toValue: 1, duration: ENTER_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduced, enter]);
  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  return <Animated.View style={{ opacity: enter, transform: [{ translateY }] }}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  band: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    minHeight: 56,
    paddingVertical: SPACE.sm,
    paddingLeft: SPACE.sm,
    paddingRight: SPACE.md,
  },
  live: { flexDirection: "row", alignItems: "center" },
  liveWord: { marginLeft: -4 },
  copy: { flex: 1, gap: 1 },
  cta: { flexDirection: "row", alignItems: "center", gap: 4, height: 34, paddingHorizontal: SPACE.md, borderRadius: RADIUS.pill, maxWidth: 140 },
});
