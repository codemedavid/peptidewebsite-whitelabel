import { useEffect } from "react";
import {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

/** Where a still (reduced-motion) drift rests: the middle of its swing. */
const REST = 0.5;

/**
 * A 0→1→0 swing, forever, eased like breathing. Held at rest when the person
 * asked the OS for less motion. Only transforms are driven from it.
 */
export function useSwing(duration: number, delay = 0): SharedValue<number> {
  const reduced = useReducedMotion();
  const progress = useSharedValue(REST);
  useEffect(() => {
    if (reduced) {
      progress.value = REST;
      return;
    }
    progress.value = 0;
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, true),
    );
    return () => cancelAnimation(progress);
  }, [reduced, duration, delay, progress]);
  return progress;
}

/** Drift up and down by `distance` px, tilting by up to `tilt` degrees. */
export function useFloat({
  distance,
  duration,
  delay = 0,
  tilt = 0,
}: {
  distance: number;
  duration: number;
  delay?: number;
  tilt?: number;
}) {
  const progress = useSwing(duration, delay);
  const style = useAnimatedStyle(() => {
    const swing = (progress.value - REST) * 2;
    return { transform: [{ translateY: swing * distance }, { rotate: `${swing * tilt}deg` }] };
  });
  return { progress, style };
}

/** One full turn every `duration` ms (`direction` -1 = counter-clockwise). */
export function useSpin(duration: number, direction: 1 | -1 = 1) {
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    turn.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [reduced, duration, turn]);
  return useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360 * direction}deg` }] }));
}
