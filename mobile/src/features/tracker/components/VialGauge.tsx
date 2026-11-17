/**
 * Vial picture (ported from MamaMicaGlow VialGauge, drawn in the store palette —
 * no literals): a drawn vial whose liquid sits at what's left (sealed = a full
 * vial under a cap band; finished = empty). Inventory only.
 *
 * v1 shows no syringe picture or units/mL draw anywhere (App Store 1.4.2): the
 * units/mL converter is a later feature behind `mobile.tracker.converter`.
 * Static (nothing to reduce under Reduce motion) and speaks one label.
 */
import { View } from "react-native";
import Svg, { ClipPath, Defs, G, Line, Rect } from "react-native-svg";
import { useTrackerTheme } from "./theme";

// ── Vial ─────────────────────────────────────────────────────────────────

const VW = 40;
const VH = 64;
const CAP_H = 10;
const NECK_Y = CAP_H;
const NECK_H = 6;
const BODY_Y = NECK_Y + NECK_H;
const BODY_H = VH - BODY_Y - 1;
const BODY_X = 3;
const BODY_W = VW - BODY_X * 2;

type VialGaugeProps = {
  /** 0–100 left. */
  pct: number;
  /** The liquid colour (status: brand / low / missed / faint). */
  color: string;
  isSealed?: boolean;
  /** Rendered height in pt (width follows). */
  height?: number;
  /** Spoken; omit when the row around it already says it. */
  label?: string;
};

export function VialGauge({ pct, color, isSealed, height = 56, label }: VialGaugeProps) {
  const th = useTrackerTheme();
  const level = Math.max(0, Math.min(100, pct)) / 100;
  const liquidH = BODY_H * level;
  return (
    <View
      accessible={!!label}
      accessibilityRole={label ? "image" : undefined}
      accessibilityLabel={label}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}
      accessibilityElementsHidden={!label}
    >
      <Svg width={(height * VW) / VH} height={height} viewBox={`0 0 ${VW} ${VH}`}>
        <Defs>
          <ClipPath id="vialBody">
            <Rect x={BODY_X} y={BODY_Y} width={BODY_W} height={BODY_H} rx={7} />
          </ClipPath>
        </Defs>
        {/* Cap: brand when sealed, else neutral. */}
        <Rect x={BODY_X + 4} y={0} width={BODY_W - 8} height={CAP_H} rx={3} fill={isSealed ? th.brand : th.inkFaint} />
        <Rect x={BODY_X + 7} y={NECK_Y} width={BODY_W - 14} height={NECK_H} fill={th.line} />
        <G clipPath="url(#vialBody)">
          <Rect x={BODY_X} y={BODY_Y} width={BODY_W} height={BODY_H} fill={th.surfaceAlt} />
          <Rect x={BODY_X} y={BODY_Y + BODY_H - liquidH} width={BODY_W} height={liquidH} fill={color} opacity={isSealed ? 0.45 : 0.9} />
          {/* A highlight down the glass. */}
          <Rect x={BODY_X + 5} y={BODY_Y + 6} width={3} height={BODY_H - 14} rx={1.5} fill={th.surface} opacity={0.55} />
        </G>
        <Rect x={BODY_X} y={BODY_Y} width={BODY_W} height={BODY_H} rx={7} stroke={th.inkSoft} strokeWidth={1.5} fill="none" />
        {[0.25, 0.5, 0.75].map((f) => (
          <Line key={f} x1={BODY_X + BODY_W - 9} x2={BODY_X + BODY_W - 2} y1={BODY_Y + BODY_H * f} y2={BODY_Y + BODY_H * f} stroke={th.inkSoft} strokeWidth={1} opacity={0.6} />
        ))}
      </Svg>
    </View>
  );
}
