/**
 * The tracker's toast: "Logged BPC-157 · Left lower belly — Undo", for five
 * seconds. Any screen can raise one (showTrackerToast) and the screen it lands
 * on shows it (mount <UndoToast /> once per screen that should). A toast older
 * than TOAST_STALE_MS is dropped, so coming back to a screen later never shows
 * yesterday's "Undo".
 */
import { useEffect, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import Ionicons from "@expo/vector-icons/Ionicons";
import { haptic, TText, type IconName } from "./kit";
import { TMOTION, TOUCH_MIN, TRADIUS, TSPACE, useTrackerTheme } from "./theme";

export type TrackerToast = {
  id: number;
  message: string;
  icon: IconName;
  /** Shown as an "Undo" button; runs once. */
  undo: (() => void) | null;
  createdAt: number;
};

const TOAST_STALE_MS = 8_000;

let current: TrackerToast | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

const toastStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot(): TrackerToast | null {
    return current;
  },
};

/** Too old to offer "Undo" any more (outside render: reads the clock). */
function isStale(toast: TrackerToast): boolean {
  return Date.now() - toast.createdAt > TOAST_STALE_MS;
}

/** Raise a toast (replaces any showing). */
export function showTrackerToast(input: { message: string; icon?: IconName; undo?: () => void }): void {
  seq += 1;
  current = { id: seq, message: input.message, icon: input.icon ?? "checkmark", undo: input.undo ?? null, createdAt: Date.now() };
  emit();
}

export function hideTrackerToast(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

/** Renders the current toast at the bottom of its screen (`bottom` = distance from the bottom edge). */
export function UndoToast({ bottom = TSPACE.lg }: { bottom?: number }) {
  const th = useTrackerTheme();
  const toast = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, toastStore.getSnapshot);

  useEffect(() => {
    if (!toast) return;
    const left = Math.max(0, TMOTION.toast - (Date.now() - toast.createdAt));
    const id = setTimeout(() => hideTrackerToast(toast.id), left);
    return () => clearTimeout(id);
  }, [toast]);

  if (!toast || isStale(toast)) return null;
  const undo = toast.undo;
  return (
    <Animated.View
      key={toast.id}
      entering={FadeInDown.duration(TMOTION.sheet)}
      exiting={FadeOutDown.duration(TMOTION.release)}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[styles.toast, { bottom, backgroundColor: th.ink }, th.shadow.float]}
    >
      <View style={[styles.icon, { backgroundColor: th.brand }]}>
        <Ionicons name={toast.icon} size={15} color={th.onBrand} />
      </View>
      <TText variant="bodyStrong" color={th.surface} numberOfLines={3} style={styles.text}>
        {toast.message}
      </TText>
      {undo ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Undo"
          hitSlop={8}
          onPress={() => {
            haptic("tap");
            undo();
            hideTrackerToast(toast.id);
          }}
          style={({ pressed }) => [styles.undo, pressed ? { opacity: 0.6 } : null]}
        >
          <TText variant="bodyStrong" color={th.brandSoft}>
            Undo
          </TText>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: TSPACE.lg,
    right: TSPACE.lg,
    maxWidth: 520,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: TSPACE.md,
    paddingVertical: TSPACE.sm,
    paddingLeft: TSPACE.md,
    paddingRight: TSPACE.xs,
    borderRadius: TRADIUS.md,
  },
  icon: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  text: { flex: 1 },
  undo: { minHeight: TOUCH_MIN, minWidth: TOUCH_MIN, paddingHorizontal: TSPACE.md, alignItems: "center", justifyContent: "center" },
});
