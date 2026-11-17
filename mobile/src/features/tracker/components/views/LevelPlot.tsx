/**
 * The estimated-level plot (drawing + interaction; data from LevelCard).
 *
 *   area + line      the estimate up to now (solid), then a dashed projection
 *                    "if no more doses" to the end of the window
 *   NOW              a dashed vertical rule with a dot on the curve
 *   dose markers     ticks on the x-axis at every logged dose
 *   side-effect pins a flag per check-in that had side effects: a stem from
 *                    the curve up to a labelled head (tap → details below);
 *                    "no side effects" check-ins are quiet dots on the curve
 *   scrub            drag sideways (or tap) for the value at that moment; it
 *                    snaps to a dose when close. Vertical drags still scroll.
 *
 * The drawing itself is one accessible image with a spoken summary; the pins
 * are separate 44 pt buttons so screen-reader users can reach them.
 */
import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View, type GestureResponderEvent } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import type { LevelPoint } from "../../lib/level";
import { formatWeekdayDay, dayKey } from "../../lib/ids";
import type { CheckIn, DoseLog } from "../../lib/types";
import { formatDose } from "../../lib/dose-math";
import { clock } from "../format";
import { haptic, TText } from "../kit";
import { TOUCH_MIN, TRADIUS, TSPACE, useTrackerTheme } from "../theme";
import { AxisLabel, useChartWidth } from "./chart-kit";
import { realEffects } from "./progress-model";
import { amountText, dayTicks, effectsLabel, levelAt, pinsFor, type LevelWindow, type Pin } from "./level-model";

const HEIGHT = 228;
/** Room above the plot for pin labels and heads. */
const PAD_TOP = 40;
const PAD_BOTTOM = 16;
const PIN_LABEL_TOP = 2;
const PIN_HEAD_Y = 30;
const PIN_LABEL_GAP = 76;
const PIN_LABEL_W = 72;
const TICK_W = 52;
const TOOLTIP_W = 176;
/** A scrub within this many points of a dose snaps to it. */
const SNAP_PX = 10;
/** Movement that turns a touch into a sideways scrub. */
const SCRUB_SLOP = 6;

export type ScrubInfo = { t: number; level: number; dose: DoseLog | null };

type Props = {
  series: readonly LevelPoint[];
  window: LevelWindow;
  halfLifeHours: number;
  unit: string;
  yMax: number;
  doses: readonly DoseLog[];
  checkins: readonly CheckIn[];
  tickDays: number;
  summary: string;
  selectedPinId: string | null;
  onSelectPin: (checkinId: string | null) => void;
  onScrub: (info: ScrubInfo | null) => void;
};

