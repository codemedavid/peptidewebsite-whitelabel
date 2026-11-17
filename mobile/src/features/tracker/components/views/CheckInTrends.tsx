/**
 * HOW YOU'VE FELT (last 30 days): small multiples for energy, mood, appetite
 * and sleep — average, change on the week before and a sparkline each — then
 * how often each side effect came up, with "no side effects" days first so a
 * good month reads as good. No check-ins yet → a greyed sample.
 */
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, PressButton, SectionHeader, TText } from "../kit";
import { ProgressBar } from "../ProgressRing";
import { trackerHref } from "../routes";
import { TRADIUS, TSPACE, useTrackerTheme } from "../theme";
import { SampleFrame, Sparkline, useChartWidth } from "./chart-kit";
import { METRICS, type CheckInTrendData, type MetricTrend } from "./progress-model";

const SPARK_H = 34;
/** Average change smaller than this reads as "steady". */
const STEADY = 0.25;
const MAX_EFFECTS = 6;

type Props = { trends: CheckInTrendData; today: string };

export function CheckInTrends({ trends, today }: Props) {
  const isEmpty = trends.reported === 0 && trends.metrics.every((m) => m.count === 0);
  const add = () => router.push(trackerHref.checkin(today));
  return (
    <Card>
      <SectionHeader
        title="How you've felt"
        right={
          <TText variant="meta" color="faint">
            {`Last ${trends.days} days`}
          </TText>
        }
      />
      {isEmpty ? (
        <>
          <SampleFrame label="Sample of check-in trends. Not your data.">
            <Body trends={SAMPLE} />
          </SampleFrame>
          <TText variant="body" color="soft">
            A 20-second daily check-in of energy, mood and side effects (or none) builds these trends, and marks side effects on your level chart.
          </TText>
          <PressButton label="Check in today" icon="happy-outline" size="md" onPress={add} />
        </>
      ) : (
        <>
          <Body trends={trends} />
          <PressButton label="Check in" icon="add" size="sm" tone="soft" onPress={add} style={styles.addBtn} />
        </>
      )}
    </Card>
  );
}

function Body({ trends }: { trends: CheckInTrendData }) {
  return (
    <View style={styles.body}>
      <View style={styles.grid}>
        {trends.metrics.map((m) => (
          <MetricTile key={m.key} metric={m} />
        ))}
      </View>
      <Effects trends={trends} />
    </View>
  );
}

function MetricTile({ metric: m }: { metric: MetricTrend }) {
  const th = useTrackerTheme();
  const [width, onLayout] = useChartWidth();
  const icon = METRICS.find((x) => x.key === m.key)?.icon ?? "ellipse-outline";
  const trend = m.delta === null ? null : Math.abs(m.delta) < STEADY ? "steady" : m.delta > 0 ? "up" : "down";
  const trendText = trend === null ? null : trend === "steady" ? "steady" : `${trend === "up" ? "+" : "−"}${Math.abs(m.delta ?? 0).toFixed(1)} wk`;
  const spoken =
    m.avg === null
      ? `${m.label}: no ratings yet`
      : `${m.label}: average ${m.avg.toFixed(1)} out of 5 from ${m.count} check-in${m.count === 1 ? "" : "s"}${trend === null ? "" : trend === "steady" ? ", steady on the week before" : `, ${trend} ${Math.abs(m.delta ?? 0).toFixed(1)} on the week before`}`;
  return (
    <View style={[styles.tile, { backgroundColor: th.surfaceAlt }]} accessible accessibilityRole="image" accessibilityLabel={spoken}>
      <View style={styles.tileHead}>
        <Ionicons name={icon} size={14} color={th.inkSoft} />
        <TText variant="meta" color="soft" numberOfLines={1} style={styles.fill}>
          {m.label}
        </TText>
      </View>
      <View style={styles.valueRow}>
        <TText variant="number" tabular style={styles.value}>
          {m.avg === null ? "—" : m.avg.toFixed(1)}
        </TText>
        <TText variant="meta" color="faint" tabular>
          /5
        </TText>
        {trendText ? (
          <TText variant="meta" color={trend === "steady" ? th.inkSoft : th.brandText} tabular style={styles.delta} numberOfLines={1}>
            {trendText}
          </TText>
        ) : null}
      </View>
      <View style={{ height: SPARK_H }} onLayout={onLayout}>
        {m.count > 0 ? <Sparkline values={m.values} min={1} max={5} width={width} height={SPARK_H} color={th.brand} track={th.line} /> : null}
      </View>
    </View>
  );
}

