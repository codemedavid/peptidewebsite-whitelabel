/**
 * Chart building blocks shared by the Progress cards, so every chart speaks
 * one visual language: the same axis type (meta, 11 pt, tabular, faint), the
 * same "Sample" treatment for empty states, and the same sparkline.
 *
 *   useChartWidth   measured width for an SVG (0 until laid out)
 *   useSettledNow   `now` that only changes every few minutes (cheap memos)
 *   AxisLabel       axis / tick text in the chart type
 *   SampleFrame     greys out a sample visual and tags it "Sample"
 *   Sparkline       a small line over fixed-domain values (1–5 scales)
 *   Legend          swatch + word rows (colour is never the only cue)
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type TextStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { Pill, TText } from "../kit";
import { TSPACE } from "../theme";

/** Recompute derived stats at most this often (the tab's clock ticks every 15 s). */
const SETTLE_MS = 5 * 60_000;

export function useChartWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    setWidth((prev) => (prev === next ? prev : next));
  }, []);
  return [width, onLayout];
}

/** `now` rounded down to a 5-minute bucket, so heavy memos don't re-run every tick. */
export function useSettledNow(now: Date, bucketMs = SETTLE_MS): Date {
  const bucket = Math.floor(now.getTime() / bucketMs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => new Date(now.getTime()), [bucket]);
}

export function AxisLabel({ children, color = "faint", style, align }: { children: ReactNode; color?: string; style?: StyleProp<TextStyle>; align?: "left" | "center" | "right" }) {
  return (
    <TText variant="meta" color={color} tabular numberOfLines={1} style={[styles.axis, align ? { textAlign: align } : null, style]}>
      {children}
    </TText>
  );
}

/** A greyed, clearly-labelled sample (empty states): hidden from screen readers, described by `label`. */
export function SampleFrame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <View style={styles.dim} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {children}
      </View>
      <View style={styles.sampleTag} pointerEvents="none">
        <Pill label="Sample" icon="eye-outline" />
      </View>
    </View>
  );
}

type SparkProps = {
  values: readonly (number | null)[];
  min: number;
  max: number;
  width: number;
  height: number;
  color: string;
  /** Faint baseline at `min`. */
  track?: string;
};

/** A line through the non-null values (gaps break the line); the last value gets a dot. */
export function Sparkline({ values, min, max, width, height, color, track }: SparkProps) {
  const pad = 3;
  const span = max - min || 1;
  const n = values.length;
  const x = (i: number) => (n > 1 ? pad + (i * (width - pad * 2)) / (n - 1) : width / 2);
  const y = (v: number) => pad + (height - pad * 2) * (1 - (v - min) / span);
  let d = "";
  let pen = false;
  let last: { x: number; y: number } | null = null;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const px = x(i);
    const py = y(v);
    d += `${pen ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)} `;
    pen = true;
    last = { x: px, y: py };
  });
  const end = last as { x: number; y: number } | null;
  if (width <= 0) return null;
  return (
    <Svg width={width} height={height}>
      {track ? <Path d={`M${pad},${height - pad} L${width - pad},${height - pad}`} stroke={track} strokeWidth={1} /> : null}
      {d ? <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
      {end ? <Circle cx={end.x} cy={end.y} r={3} fill={color} /> : null}
    </Svg>
  );
}

export type LegendItem = { key: string; label: string; swatch: ReactNode };

export function Legend({ items }: { items: readonly LegendItem[] }) {
  return (
    <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {items.map((it) => (
        <View key={it.key} style={styles.legendItem}>
          {it.swatch}
          <TText variant="meta" color="soft" style={styles.legendText}>
            {it.label}
          </TText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { fontSize: 11, lineHeight: 14 },
  dim: { opacity: 0.4 },
  sampleTag: { position: "absolute", top: TSPACE.sm, right: TSPACE.sm },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: TSPACE.md, rowGap: TSPACE.xs },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendText: { fontSize: 12, lineHeight: 16 },
});
