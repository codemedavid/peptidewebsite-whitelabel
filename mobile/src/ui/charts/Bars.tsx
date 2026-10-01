import { Pressable, StyleSheet, View } from "react-native";
import type { RankedRow } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { AppText } from "../primitives";

/**
 * Ranked horizontal bars (top products, customers, payment methods, places).
 * One hue — magnitude, not identity — with the name, value and detail as
 * text beside every bar, so the bar only speeds up comparison.
 */
export function BarList({
  rows,
  onPressRow,
  empty = "Nothing here yet.",
}: {
  rows: ReadonlyArray<RankedRow & { key?: string }>;
  onPressRow?: (row: RankedRow & { key?: string }) => void;
  empty?: string;
}) {
  const t = useTheme();
  if (rows.length === 0) {
    return (
      <AppText variant="caption" color="muted">
        {empty}
      </AppText>
    );
  }
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <View style={{ gap: SPACE.md }}>
      {rows.map((r, i) => {
        const pct = max > 0 ? Math.max(r.value / max, 0.02) : 0;
        const share = Math.round(r.share * 100);
        return (
          <Pressable
            key={r.key ?? r.name}
            disabled={!onPressRow}
            onPress={() => onPressRow?.(r)}
            accessibilityRole={onPressRow ? "button" : undefined}
            accessibilityLabel={`${i + 1}. ${r.name}, ${r.valueLabel}, ${r.detail}, ${share} percent`}
            style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
          >
            <View style={styles.head}>
              <AppText variant="caption" color="faint" style={styles.rank}>
                {String(i + 1)}
              </AppText>
              <AppText variant="label" numberOfLines={1} style={{ flex: 1 }}>
                {r.name}
              </AppText>
              <AppText variant="label" style={styles.tabular}>
                {r.valueLabel}
              </AppText>
            </View>
            <View style={styles.barRow}>
              <View style={[styles.track, { backgroundColor: t.colors.chartTrack }]}>
                <View style={[styles.bar, { width: `${pct * 100}%`, backgroundColor: t.colors.chart }]} />
              </View>
              <AppText variant="caption" color="muted" style={styles.detail} numberOfLines={1}>
                {`${r.detail} · ${share}%`}
              </AppText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A two-part whole (new vs returning, collected vs awaiting) — one strong and
 * one quiet segment with a 2px gap, and a legend that names both with numbers.
 */
export function SplitBar({
  a,
  b,
}: {
  a: { label: string; value: number; valueLabel: string };
  b: { label: string; value: number; valueLabel: string };
}) {
  const t = useTheme();
  const total = a.value + b.value;
  const aPct = total > 0 ? a.value / total : 0;
  return (
    <View style={{ gap: SPACE.sm }}>
      <View style={styles.split} accessible accessibilityLabel={`${a.label} ${a.valueLabel}, ${b.label} ${b.valueLabel}`}>
        {total === 0 ? (
          <View style={[styles.seg, { flex: 1, backgroundColor: t.colors.chartTrack }]} />
        ) : (
          <>
            {aPct > 0 ? <View style={[styles.seg, { flex: aPct, backgroundColor: t.colors.chart }]} /> : null}
            {aPct < 1 ? (
              <View style={[styles.seg, { flex: 1 - aPct, backgroundColor: t.colors.chart, opacity: 0.35 }]} />
            ) : null}
          </>
        )}
      </View>
      <View style={styles.legend}>
        <Legend swatch={t.colors.chart} label={a.label} value={a.valueLabel} />
        <Legend swatch={t.colors.chart} faded label={b.label} value={b.valueLabel} />
      </View>
    </View>
  );
}

function Legend({ swatch, faded, label, value }: { swatch: string; faded?: boolean; label: string; value: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: swatch, opacity: faded ? 0.35 : 1 }]} />
      <AppText variant="caption" color="muted">
        {label}
      </AppText>
      <AppText variant="label" style={styles.tabular}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "baseline", gap: SPACE.sm },
  rank: { width: 16, fontVariant: ["tabular-nums"] },
  tabular: { fontVariant: ["tabular-nums"] },
  barRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, marginTop: 6, marginLeft: 24 },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  bar: { height: 6, borderRadius: 3 },
  detail: { minWidth: 92, textAlign: "right" },
  split: { flexDirection: "row", height: 10, gap: 2, borderRadius: 5, overflow: "hidden" },
  seg: { height: 10 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.lg },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
});
