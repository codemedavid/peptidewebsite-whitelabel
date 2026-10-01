import { useMemo, useRef, useState } from "react";
import { StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import * as Haptics from "expo-haptics";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { AppText } from "../primitives";

export type ChartPoint = { label: string; longLabel: string; value: number; valueLabel: string; detail?: string };

const PAD_TOP = 12;
const PAD_BOTTOM = 4;
const MAX_TICKS = 5;
const GRID_LINES = 3;
const TOOLTIP_W = 140;
const TICK_W = 48;

/**
 * One series over time: a 2px line with a faint fill down to a zero baseline,
 * recessive gridlines, and a few x labels. Press-and-drag scrubs a crosshair;
 * the parent gets the scrubbed index (the hero number follows the finger) and
 * a tooltip shows the exact value — so nothing is read off the axis by eye.
 */
export function AreaChart({
  points,
  height = 150,
  onBand,
  onScrub,
  accessibilityLabel,
}: {
  points: ChartPoint[];
  height?: number;
  /** Drawn on the dark hero band. */
  onBand?: boolean;
  onScrub?: (index: number | null) => void;
  accessibilityLabel: string;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const last = useRef<number | null>(null);

  const stroke = onBand ? t.colors.chartOnBand : t.colors.chart;
  const grid = onBand ? t.colors.bandLine : t.colors.chartTrack;
  const labelColor = onBand ? t.colors.bandMuted : t.colors.textFaint;
  const ring = onBand ? t.colors.band : t.colors.surface;

  const geo = useMemo(() => {
    const max = Math.max(...points.map((p) => p.value), 0);
    const plotH = height - PAD_TOP - PAD_BOTTOM;
    const step = points.length > 1 ? width / (points.length - 1) : 0;
    const x = (i: number) => (points.length > 1 ? i * step : width / 2);
    const y = (v: number) => PAD_TOP + plotH - (max > 0 ? (v / max) * plotH : 0);
    const coords = points.map((p, i) => [x(i), y(p.value)] as const);
    const line = coords.map(([cx, cy], i) => `${i ? "L" : "M"}${cx.toFixed(1)},${cy.toFixed(1)}`).join(" ");
    const base = PAD_TOP + plotH;
    const area = coords.length
      ? `${line} L${coords[coords.length - 1][0].toFixed(1)},${base} L${coords[0][0].toFixed(1)},${base} Z`
      : "";
    return { coords, line, area, base, step, plotH };
  }, [points, width, height]);

  const tickEvery = Math.max(1, Math.ceil(points.length / MAX_TICKS));

  const indexAt = (e: GestureResponderEvent): number => {
    if (points.length < 2 || geo.step === 0) return 0;
    const i = Math.round(e.nativeEvent.locationX / geo.step);
    return Math.min(points.length - 1, Math.max(0, i));
  };
  const scrub = (e: GestureResponderEvent) => {
    const i = indexAt(e);
    if (i === last.current) return;
    last.current = i;
    void Haptics.selectionAsync().catch(() => undefined);
    setActive(i);
    onScrub?.(i);
  };
  const release = () => {
    last.current = null;
    setActive(null);
    onScrub?.(null);
  };

  const a = active !== null ? points[active] : null;
  const ax = active !== null ? (geo.coords[active]?.[0] ?? 0) : 0;
  const ay = active !== null ? (geo.coords[active]?.[1] ?? 0) : 0;
  const tooltipLeft = Math.min(Math.max(ax - TOOLTIP_W / 2, 0), Math.max(width - TOOLTIP_W, 0));

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <View
        style={{ height }}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={scrub}
        onResponderMove={scrub}
        onResponderRelease={release}
        onResponderTerminate={release}
      >
        {width > 0 ? (
          <Svg width={width} height={height}>
            {Array.from({ length: GRID_LINES }, (_, i) => {
              const gy = PAD_TOP + (geo.plotH * i) / GRID_LINES;
              return <Line key={i} x1={0} x2={width} y1={gy} y2={gy} stroke={grid} strokeWidth={1} strokeDasharray="2 4" />;
            })}
            <Line x1={0} x2={width} y1={geo.base} y2={geo.base} stroke={grid} strokeWidth={1} />
            <Path d={geo.area} fill={stroke} fillOpacity={onBand ? 0.16 : 0.1} />
            <Path d={geo.line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {a ? (
              <>
                <Line x1={ax} x2={ax} y1={0} y2={geo.base} stroke={stroke} strokeWidth={1} strokeOpacity={0.6} />
                <Circle cx={ax} cy={ay} r={5} fill={stroke} stroke={ring} strokeWidth={2} />
              </>
            ) : null}
          </Svg>
        ) : null}
        {a ? (
          <View
            pointerEvents="none"
            style={[styles.tooltip, { left: tooltipLeft, backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
          >
            <AppText variant="caption" color="muted" numberOfLines={1}>
              {a.longLabel}
            </AppText>
            <AppText variant="bodyStrong" numberOfLines={1} style={styles.tabular}>
              {a.valueLabel}
            </AppText>
            {a.detail ? (
              <AppText variant="caption" color="faint" numberOfLines={1}>
                {a.detail}
              </AppText>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.ticks}>
        {points.map((p, i) =>
          i % tickEvery === 0 || i === points.length - 1 ? (
            <AppText
              key={i}
              variant="caption"
              color={labelColor}
              style={[
                styles.tick,
                { left: Math.min(Math.max((geo.coords[i]?.[0] ?? 0) - TICK_W / 2, 0), Math.max(width - TICK_W, 0)) },
              ]}
            >
              {p.label}
            </AppText>
          ) : null,
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tooltip: {
    position: "absolute",
    top: -SPACE.sm,
    width: TOOLTIP_W,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabular: { fontVariant: ["tabular-nums"] },
  ticks: { height: 20, marginTop: 4 },
  tick: { position: "absolute", width: TICK_W, textAlign: "center", fontSize: 11 },
});
