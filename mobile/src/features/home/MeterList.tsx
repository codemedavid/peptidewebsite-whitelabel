import { StyleSheet, View } from "react-native";
import type { Tone } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";

export type MeterRow = { id: string; name: string; note: string; pct: number; tone: Tone };

/**
 * The website dashboard's `adm-stock` rows: name + a toned note on top, a bar
 * below. Tone colours the note AND the bar, and the note always carries the
 * words, so colour is never the only signal.
 */
export function MeterList({ rows }: { rows: readonly MeterRow[] }) {
  const t = useTheme();
  return (
    <View style={{ gap: SPACE.md }}>
      {rows.map((r) => {
        const c = t.tone(r.tone);
        const fill = r.tone === "neutral" || r.tone === "success" ? t.colors.chart : c.fg;
        return (
          <View key={r.id} accessible accessibilityLabel={`${r.name}, ${r.note}`} style={{ gap: 6 }}>
            <View style={styles.top}>
              <AppText variant="label" numberOfLines={1} style={{ flex: 1 }}>
                {r.name}
              </AppText>
              <AppText variant="caption" color={r.tone === "neutral" ? "muted" : c.fg} style={styles.note} numberOfLines={1}>
                {r.note}
              </AppText>
            </View>
            <View style={[styles.track, { backgroundColor: t.colors.chartTrack }]}>
              <View style={[styles.bar, { width: `${Math.max(0, Math.min(100, r.pct))}%`, backgroundColor: fill }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  note: { fontVariant: ["tabular-nums"], fontWeight: "600", flexShrink: 1 },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  bar: { height: 6, borderRadius: 3 },
});
