/**
 * ESTIMATED LEVEL (TRACKER.md §1 — "the most important feature", Shotsy): the
 * amount still present from the doses the user logged, decaying by the
 * half-life THEY entered, with their check-in side effects pinned on the
 * curve so "how I felt" sits next to "what I took". Always labelled an
 * estimate. No half-life → an inviting sample and a link to add one (the app
 * never suggests a half-life).
 */
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { useLevelCurve, useProtocols } from "../../hooks";
import { unitLabel } from "../../lib/dose-math";
import { formatDay, formatWeekdayDay, dayKey } from "../../lib/ids";
import { levelCurve } from "../../lib/level";
import type { CheckIn, Protocol } from "../../lib/types";
import { clock } from "../format";
import { Card, IconButton, Pill, PressButton, SectionHeader, SegmentedControl, TText } from "../kit";
import { trackerHref } from "../routes";
import { TRADIUS, TSPACE, useTrackerTheme } from "../theme";
import { Legend, SampleFrame, useChartWidth, type LegendItem } from "./chart-kit";
import { amountText, exactSeries, LEVEL_RANGES, levelAt, levelSummary, levelWindow, niceCeil, type LevelRangeKey } from "./level-model";
import { realEffects, reportsEffects } from "./progress-model";
import { LevelPlot, type ScrubInfo } from "./LevelPlot";
import { ProtocolChips } from "./ProtocolChips";

/** Headroom above the highest point. */
const Y_HEADROOM = 1.08;
const SCALE_KEYS = [
  ["energy", "Energy"],
  ["mood", "Mood"],
  ["appetite", "Appetite"],
  ["sleep", "Sleep"],
] as const;

