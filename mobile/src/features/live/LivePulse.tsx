import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useReducedMotion } from "@/features/community/hooks/useMotion";

const PULSE_MS = 1_600;

/** The "live" dot: a soft ring breathes out of it while `active`. Still under Reduce Motion. */
export function LivePulse({ color, size = 10, active = true }: { color: string; size?: number; active?: boolean }) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active || reduced) {
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    progress.value = withRepeat(withTiming(1, { duration: PULSE_MS, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(progress);
  }, [active, reduced, progress]);

  const ring = useAnimatedStyle(() => ({
    opacity: active && !reduced ? 0.55 * (1 - progress.value) : 0,
    transform: [{ scale: 1 + progress.value * 1.8 }],
  }));

  const dot = { width: size, height: size, borderRadius: size / 2, backgroundColor: color };
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[StyleSheet.absoluteFill, dot, ring]} />
      <View style={dot} />
    </View>
  );
}
