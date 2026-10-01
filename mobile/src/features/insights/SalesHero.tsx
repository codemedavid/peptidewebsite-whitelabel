import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { InsightsRange, InsightsResponse } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AreaChart } from "@/ui/charts/AreaChart";
import { Chips, Delta } from "@/ui/kit";
import { AppText } from "@/ui/primitives";

export const HERO_RANGES: ReadonlyArray<{ key: InsightsRange; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

/** Chart points for a revenue series, with the order count in the tooltip. */
export function revenuePoints(data: InsightsResponse) {
  return data.series.map((p) => ({
    label: p.label,
    longLabel: p.longLabel,
    value: p.revenue,
    valueLabel: p.revenueLabel,
    detail: `${p.orders} ${p.orders === 1 ? "order" : "orders"}`,
  }));
}

/**
 * The dark "sales" band at the top of Home — the site's ink band, with a big
 * serif revenue figure that follows your finger along the chart.
 */
export function SalesHero({
  data,
  range,
  onRange,
  loading,
}: {
  data: InsightsResponse | undefined;
  range: InsightsRange;
  onRange: (r: InsightsRange) => void;
  loading: boolean;
}) {
  const t = useTheme();
  const [scrub, setScrub] = useState<number | null>(null);
  const point = scrub !== null ? data?.series[scrub] : null;

  const headline = point ? point.revenueLabel : (data?.kpis.revenue.label ?? "—");
  const caption = point ? point.longLabel : `Sales · ${data?.rangeLabel ?? ""}`;

  return (
    <View style={[styles.band, { backgroundColor: t.colors.band }]}>
      <Chips options={HERO_RANGES} value={range} onChange={onRange} onBand label="Sales period" />

      <View style={{ gap: 4, marginTop: SPACE.lg }}>
        <AppText variant="overline" color={t.colors.bandMuted}>
          {caption.toUpperCase()}
        </AppText>
        <AppText
          variant="number"
          color={t.colors.bandText}
          numberOfLines={1}
          style={[styles.tabular, loading ? { opacity: 0.5 } : null]}
          accessibilityRole="header"
        >
          {headline}
        </AppText>
        {point ? (
          <AppText variant="caption" color={t.colors.bandMuted}>
            {`${point.orders} ${point.orders === 1 ? "order" : "orders"}`}
          </AppText>
        ) : data ? (
          <View style={styles.deltaRow}>
            <Delta value={data.kpis.revenue.delta} onBand />
            <AppText variant="caption" color={t.colors.bandMuted}>
              {data.compareLabel}
            </AppText>
          </View>
        ) : null}
      </View>

      {data ? (
        <View style={{ marginTop: SPACE.lg }}>
          <AreaChart
            points={revenuePoints(data)}
            height={120}
            onBand
            onScrub={setScrub}
            accessibilityLabel={`Sales chart, ${data.rangeLabel}. Total ${data.kpis.revenue.label}. Press and drag to read each point.`}
          />
        </View>
      ) : null}

      {data ? (
        <View style={[styles.mini, { borderTopColor: t.colors.bandLine }]}>
          <Mini label="Orders" value={data.kpis.orders.label} delta={data.kpis.orders.delta} />
          <Mini label="Avg. order" value={data.kpis.aov.label} delta={data.kpis.aov.delta} />
          <Mini label="Customers" value={data.kpis.customers.label} delta={data.kpis.customers.delta} />
        </View>
      ) : null}
    </View>
  );
}

function Mini({ label, value, delta }: { label: string; value: string; delta: number | null }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="caption" color={t.colors.bandMuted} numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" color={t.colors.bandText} numberOfLines={1} style={styles.tabular}>
        {value}
      </AppText>
      <Delta value={delta} onBand compact />
    </View>
  );
}

const styles = StyleSheet.create({
  band: { borderRadius: RADIUS.lg, padding: SPACE.lg, paddingTop: SPACE.md },
  tabular: { fontVariant: ["tabular-nums"] },
  deltaRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  mini: {
    flexDirection: "row",
    gap: SPACE.md,
    marginTop: SPACE.md,
    paddingTop: SPACE.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
