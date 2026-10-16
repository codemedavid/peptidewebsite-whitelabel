// The group buy's visual language, shared by the shop banner, the group-buy
// screen and the chat card: a "night band" tinted from the store's own primary
// colour (so every store's round looks like theirs), a pulsing live dot, a
// slot bar that fills on arrival, a ticking clock and a stack of product shots.
// Motion honours Reduce Motion everywhere.
import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useNow, useReducedMotion } from "@/features/community/hooks/useMotion";
import { mix, withAlpha } from "@/features/community/lib/color";
import { splitCountdown } from "@/features/community/lib/format";
import { sizedImage } from "../../lib/catalog";
import type { SlotMeter, UrgencyTone } from "../../lib/group-buy";

/** The band's colours, derived from the store's primary — dark enough for white text on any palette. */
export function groupBuyBand(primary: string) {
  return {
    top: mix(primary, "#000000", 0.62),
    bottom: mix(primary, "#000000", 0.8),
    glow: withAlpha(mix(primary, "#FFFFFF", 0.35), 0.35),
    text: "#FFFFFF",
    muted: "rgba(255,255,255,0.74)",
    faint: "rgba(255,255,255,0.52)",
    line: "rgba(255,255,255,0.14)",
    chip: "rgba(255,255,255,0.12)",
    fill: mix(primary, "#FFFFFF", 0.45),
    track: "rgba(255,255,255,0.16)",
  };
}
export type GroupBuyBandColors = ReturnType<typeof groupBuyBand>;

/** Urgency reads in words AND colour: amber when soon, hot on the last day. */
export const URGENCY_COLOR: Record<UrgencyTone, string> = {
  calm: "#9BE3B4",
  soon: "#FFC56B",
  last: "#FF8A6B",
  ended: "rgba(255,255,255,0.6)",
};

/** A small dot that breathes while the round is live. */
export function LiveDot({ color = "#4ADE80", live = true, size = 8 }: { color?: string; live?: boolean; size?: number }) {
  const reduced = useReducedMotion();
  // Lazy state, not a ref: an Animated.Value made once and read during render.
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!live || reduced) return;
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [live, reduced, pulse]);
  const ring = size * 2.4;
  return (
    <View style={{ width: ring, height: ring, alignItems: "center", justifyContent: "center" }} importantForAccessibility="no">
      {live && !reduced ? (
        <Animated.View
          style={{
            position: "absolute",
            width: ring,
            height: ring,
            borderRadius: ring / 2,
            backgroundColor: color,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
          }}
        />
      ) : null}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: live ? color : "rgba(255,255,255,0.5)" }} />
    </View>
  );
}

/** The slot-goal bar: fills from empty when it first shows (instantly with Reduce Motion). */
export function SlotBar({ meter, fill, track, height = 8 }: { meter: SlotMeter; fill: string; track: string; height?: number }) {
  const reduced = useReducedMotion();
  const [grow] = useState(() => new Animated.Value(reduced ? meter.pct : 0));
  useEffect(() => {
    if (reduced) {
      grow.setValue(meter.pct);
      return;
    }
    Animated.timing(grow, { toValue: meter.pct, duration: 900, delay: 150, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [meter.pct, reduced, grow]);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={meter.label}
      accessibilityValue={{ min: 0, max: 100, now: meter.pct }}
      style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: "hidden" }}
    >
      <Animated.View
        style={{ height, borderRadius: height / 2, backgroundColor: fill, width: grow.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }) }}
      />
    </View>
  );
}

/** "2 DAYS · 14 HRS · 33 MIN" — big tabular digits for the group-buy screen's hero. */
export function RoundClock({ endsAt, color, boxColor }: { endsAt: string; color: string; boxColor: string }) {
  const now = useNow(1000);
  const parts = splitCountdown(endsAt, now);
  if (!parts) return null;
  const units = [
    ...(parts.days > 0 ? [{ v: String(parts.days), u: parts.days === 1 ? "day" : "days" }] : []),
    { v: parts.hours, u: "hrs" },
    { v: parts.minutes, u: "min" },
    ...(parts.days > 0 ? [] : [{ v: parts.seconds, u: "sec" }]),
  ];
  const spoken = units.map((x) => `${Number(x.v)} ${x.u}`).join(", ");
  return (
    <View accessible accessibilityRole="timer" accessibilityLabel={`Closes in ${spoken}`} style={styles.clock}>
      {units.map((x) => (
        <View key={x.u} style={[styles.clockBox, { backgroundColor: boxColor }]}>
          <Text allowFontScaling={false} style={[styles.clockDigit, { color }]}>
            {x.v}
          </Text>
          <Text allowFontScaling={false} style={[styles.clockUnit, { color }]}>
            {x.u}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Overlapping round product photos ("what's in the round" at a glance). */
export function ImageStack({ images, size = 34, ring, style }: { images: string[]; size?: number; ring: string; style?: StyleProp<ViewStyle> }) {
  if (images.length === 0) {
    return (
      <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" }, style]}>
        <Ionicons name="people" size={size * 0.5} color="#fff" />
      </View>
    );
  }
  return (
    <View style={[{ flexDirection: "row" }, style]} importantForAccessibility="no-hide-descendants">
      {images.map((uri, i) => (
        <Image
          key={`${uri}-${i}`}
          source={{ uri: sizedImage(uri, size * 3) ?? uri }}
          contentFit="cover"
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderColor: ring,
            marginLeft: i === 0 ? 0 : -size * 0.32,
            backgroundColor: "rgba(255,255,255,0.14)",
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  clock: { flexDirection: "row", gap: 8 },
  clockBox: { minWidth: 58, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 12, alignItems: "center" },
  clockDigit: { fontFamily: "Inter_700Bold", fontSize: 24, lineHeight: 28, fontVariant: ["tabular-nums"] },
  clockUnit: { fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 14, opacity: 0.75, textTransform: "uppercase", letterSpacing: 0.6 },
});
