/**
 * WEIGHT: the trend in the user's unit (kg stored, lb or kg shown), scaled to
 * the weights themselves so a few pounds show; current value, start and the
 * change over the chosen range. The change is shown neutrally (no red/green):
 * down isn't "good" for everyone. No weigh-ins → a greyed sample.
 */
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { addDays, formatDay } from "../../lib/ids";
import type { CheckIn, WeightUnit } from "../../lib/types";
import { Card, PressButton, SectionHeader, SegmentedControl, TText } from "../kit";
import { trackerHref } from "../routes";
import { TRADIUS, TSPACE, useTrackerTheme } from "../theme";
import { AxisLabel, SampleFrame, useChartWidth } from "./chart-kit";
import { weightSeries, type WeightPoint } from "./progress-model";

type RangeKey = "4w" | "12w" | "all";
const RANGES: readonly { key: RangeKey; label: string; days: number | null }[] = [
  { key: "4w", label: "4W", days: 28 },
  { key: "12w", label: "12W", days: 84 },
  { key: "all", label: "All", days: null },
];
const CHART_H = 132;
const PAD_Y = 14;
const PAD_X = 6;

type Props = { checkins: readonly CheckIn[]; unit: WeightUnit; today: string };

export function WeightCard({ checkins, unit, today }: Props) {
  const [range, setRange] = useState<RangeKey>("12w");
  const days = RANGES.find((r) => r.key === range)?.days ?? null;
  const all = useMemo(() => weightSeries(checkins, unit, null), [checkins, unit]);
  const points = useMemo(() => weightSeries(checkins, unit, days === null ? null : addDays(today, -days)), [checkins, unit, days, today]);
  const add = () => router.push(trackerHref.checkin(today));

  if (all.length === 0) {
    return (
      <Card>
        <SectionHeader title="Weight" />
        <SampleFrame label="Sample of a weight trend. Not your data.">
          <Trend points={SAMPLE_POINTS} unit="kg" label="" />
        </SampleFrame>
        <TText variant="body" color="soft">
          Add a weigh-in whenever you like. Your trend shows from the second one.
        </TText>
        <PressButton label="Add weight" icon="add" size="md" onPress={add} />
      </Card>
    );
  }

  const latest = points[points.length - 1] ?? all[all.length - 1];
  const first = points[0] ?? null;
  const change = first && points.length > 1 ? latest.value - first.value : null;
  const changeText = change === null ? null : `${Math.abs(change).toFixed(1)} ${unit} since ${formatDay(first?.day ?? latest.day)}`;
  const spokenChange = change === null ? "" : `, ${Math.abs(change) < 0.05 ? "no change" : change < 0 ? "down" : "up"} ${Math.abs(change).toFixed(1)} ${unit} since ${formatDay(first?.day ?? latest.day)}`;

  return (
    <Card>
      <SectionHeader title="Weight" />
      <View style={styles.head} accessible accessibilityLabel={`Latest weight ${latest.value.toFixed(1)} ${unit} on ${formatDay(latest.day)}${spokenChange}`}>
        <View style={styles.fill}>
          <TText variant="hero" tabular style={styles.big} numberOfLines={1}>
            {`${latest.value.toFixed(1)}`}
            <TText variant="headline" color="soft">{` ${unit}`}</TText>
          </TText>
          <TText variant="meta" color="soft">{`Latest · ${formatDay(latest.day)}`}</TText>
        </View>
        {change !== null ? <Change change={change} text={changeText ?? ""} /> : null}
      </View>
      <SegmentedControl label="Weight range" options={RANGES} value={range} onChange={setRange} />
      {points.length > 1 ? (
        <Trend points={points} unit={unit} label={`Weight trend: ${points.length} weigh-ins from ${points[0].value.toFixed(1)} ${unit} on ${formatDay(points[0].day)} to ${latest.value.toFixed(1)} ${unit} on ${formatDay(latest.day)}.`} />
      ) : (
        <TText variant="meta" color="soft">
          {points.length === 1 ? "One weigh-in in this range. Add another to see the trend." : "No weigh-ins in this range."}
        </TText>
      )}
      {first && points.length > 1 ? (
        <View style={styles.stats}>
          <Stat label="Start" value={`${first.value.toFixed(1)} ${unit}`} />
          <Stat label="Current" value={`${latest.value.toFixed(1)} ${unit}`} />
          <Stat label="Change" value={`${change !== null && change > 0 ? "+" : change !== null && change < 0 ? "−" : ""}${Math.abs(change ?? 0).toFixed(1)} ${unit}`} />
        </View>
      ) : null}
      <PressButton label="Add weight" icon="add" size="sm" tone="soft" onPress={add} style={styles.addBtn} />
    </Card>
  );
}