function pathOf(points: readonly LevelPoint[], x: (t: number) => number, y: (v: number) => number): string {
  return points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.level).toFixed(1)}`).join(" ");
}

export function LevelPlot({ series, window: win, halfLifeHours, unit, yMax, doses, checkins, tickDays, summary, selectedPinId, onSelectPin, onScrub }: Props) {
  const th = useTrackerTheme();
  const [width, onLayout] = useChartWidth();
  const [scrub, setScrub] = useState<ScrubInfo | null>(null);
  const touch = useRef<{ x0: number; y0: number; isScrubbing: boolean; lastDose: string | null }>({ x0: 0, y0: 0, isScrubbing: false, lastDose: null });

  const fromMs = win.from.getTime();
  const span = win.to.getTime() - fromMs || 1;
  const base = HEIGHT - PAD_BOTTOM;
  const plotH = base - PAD_TOP;

  const geo = useMemo(() => {
    const x = (t: number) => ((t - fromMs) / span) * width;
    const y = (v: number) => PAD_TOP + plotH * (1 - Math.min(1, Math.max(0, v / yMax)));
    const nowLevel = levelAt(series, win.nowMs, halfLifeHours) ?? 0;
    const nowPoint = { t: win.nowMs, level: nowLevel };
    const past = [...series.filter((p) => p.t <= win.nowMs), nowPoint];
    const future = [nowPoint, ...series.filter((p) => p.t > win.nowMs)];
    const pastLine = pathOf(past, x, y);
    const futureLine = pathOf(future, x, y);
    const close = (pts: readonly LevelPoint[], line: string) =>
      pts.length > 1 ? `${line} L${x(pts[pts.length - 1].t).toFixed(1)},${base} L${x(pts[0].t).toFixed(1)},${base} Z` : "";
    const pins = pinsFor(checkins, win.from, win.nowMs, x, PIN_LABEL_GAP);
    const ticks = dayTicks(win.from, win.to, win.nowMs, tickDays);
    const doseXs = doses.map((d) => ({ dose: d, x: x(Date.parse(d.takenAt)) })).filter((d) => d.x >= 0 && d.x <= width);
    return { x, y, nowLevel, pastLine, futureLine, pastArea: close(past, pastLine), futureArea: close(future, futureLine), pins, ticks, doseXs };
  }, [series, win, halfLifeHours, yMax, checkins, doses, tickDays, width, fromMs, span, plotH, base]);

  // ── Scrub ──────────────────────────────────────────────────────────────
  const infoAt = (px: number): ScrubInfo => {
    const near = geo.doseXs.reduce<{ dose: DoseLog; x: number } | null>((best, d) => (Math.abs(d.x - px) <= SNAP_PX && (!best || Math.abs(d.x - px) < Math.abs(best.x - px)) ? d : best), null);
    const t = near ? Date.parse(near.dose.takenAt) : fromMs + (Math.min(width, Math.max(0, px)) / (width || 1)) * span;
    // At a dose, show the level just after it.
    const level = levelAt(series, near ? t + 1 : t, halfLifeHours) ?? 0;
    return { t, level, dose: near?.dose ?? null };
  };
  const show = (info: ScrubInfo | null) => {
    const doseId = info?.dose?.id ?? null;
    if (doseId && doseId !== touch.current.lastDose) haptic("select");
    touch.current.lastDose = doseId;
    setScrub(info);
    onScrub(info);
  };
  const onGrant = (e: GestureResponderEvent) => {
    touch.current = { x0: e.nativeEvent.pageX, y0: e.nativeEvent.pageY, isScrubbing: false, lastDose: null };
  };
  const onMove = (e: GestureResponderEvent) => {
    const t = touch.current;
    const dx = e.nativeEvent.pageX - t.x0;
    const dy = e.nativeEvent.pageY - t.y0;
    if (!t.isScrubbing && Math.abs(dx) > SCRUB_SLOP && Math.abs(dx) > Math.abs(dy)) {
      t.isScrubbing = true;
      haptic("select");
    }
    if (t.isScrubbing) show(infoAt(e.nativeEvent.locationX));
  };
  const onRelease = (e: GestureResponderEvent) => {
    if (touch.current.isScrubbing) {
      touch.current.isScrubbing = false;
      show(null);
      return;
    }
    // A tap toggles a sticky readout.
    show(scrub ? null : infoAt(e.nativeEvent.locationX));
  };
  const onTerminate = () => {
    touch.current.isScrubbing = false;
    show(null);
  };

  const sx = scrub ? geo.x(scrub.t) : 0;
  const sy = scrub ? geo.y(scrub.level) : 0;
  const tipLeft = Math.min(Math.max(sx - TOOLTIP_W / 2, 0), Math.max(width - TOOLTIP_W, 0));
  const scrubCheckin = scrub ? (checkins.find((c) => c.date === dayKey(new Date(scrub.t))) ?? null) : null;
  const xNow = geo.x(win.nowMs);
  const gradId = "levelFill";

  return (
    <View>
      <View style={{ height: HEIGHT }} onLayout={onLayout}>
        <View
          style={StyleSheet.absoluteFill}
          accessible
          accessibilityRole="image"
          accessibilityLabel={summary}
          accessibilityHint="Drag sideways on the chart to read the estimate at any moment"
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => !touch.current.isScrubbing}
          onResponderGrant={onGrant}
          onResponderMove={onMove}
          onResponderRelease={onRelease}
          onResponderTerminate={onTerminate}
        >
          {width > 0 ? (
            <Svg width={width} height={HEIGHT}>
              <Defs>
                <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={th.brand} stopOpacity={0.28} />
                  <Stop offset="1" stopColor={th.brand} stopOpacity={0.02} />
                </LinearGradient>
              </Defs>
              {[0.5, 1].map((f) => (
                <Line key={f} x1={0} x2={width} y1={geo.y(yMax * f)} y2={geo.y(yMax * f)} stroke={th.line} strokeWidth={1} strokeDasharray="2 4" />
              ))}
              <Line x1={0} x2={width} y1={base} y2={base} stroke={th.line} strokeWidth={1} />
              {/* Projection (after now) */}
              {geo.futureArea ? <Path d={geo.futureArea} fill={th.brand} fillOpacity={0.05} /> : null}
              <Path d={geo.futureLine} fill="none" stroke={th.brand} strokeOpacity={0.55} strokeWidth={2} strokeDasharray="4 4" strokeLinejoin="round" />
              {/* Estimate (up to now) */}
              {geo.pastArea ? <Path d={geo.pastArea} fill={`url(#${gradId})`} /> : null}
              <Path d={geo.pastLine} fill="none" stroke={th.brand} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              {/* Dose markers on the axis */}
              {geo.doseXs.map((d) => (
                <Rect key={d.dose.id} x={d.x - 1.5} y={base + 3} width={3} height={8} rx={1.5} fill={th.brand} />
              ))}
              {/* Now */}
              <Line x1={xNow} x2={xNow} y1={PAD_TOP} y2={base} stroke={th.inkSoft} strokeWidth={1} strokeDasharray="3 3" />
              <Circle cx={xNow} cy={geo.y(geo.nowLevel)} r={5} fill={th.brand} stroke={th.surface} strokeWidth={2} />
              {/* Check-ins */}
              {geo.pins.map((p) => {
                const cy = geo.y(levelAt(series, p.t, halfLifeHours) ?? 0);
                const px = geo.x(p.t);
                if (!p.hasEffects) return <Circle key={p.checkin.id} cx={px} cy={cy} r={3.5} fill={th.surface} stroke={th.status.done.solid} strokeWidth={1.5} />;
                const isSel = p.checkin.id === selectedPinId;
                const c = th.status.low;
                return (
                  <PinMark key={p.checkin.id} x={px} curveY={cy} isSelected={isSel} solid={c.solid} soft={c.soft} ring={th.surface} />
                );
              })}
              {scrub ? (
                <>
                  <Line x1={sx} x2={sx} y1={PAD_TOP - 6} y2={base} stroke={th.ink} strokeOpacity={0.5} strokeWidth={1} />
                  <Circle cx={sx} cy={sy} r={6} fill={th.brand} stroke={th.surface} strokeWidth={2} />
                </>
              ) : null}
            </Svg>
          ) : null}
        </View>

        {/* y labels sit on their gridlines, inside the plot */}
        {width > 0 ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {[0.5, 1].map((f) => (
              <AxisLabel key={f} style={[styles.yLabel, { top: geo.y(yMax * f) + 2 }]}>
                {amountText(yMax * f, unit)}
              </AxisLabel>
            ))}
            <View style={[styles.nowTag, { left: Math.min(Math.max(xNow + 4, 0), width - 36), top: base - 18, backgroundColor: th.surfaceAlt }]}>
              <TText variant="meta" color="soft" style={styles.nowText}>
                Now
              </TText>
            </View>
            {geo.pins.map((p) =>
              p.label ? (
                <View
                  key={p.checkin.id}
                  style={[styles.pinLabel, { left: Math.min(Math.max(geo.x(p.t) - PIN_LABEL_W / 2, 0), width - PIN_LABEL_W), backgroundColor: th.status.low.soft }]}
                >
                  <TText variant="meta" color={th.status.low.text} numberOfLines={1} style={styles.pinText}>
                    {p.label}
                  </TText>
                </View>
              ) : null,
            )}
          </View>
        ) : null}

        {/* Pin buttons (reachable by touch and screen readers) */}
        {width > 0
          ? geo.pins
              .filter((p) => p.hasEffects)
              .map((p) => <PinButton key={p.checkin.id} pin={p} x={geo.x(p.t)} isSelected={p.checkin.id === selectedPinId} onPress={onSelectPin} />)
          : null}

        {scrub ? (
          <View pointerEvents="none" style={[styles.tooltip, { left: tipLeft, backgroundColor: th.surface, borderColor: th.line }, th.shadow.float]}>
            <TText variant="meta" color="soft" numberOfLines={1}>
              {`${formatWeekdayDay(dayKey(new Date(scrub.t)))} · ${clock(new Date(scrub.t))}`}
            </TText>
            <TText variant="number" numberOfLines={1}>{`≈ ${amountText(scrub.level, unit)}`}</TText>
            {scrub.dose ? (
              <TText variant="meta" color="brand" numberOfLines={1}>{`Dose · ${formatDose(scrub.dose.dose)}`}</TText>
            ) : null}
            {scrubCheckin ? (
              <TText variant="meta" color={realEffects(scrubCheckin).length ? th.status.low.text : th.status.done.text} numberOfLines={1}>
                {realEffects(scrubCheckin).length ? effectsLabel(realEffects(scrubCheckin)) : "No side effects"}
              </TText>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.ticks} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {width > 0
          ? geo.ticks.map((tk) => (
              <AxisLabel key={tk.t} align="center" style={[styles.tick, { left: Math.min(Math.max(geo.x(tk.t) - TICK_W / 2, 0), Math.max(width - TICK_W, 0)) }]}>
                {tk.label}
              </AxisLabel>
            ))
          : null}
      </View>
    </View>
  );
}

function PinMark({ x, curveY, isSelected, solid, soft, ring }: { x: number; curveY: number; isSelected: boolean; solid: string; soft: string; ring: string }) {
  return (
    <>
      <Line x1={x} x2={x} y1={PIN_HEAD_Y} y2={curveY} stroke={solid} strokeWidth={isSelected ? 2 : 1.25} strokeDasharray={isSelected ? undefined : "2 2"} />
      <Circle cx={x} cy={curveY} r={3} fill={solid} />
      <Circle cx={x} cy={PIN_HEAD_Y} r={isSelected ? 8 : 6} fill={isSelected ? solid : soft} stroke={isSelected ? ring : solid} strokeWidth={2} />
    </>
  );
}

function PinButton({ pin, x, isSelected, onPress }: { pin: Pin; x: number; isSelected: boolean; onPress: (id: string | null) => void }) {
  const day = formatWeekdayDay(pin.checkin.date);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Side effects on ${day}: ${realEffects(pin.checkin).join(", ")}`}
      accessibilityHint={isSelected ? "Hides the details" : "Shows the check-in details under the chart"}
      accessibilityState={{ selected: isSelected }}
      onPress={() => {
        haptic("select");
        onPress(isSelected ? null : pin.checkin.id);
      }}
      hitSlop={2}
      style={[styles.pinHit, { left: x - TOUCH_MIN / 2, top: PIN_HEAD_Y - TOUCH_MIN / 2 + 4 }]}
    />
  );
}

const styles = StyleSheet.create({
  yLabel: { position: "absolute", left: 0, backgroundColor: "transparent" },
  nowTag: { position: "absolute", width: 36, alignItems: "center", borderRadius: TRADIUS.pill, paddingVertical: 1 },
  nowText: { fontSize: 11, lineHeight: 14 },
  pinLabel: { position: "absolute", top: PIN_LABEL_TOP, width: PIN_LABEL_W, alignItems: "center", borderRadius: TRADIUS.pill, paddingHorizontal: 6, paddingVertical: 1 },
  pinText: { fontSize: 11, lineHeight: 14 },
  pinHit: { position: "absolute", width: TOUCH_MIN, height: TOUCH_MIN },
  tooltip: { position: "absolute", top: PAD_TOP, width: TOOLTIP_W, borderRadius: TRADIUS.sm, borderWidth: StyleSheet.hairlineWidth, padding: TSPACE.sm, gap: 2 },
  ticks: { height: 16, marginTop: 2 },
  tick: { position: "absolute", width: TICK_W },
});
