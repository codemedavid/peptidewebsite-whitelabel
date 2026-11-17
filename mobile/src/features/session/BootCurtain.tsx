import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeOut } from "react-native-reanimated";
import { useTheme } from "@/theme/ThemeProvider";
import { BrandLoader } from "@/ui/BrandLoader";

/**
 * The store's loading screen on every app open, like the website's brand
 * splash on every visit: it holds over the first screen for the store's
 * minimum duration (so a fast cached start still shows the brand instead of a
 * flash), then fades; it never stays past the store's maximum.
 *
 * Counted from when the store's look first REACHED the screen (the moment the
 * generic native splash hid — markBrandVisible), not from app start: the
 * native splash is the same for every store, so time spent behind it must not
 * use up the store's own moment.
 */

const FADE_MS = 280;
let brandVisibleAt: number | null = null;

/** Call once, when the native splash hides and the store's loader takes over. */
export function markBrandVisible(): void {
  brandVisibleAt ??= Date.now();
}

export function BootCurtain({ children }: { children: ReactNode }) {
  const { splash } = useTheme();
  const [showing, setShowing] = useState(() => {
    const since = brandVisibleAt ?? Date.now();
    return splash.enabled && Date.now() - since < splash.minDurationMs;
  });

  useEffect(() => {
    if (!showing) return;
    const elapsed = Date.now() - (brandVisibleAt ?? Date.now());
    const hold = Math.min(Math.max(splash.minDurationMs - elapsed, 0), splash.maxDurationMs);
    const id = setTimeout(() => setShowing(false), hold);
    return () => clearTimeout(id);
  }, [showing, splash.minDurationMs, splash.maxDurationMs]);

  return (
    <View style={styles.fill}>
      {children}
      {showing ? (
        <Animated.View exiting={FadeOut.duration(FADE_MS)} style={StyleSheet.absoluteFill}>
          <BrandLoader />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