function Effects({ trends }: { trends: CheckInTrendData }) {
  const th = useTrackerTheme();
  const total = Math.max(1, trends.reported);
  const shown = trends.effects.slice(0, MAX_EFFECTS);
  return (
    <View style={styles.effects}>
      <TText variant="micro" color="faint" accessibilityRole="header">
        Side effects
      </TText>
      {trends.reported === 0 ? (
        <TText variant="meta" color="soft">
          Answer the side-effects question in a check-in (or tap “None”) to see how often they come up.
        </TText>
      ) : null}
      {trends.reported > 0 ? <EffectRow label="No side effects" days={trends.noneDays} total={total} color={th.status.done.solid} icon="checkmark-circle" iconColor={th.status.done.text} /> : null}
      {shown.map((e) => (
        <EffectRow key={e.name} label={e.name} days={e.days} total={total} color={th.status.low.solid} icon="alert-circle-outline" iconColor={th.status.low.text} />
      ))}
      {trends.effects.length > MAX_EFFECTS ? (
        <TText variant="meta" color="faint">{`+${trends.effects.length - MAX_EFFECTS} more`}</TText>
      ) : null}
    </View>
  );
}

function EffectRow({ label, days, total, color, icon, iconColor }: { label: string; days: number; total: number; color: string; icon: "checkmark-circle" | "alert-circle-outline"; iconColor: string }) {
  const th = useTrackerTheme();
  return (
    <View style={styles.effect} accessible accessibilityLabel={`${label}: ${days} of ${total} check-in days`}>
      <View style={styles.effectHead}>
        <Ionicons name={icon} size={14} color={iconColor} />
        <TText variant="meta" numberOfLines={1} style={styles.fill}>
          {label}
        </TText>
        <TText variant="meta" color="soft" tabular>
          {`${days} day${days === 1 ? "" : "s"}`}
        </TText>
      </View>
      <ProgressBar progress={days / total} color={color} track={th.surfaceAlt} height={6} />
    </View>
  );
}

const SAMPLE_VALUES: Record<string, number[]> = {
  energy: [3, 3, 4, 3, 4, 4, 5, 4, 4, 5],
  mood: [3, 4, 4, 3, 4, 4, 4, 5, 4, 4],
  appetite: [4, 3, 3, 3, 2, 3, 3, 3, 3, 3],
  sleep: [3, 3, 4, 4, 3, 4, 4, 4, 5, 4],
};

const SAMPLE: CheckInTrendData = {
  days: 30,
  metrics: METRICS.map((m) => {
    const values = SAMPLE_VALUES[m.key] as (1 | 2 | 3 | 4 | 5)[];
    return { key: m.key, label: m.label, values, avg: values.reduce((a, b) => a + b, 0) / values.length, count: values.length, delta: 0.4 };
  }),
  effects: [
    { name: "Headache", days: 3 },
    { name: "Nausea", days: 2 },
  ],
  noneDays: 7,
  reported: 10,
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { gap: TSPACE.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: TSPACE.sm },
  tile: { flexBasis: "47%", flexGrow: 1, minWidth: 120, borderRadius: TRADIUS.md, padding: TSPACE.md, gap: TSPACE.xs },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  valueRow: { flexDirection: "row", alignItems: "baseline", gap: 2 },
  value: { fontSize: 22, lineHeight: 28 },
  delta: { marginLeft: "auto", fontSize: 12 },
  effects: { gap: TSPACE.sm },
  effect: { gap: 4 },
  effectHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  addBtn: { alignSelf: "flex-start" },
});
