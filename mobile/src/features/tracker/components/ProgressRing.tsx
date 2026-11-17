/**
 * Progress meters (ported from MamaMicaGlow ProgressRing). The ring fills its
 * arc via strokeDashoffset; the bar via scaleX — no layout animation. Both
 * snap straight to the value under Reduce motion.
 */
import { useEffect, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { TRADIUS, useTrackerTheme } from "./theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const FILL_MS = 700;

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

type RingProps = {
  size: number;
  stroke: number;
  /** 0–1 */
  progress: number;
  color?: string;
  track?: string;
  /** Spoken, e.g. "3 of 4 doses taken today". */
  label?: string;
  children?: ReactNode;
};

export function ProgressRing({ size, stroke, progress, color, track, label, children }: RingProps) {
  const th = useTrackerTheme();
  const reduced = useReducedMotion();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = useSharedValue(0);

  useEffect(() => {
    const target = clamp01(progress);
    value.set(reduced ? target : withTiming(target, { duration: FILL_MS, easing: Easing.out(Easing.cubic) }));
  }, [progress, reduced, value]);

  const arcProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - value.get()) }));

  return (
    <View style={{ width: size, height: size }} accessible={!!label} accessibilityRole={label ? "progressbar" : undefined} accessibilityLabel={label}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={track ?? th.line} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color ?? th.brand}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={arcProps}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.centre]}>{children}</View>
    </View>
  );
}

type BarProps = { progress: number; color?: string; track?: string; height?: number; label?: string };

/** A thin horizontal meter (wizard steps, vial left). */
export function ProgressBar({ progress, color, track, height = 6, label }: BarProps) {
  const th = useTrackerTheme();
  const reduced = useReducedMotion();
  const value = useSharedValue(clamp01(progress));

  useEffect(() => {
    const target = clamp01(progress);
    value.set(reduced ? target : withTiming(target, { duration: FILL_MS, easing: Easing.out(Easing.cubic) }));
  }, [progress, reduced, value]);

  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: value.get() }] }));

  return (
    <View
      accessible={!!label}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamp01(progress) * 100) }}
      style={[styles.track, { height, backgroundColor: track ?? th.line }]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.fill, { backgroundColor: color ?? th.brand }, fill]} />
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: "center", justifyContent: "center" },
  track: { width: "100%", borderRadius: TRADIUS.pill, overflow: "hidden" },
  fill: { transformOrigin: "left", borderRadius: TRADIUS.pill },
});
