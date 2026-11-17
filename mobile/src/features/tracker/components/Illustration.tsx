/**
 * Small SVG illustrations in the store's colours (no image assets):
 *  - TrackerIllustration  a countdown ring around a vial with a check badge
 *  - ShieldIllustration   the disclaimer step
 *  - BellIllustration     the reminders step
 * Decorative: hidden from screen readers.
 */
import Svg, { Circle, G, Path, Rect } from "react-native-svg";
import { useTrackerTheme } from "./theme";

type Props = { size?: number; /** Drawn on the brand hero (light strokes). */ onBrand?: boolean };

function useInk(onBrand?: boolean) {
  const th = useTrackerTheme();
  return onBrand
    ? { main: th.onBrand, soft: th.onBrandLine, accent: th.onBrand, accentInk: th.brand, track: th.onBrandLine }
    : { main: th.brand, soft: th.brandSoft, accent: th.status.done.solid, accentInk: th.status.done.soft, track: th.line };
}

export function TrackerIllustration({ size = 160, onBrand }: Props) {
  const c = useInk(onBrand);
  return (
    <Svg width={size} height={size} viewBox="0 0 160 160" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx={80} cy={80} r={66} fill={c.soft} />
      <Circle cx={80} cy={80} r={56} stroke={c.track} strokeWidth={8} fill="none" />
      <Path d="M80 24 A56 56 0 1 1 31.5 108" stroke={c.main} strokeWidth={8} strokeLinecap="round" fill="none" />
      <G>
        <Rect x={66} y={50} width={28} height={8} rx={2} fill={c.main} />
        <Rect x={62} y={58} width={36} height={52} rx={8} fill={c.main} opacity={0.9} />
        <Rect x={68} y={78} width={24} height={26} rx={4} fill={c.soft} />
      </G>
      <Circle cx={118} cy={118} r={18} fill={c.accent} />
      <Path d="M110 118 l6 6 l11 -12" stroke={c.accentInk} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export function ShieldIllustration({ size = 140, onBrand }: Props) {
  const c = useInk(onBrand);
  return (
    <Svg width={size} height={size} viewBox="0 0 140 140" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx={70} cy={70} r={60} fill={c.soft} />
      <Path d="M70 28 L102 40 V68 C102 90 88 104 70 112 C52 104 38 90 38 68 V40 Z" fill={c.main} />
      <Path d="M56 70 l10 10 l18 -20" stroke={c.soft} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export function BellIllustration({ size = 140, onBrand }: Props) {
  const c = useInk(onBrand);
  return (
    <Svg width={size} height={size} viewBox="0 0 140 140" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx={70} cy={70} r={60} fill={c.soft} />
      <Path d="M70 34 C54 34 46 46 46 60 V78 L38 90 H102 L94 78 V60 C94 46 86 34 70 34 Z" fill={c.main} />
      <Circle cx={70} cy={98} r={8} fill={c.main} />
      <Circle cx={98} cy={42} r={12} fill={c.accent} />
    </Svg>
  );
}
