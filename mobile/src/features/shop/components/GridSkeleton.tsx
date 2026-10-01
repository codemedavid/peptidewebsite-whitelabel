import { useEffect, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useReducedMotion } from "@/features/community/hooks/useMotion";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";

const TILES = 6;

/** Product-grid placeholder while the catalog loads (static when motion is reduced). */
export function GridSkeleton({ tile }: { tile: number }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(0.6));
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduced]);

  const block = { backgroundColor: t.colors.surfaceAlt };
  return (
    <View accessible accessibilityLabel="Loading products" style={styles.wrap}>
      <View style={[styles.search, block]} />
      <View style={styles.grid}>
        {Array.from({ length: TILES }, (_, i) => (
          <Animated.View key={i} style={{ width: tile, gap: SPACE.sm, opacity }}>
            <View style={[{ height: tile, borderRadius: RADIUS.lg }, block]} />
            <View style={[styles.line, block, { width: "80%" }]} />
            <View style={[styles.line, block, { width: "45%" }]} />
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: SPACE.lg, gap: SPACE.lg },
  search: { height: 48, borderRadius: RADIUS.pill },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.md },
  line: { height: 12, borderRadius: 6 },
});