function Change({ change, text }: { change: number; text: string }) {
  const th = useTrackerTheme();
  const icon = Math.abs(change) < 0.05 ? "remove" : change < 0 ? "arrow-down" : "arrow-up";
  return (
    <View style={[styles.change, { backgroundColor: th.surfaceAlt }]}>
      <Ionicons name={icon} size={14} color={th.ink} />
      <TText variant="meta" tabular numberOfLines={2} style={styles.changeText}>
        {text}
      </TText>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <TText variant="micro" color="faint">
        {label}
      </TText>
      <TText variant="bodyStrong" tabular numberOfLines={1}>
        {value}
      </TText>
    </View>
  );
}

function Trend({ points, unit, label }: { points: readonly WeightPoint[]; unit: string; label: string }) {
  const th = useTrackerTheme();
  const [width, onLayout] = useChartWidth();
  const geo = useMemo(() => {
    if (width <= 0 || points.length < 2) return null;
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max(0.5, (max - min) * 0.15);
    const lo = min - pad;
    const hi = max + pad;
    const t0 = Date.parse(points[0].day);
    const t1 = Date.parse(points[points.length - 1].day);
    const span = t1 - t0 || 1;
    const x = (day: string) => PAD_X + ((Date.parse(day) - t0) / span) * (width - PAD_X * 2);
    const y = (v: number) => PAD_Y + (CHART_H - PAD_Y * 2) * (1 - (v - lo) / (hi - lo));
    const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
    const area = `${line} L${x(points[points.length - 1].day).toFixed(1)},${CHART_H} L${x(points[0].day).toFixed(1)},${CHART_H} Z`;
    return { x, y, line, area, min, max };
  }, [points, width]);
  const last = points[points.length - 1];
  return (
    <View accessible={!!label} accessibilityRole="image" accessibilityLabel={label || undefined}>
      <View style={{ height: CHART_H }} onLayout={onLayout}>
        {geo ? (
          <Svg width={width} height={CHART_H}>
            <Defs>
              <LinearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={th.brand} stopOpacity={0.18} />
                <Stop offset="1" stopColor={th.brand} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Line x1={0} x2={width} y1={geo.y(geo.max)} y2={geo.y(geo.max)} stroke={th.line} strokeDasharray="2 4" />
            <Line x1={0} x2={width} y1={geo.y(geo.min)} y2={geo.y(geo.min)} stroke={th.line} strokeDasharray="2 4" />
            <Path d={geo.area} fill="url(#weightFill)" />
            <Path d={geo.line} stroke={th.brand} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p) => (
              <Circle key={p.day} cx={geo.x(p.day)} cy={geo.y(p.value)} r={p === last ? 5 : 2.5} fill={th.brand} stroke={p === last ? th.surface : undefined} strokeWidth={p === last ? 2 : 0} />
            ))}
          </Svg>
        ) : null}
        {geo ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <AxisLabel style={[styles.yLabel, { top: geo.y(geo.max) - 15 }]}>{`${geo.max.toFixed(1)} ${unit}`}</AxisLabel>
            <AxisLabel style={[styles.yLabel, { top: geo.y(geo.min) + 2 }]}>{`${geo.min.toFixed(1)} ${unit}`}</AxisLabel>
          </View>
        ) : null}
      </View>
      {points.length > 1 ? (
        <View style={styles.xRow}>
          <AxisLabel>{formatDay(points[0].day)}</AxisLabel>
          <AxisLabel>{formatDay(last.day)}</AxisLabel>
        </View>
      ) : null}
    </View>
  );
}

const SAMPLE_POINTS: WeightPoint[] = [80.2, 79.8, 79.9, 79.1, 78.8, 78.9, 78.2, 77.9].map((value, i) => ({ day: `2026-01-${String(1 + i * 4).padStart(2, "0")}`, value }));

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { flexDirection: "row", alignItems: "flex-end", gap: TSPACE.md, flexWrap: "wrap" },
  big: { fontSize: 34, lineHeight: 40 },
  change: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: TRADIUS.pill, maxWidth: "100%" },
  changeText: { flexShrink: 1 },
  stats: { flexDirection: "row", gap: TSPACE.md },
  stat: { flex: 1, gap: 2 },
  yLabel: { position: "absolute", right: 0 },
  xRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  addBtn: { alignSelf: "flex-start" },
});
