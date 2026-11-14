import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { InsightsGranularity, InsightsPoint } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { Delta } from "@/ui/kit";
import { AppText } from "@/ui/primitives";

// Day by day / week by week / month by month: each bucket newest first, with
// its change vs the bucket before it and (when comparing) vs its twin.

const PREVIEW = 7;
const UNIT: Record<InsightsGranularity, string> = { hour: "hour", day: "day", week: "week", month: "month" };

export function breakdownTitle(g: InsightsGranularity): string {
  const u = UNIT[g];
  return `${u[0].toUpperCase()}${u.slice(1)} by ${u}`;
}

export function PeriodBreakdown({ series, granularity, comparing }: { series: InsightsPoint[]; granularity: InsightsGranularity; comparing: boolean }) {
  const t = useTheme();
  const [all, setAll] = useState(false);
  const unit = UNIT[granularity];
  const rows = series.map((p, i) => ({ p, i })).reverse();
  const shown = all ? rows : rows.slice(0, PREVIEW);
  const max = Math.max(...series.map((p) => p.revenue), 0);

  return (
    <View>
      {shown.map(({ p, i }, n) => (
        <View
          key={`${p.longLabel}-${i}`}
          accessible
          accessibilityLabel={`${p.longLabel}: ${p.revenueLabel}, ${p.orders} orders`}
          style={[styles.row, n > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border } : null]}
        >
          <View style={styles.top}>
            <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{p.longLabel}</AppText>
            <AppText variant="bodyStrong" style={styles.num}>{p.revenueLabel}</AppText>
          </View>
          <View style={[styles.track, { backgroundColor: t.colors.chartTrack }]}>
            <View style={[styles.fill, { backgroundColor: t.colors.chart, width: `${max > 0 ? (p.revenue / max) * 100 : 0}%` }]} />
          </View>
          <View style={styles.meta}>
            <AppText variant="caption" color="muted" style={{ flex: 1 }} numberOfLines={1}>
              {`${p.orders} ${p.orders === 1 ? "order" : "orders"}${p.orders && p.aovLabel ? ` · avg ${p.aovLabel}` : ""}`}
            </AppText>
            {p.change !== undefined ? (
              <View style={styles.delta}>
                <AppText variant="caption" color="faint">{`vs prev ${unit}`}</AppText>
                <Delta value={p.change ?? null} compact />
              </View>
            ) : null}
          </View>
          {comparing && p.prevRevenueLabel && p.prevLongLabel ? (
            <View style={styles.meta}>
              <AppText variant="caption" color="faint" style={{ flex: 1 }} numberOfLines={1}>
                {`${p.prevLongLabel} · ${p.prevRevenueLabel}`}
              </AppText>
              <Delta value={p.compareChange ?? null} compact />
            </View>
          ) : null}
        </View>
      ))}
      {rows.length > PREVIEW ? (
        <Pressable accessibilityRole="button" onPress={() => setAll((v) => !v)} style={[styles.more, { borderColor: t.colors.border }]}>
          <AppText variant="label" color="link">{all ? "Show fewer" : `Show all ${rows.length} ${unit}s`}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: SPACE.md, gap: 6 },
  top: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  num: { fontVariant: ["tabular-nums"] },
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
  meta: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  delta: { flexDirection: "row", alignItems: "center", gap: 6 },
  more: { marginTop: SPACE.sm, paddingVertical: SPACE.md, alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS.sm },
});