export function LevelCard({ now }: { now: Date }) {
  const th = useTrackerTheme();
  const { protocols } = useProtocols();
  const shown = useMemo(() => {
    const current = protocols.filter((p) => p.status !== "archived");
    return current.length > 0 ? current : protocols;
  }, [protocols]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [rangeKey, setRangeKey] = useState<LevelRangeKey>("14d");
  const [scrub, setScrub] = useState<ScrubInfo | null>(null);
  const [pinId, setPinId] = useState<string | null>(null);

  const protocol = shown.find((p) => p.id === pickedId) ?? shown.find((p) => (p.halfLifeHours ?? 0) > 0) ?? shown[0] ?? null;
  const range = LEVEL_RANGES.find((r) => r.key === rangeKey) ?? LEVEL_RANGES[1];
  const halfLife = protocol?.halfLifeHours ?? null;
  const windowKey = Math.floor(now.getTime() / 600_000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const win = useMemo(() => levelWindow(now, range.days, halfLife), [windowKey, range.days, halfLife]);
  const curve = useLevelCurve(protocol?.id ?? "", { from: win.from, to: win.to, stepHours: win.stepHours });

  const view = useMemo(() => {
    if (!curve || !protocol) return null;
    const series = exactSeries(curve.points, curve.doses, curve.halfLifeHours, curve.unit);
    const nowLevel = levelAt(series, win.nowMs, curve.halfLifeHours);
    let peak = series[0] ?? null;
    let top = 0;
    for (const p of series) {
      top = Math.max(top, p.level);
      if (p.t <= win.nowMs && (!peak || p.level > peak.level)) peak = p;
    }
    const unit = unitLabel(curve.unit);
    const yMax = niceCeil(Math.max(top, protocol.dose.value) * Y_HEADROOM);
    const checkins = curve.checkins.filter(reportsEffects);
    const summary = levelSummary({ name: protocol.name, days: range.days, unit, doseCount: curve.doses.length, nowLevel, peak, checkins });
    return { series, nowLevel, peak, unit, yMax, summary, checkins };
  }, [curve, protocol, win.nowMs, range.days]);

  const choose = (id: string | null) => {
    setPickedId(id);
    setPinId(null);
    setScrub(null);
  };
  const pickRange = (key: LevelRangeKey) => {
    setRangeKey(key);
    setPinId(null);
    setScrub(null);
  };

  if (!protocol) {
    return (
      <Card>
        <SectionHeader title="Estimated level" />
        <SampleLevel />
        <TText variant="headline">See your estimated level over time</TText>
        <TText variant="body" color="soft">
          Set up a protocol and log your doses. If you enter a half-life, the curve shows how much is likely still active, with your side effects marked on it.
        </TText>
        <PressButton label="Set up a protocol" icon="add" size="md" onPress={() => router.push(trackerHref.protocolEdit())} />
      </Card>
    );
  }

  const pinned = pinId && view ? (view.checkins.find((c) => c.id === pinId) ?? null) : null;
  const readout = scrub ?? (view?.nowLevel !== null && view?.nowLevel !== undefined ? { t: win.nowMs, level: view.nowLevel, dose: null } : null);

  return (
    <Card>
      <SectionHeader
        title="Estimated level"
        right={halfLife ? <TText variant="meta" color="soft" tabular>{`Half-life ${halfLife} h`}</TText> : undefined}
      />
      {shown.length > 1 ? (
        <ProtocolChips protocols={shown} value={protocol.id} onChange={(id) => id && choose(id)} label="Protocol for the level chart" isMuted={(p) => !(p.halfLifeHours && p.halfLifeHours > 0)} />
      ) : null}

      {!view ? (
        <NoHalfLife protocol={protocol} />
      ) : (
        <>
          <View style={styles.readoutRow}>
            <View style={styles.fill} accessible accessibilityLiveRegion="polite" accessibilityLabel={readout ? `${scrub ? formatWeekdayDay(dayKey(new Date(readout.t))) : "Now"}, about ${amountText(readout.level, view.unit)}, estimated` : undefined}>
              <TText variant="hero" tabular style={styles.readout} numberOfLines={1}>
                {readout ? amountText(readout.level, view.unit) : "—"}
              </TText>
              <TText variant="meta" color="soft" numberOfLines={1}>
                {scrub ? `${formatWeekdayDay(dayKey(new Date(scrub.t)))} · ${clock(new Date(scrub.t))}` : "estimated now"}
              </TText>
            </View>
            {view.peak && view.peak.level > 0 ? (
              <View style={styles.stat} accessible accessibilityLabel={`Highest in range about ${amountText(view.peak.level, view.unit)} on ${formatDay(dayKey(new Date(view.peak.t)))}`}>
                <TText variant="micro" color="faint">
                  Peak
                </TText>
                <TText variant="number">{amountText(view.peak.level, view.unit)}</TText>
                <TText variant="meta" color="soft">
                  {formatDay(dayKey(new Date(view.peak.t)))}
                </TText>
              </View>
            ) : null}
          </View>

          <SegmentedControl label="Chart range" options={LEVEL_RANGES} value={rangeKey} onChange={pickRange} />

          <LevelPlot
            series={view.series}
            window={win}
            halfLifeHours={curve?.halfLifeHours ?? 1}
            unit={view.unit}
            yMax={view.yMax}
            doses={curve?.doses ?? []}
            checkins={view.checkins}
            tickDays={range.tickDays}
            summary={view.summary}
            selectedPinId={pinned?.id ?? null}
            onSelectPin={setPinId}
            onScrub={setScrub}
          />

          {pinned ? <PinDetail checkin={pinned} level={levelAt(view.series, middayOf(pinned.date, win.nowMs), curve?.halfLifeHours ?? 1)} unit={view.unit} onClose={() => setPinId(null)} /> : null}

          {curve && curve.doses.length === 0 ? (
            <TText variant="meta" color="soft">{`No ${protocol.name} doses logged in the last ${range.days} days. Your curve builds as you log.`}</TText>
          ) : null}

          <LevelLegend />
          <View style={[styles.caption, { backgroundColor: th.surfaceAlt }]}>
            <Ionicons name="information-circle-outline" size={16} color={th.inkSoft} />
            <TText variant="meta" color="soft" style={styles.fill}>
              Estimate from your logged doses and the half-life you entered, not a measurement.
            </TText>
          </View>
        </>
      )}
    </Card>
  );
}

function middayOf(day: string, nowMs: number): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.min(nowMs, new Date(y, m - 1, d, 12).getTime());
}

function NoHalfLife({ protocol }: { protocol: Protocol }) {
  return (
    <View style={styles.gap}>
      <SampleLevel />
      <TText variant="headline">{`See ${protocol.name}'s estimated level`}</TText>
      <TText variant="body" color="soft">
        Add the half-life from your own source (your doctor or the product insert) and this chart shows roughly how much is still active between doses, with your side effects marked on it. The app never suggests one.
      </TText>
      <PressButton label="Add a half-life" icon="add" size="md" tone="soft" onPress={() => router.push(trackerHref.protocolEdit({ id: protocol.id }))} />
    </View>
  );
}

function PinDetail({ checkin, level, unit, onClose }: { checkin: CheckIn; level: number | null; unit: string; onClose: () => void }) {
  const th = useTrackerTheme();
  const scales = SCALE_KEYS.flatMap(([k, label]) => (checkin[k] !== null ? [`${label} ${checkin[k]}/5`] : []));
  return (
    <View style={[styles.detail, { backgroundColor: th.status.low.soft }]} accessibilityLiveRegion="polite">
      <View style={styles.detailHead}>
        <Ionicons name="flag" size={16} color={th.status.low.text} />
        <TText variant="bodyStrong" style={styles.fill} accessibilityRole="header">
          {formatWeekdayDay(checkin.date)}
        </TText>
        <IconButton icon="close" label="Hide details" tone="plain" onPress={onClose} />
      </View>
      <View style={styles.pills}>
        {realEffects(checkin).map((e) => (
          <Pill key={e} label={e} status="low" icon="alert-circle-outline" />
        ))}
      </View>
      {scales.length > 0 ? (
        <TText variant="meta" color="ink" tabular>
          {scales.join(" · ")}
        </TText>
      ) : null}
      {level !== null ? <TText variant="meta" color="soft" tabular>{`Estimated level that day ≈ ${amountText(level, unit)}`}</TText> : null}
      {checkin.note ? <TText variant="meta" color="soft">{`“${checkin.note}”`}</TText> : null}
      <PressButton label="Open check-in" size="sm" tone="secondary" trailingIcon="chevron-forward" onPress={() => router.push(trackerHref.checkin(checkin.date))} style={styles.detailAction} />
    </View>
  );
}

function LevelLegend() {
  const th = useTrackerTheme();
  const items: LegendItem[] = [
    {
      key: "est",
      label: "Estimate",
      swatch: (
        <Svg width={16} height={10}>
          <Line x1={1} x2={15} y1={5} y2={5} stroke={th.brand} strokeWidth={2.5} strokeLinecap="round" />
        </Svg>
      ),
    },
    {
      key: "proj",
      label: "If no more doses",
      swatch: (
        <Svg width={16} height={10}>
          <Line x1={1} x2={15} y1={5} y2={5} stroke={th.brand} strokeOpacity={0.55} strokeWidth={2} strokeDasharray="3 3" />
        </Svg>
      ),
    },
    {
      key: "dose",
      label: "Dose",
      swatch: (
        <Svg width={10} height={10}>
          <Rect x={3.5} y={1} width={3} height={8} rx={1.5} fill={th.brand} />
        </Svg>
      ),
    },
    {
      key: "fx",
      label: "Side effects",
      swatch: (
        <Svg width={12} height={12}>
          <Circle cx={6} cy={6} r={4.5} fill={th.status.low.soft} stroke={th.status.low.solid} strokeWidth={2} />
        </Svg>
      ),
    },
    {
      key: "none",
      label: "No side effects",
      swatch: (
        <Svg width={10} height={10}>
          <Circle cx={5} cy={5} r={3.5} fill={th.surface} stroke={th.status.done.solid} strokeWidth={1.5} />
        </Svg>
      ),
    },
  ];
  return <Legend items={items} />;
}

const SAMPLE_HALF_LIFE = 30;
const SAMPLE_DAYS = 10;
const SAMPLE_H = 120;

/** A greyed, made-up curve (daily doses, no real compound or amount) for empty states. */
function SampleLevel() {
  const th = useTrackerTheme();
  const [width, onLayout] = useChartWidth();
  const d = useMemo(() => {
    if (width <= 0) return null;
    const start = Date.UTC(2026, 0, 1);
    const doses = Array.from({ length: SAMPLE_DAYS }, (_, i) => ({ takenAt: new Date(start + i * 86_400_000).toISOString(), dose: { value: 1, unit: "mg" as const }, deletedAt: null }));
    const pts = levelCurve(doses, SAMPLE_HALF_LIFE, new Date(start), new Date(start + (SAMPLE_DAYS + 1) * 86_400_000), 2, "mg");
    const max = Math.max(...pts.map((p) => p.level), 1);
    const span = pts[pts.length - 1].t - pts[0].t || 1;
    const x = (t: number) => ((t - pts[0].t) / span) * width;
    const y = (v: number) => 8 + (SAMPLE_H - 16) * (1 - v / max);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.level).toFixed(1)}`).join(" ");
    return { line, area: `${line} L${width},${SAMPLE_H} L0,${SAMPLE_H} Z`, pin: { x: x(pts[0].t + 4.5 * 86_400_000), y: y(pts[Math.round(pts.length * 0.42)].level) } };
  }, [width]);
  return (
    <SampleFrame label="Sample of an estimated level chart. Not your data.">
      <View style={[styles.sample, { borderColor: th.line }]} onLayout={onLayout}>
        {d ? (
          <Svg width={width} height={SAMPLE_H}>
            <Path d={d.area} fill={th.inkFaint} fillOpacity={0.12} />
            <Path d={d.line} stroke={th.inkSoft} strokeWidth={2} fill="none" />
            <Line x1={d.pin.x} x2={d.pin.x} y1={12} y2={d.pin.y} stroke={th.inkSoft} strokeDasharray="2 2" />
            <Circle cx={d.pin.x} cy={12} r={5} fill={th.surface} stroke={th.inkSoft} strokeWidth={2} />
          </Svg>
        ) : null}
      </View>
    </SampleFrame>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gap: { gap: TSPACE.md },
  readoutRow: { flexDirection: "row", alignItems: "flex-end", gap: TSPACE.md },
  readout: { fontSize: 34, lineHeight: 40 },
  stat: { alignItems: "flex-end" },
  caption: { flexDirection: "row", gap: TSPACE.sm, padding: TSPACE.md, borderRadius: TRADIUS.sm, alignItems: "flex-start" },
  detail: { borderRadius: TRADIUS.md, padding: TSPACE.md, gap: TSPACE.sm },
  detailHead: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: TSPACE.xs },
  detailAction: { alignSelf: "flex-start" },
  sample: { height: SAMPLE_H, borderBottomWidth: StyleSheet.hairlineWidth },
});
