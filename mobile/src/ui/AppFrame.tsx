import type { ReactNode } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { APP_MAX_WIDTH } from "./responsive";

/**
 * The whole app, centred. On a phone it is simply full-screen. On a tablet or
 * a desktop browser the app stops at APP_MAX_WIDTH — header, screens and tab
 * bar together — with the space either side in the store's alternate surface
 * and a hairline edge, instead of stretching every screen edge to edge.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const framed = width > APP_MAX_WIDTH;
  return (
    <View style={[styles.outer, { backgroundColor: framed ? t.colors.surfaceAlt : t.colors.bg }]}>
      <View
        style={[
          styles.inner,
          { backgroundColor: t.colors.bg },
          framed ? { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border } : null,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, alignItems: "center" },
  inner: { flex: 1, width: "100%", maxWidth: APP_MAX_WIDTH, overflow: "hidden" },
});
