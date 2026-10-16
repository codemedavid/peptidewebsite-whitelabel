import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { FadeIn, ZoomIn, useAnimatedStyle } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import type { StorePreview } from "@contract";
import { withAlpha } from "@/features/community/lib/color";
import { useTheme } from "@/theme/ThemeProvider";
import { StoreLogo, type AuthAccent } from "../sign-in/parts";
import { ChatChip, DropChip, ShippedChip } from "./chips";
import { useFloat, useSpin } from "./motion";

/**
 * The welcome screen's top half: PepWorld's mascot (or the linked store's
 * logo, with the mascot peeking) on its own little planet — slow orbit rings,
 * a soft glow, and feature cards drifting around it. Decorative only: screen
 * readers skip straight to the headline below.
 */

const MASCOT = require("../../../../assets/brand/pepworld-mark.png");
/** The mascot art is 679×539. */
const MASCOT_RATIO = 539 / 679;
/** Never let the stage sprawl on tablets / the web: cards stay near the mascot. */
const STAGE_MAX_WIDTH = 560;
/** Below this drawable size three cards would crowd the mascot — show one. */
const COMPACT_HEIGHT = 330;
const COMPACT_WIDTH = 350;
const GUTTER = 16;
/** The sheet below rises over the stage by this much. */
export const SHEET_OVERLAP = 28;

const ORBIT_SLOW_MS = 90_000;
const ORBIT_FAST_MS = 60_000;

type Props = {
  width: number;
  height: number;
  topInset: number;
  accent: AuthAccent;
  store: StorePreview | null;
};

export function HeroStage({ width, height, topInset, accent, store }: Props) {
  const t = useTheme();
  const dark = t.scheme === "dark";
  const stageWidth = Math.min(width, STAGE_MAX_WIDTH);
  // What's visible: under the status bar, above the sheet's lip.
  const area = height - topInset - SHEET_OVERLAP;
  const compact = area < COMPACT_HEIGHT || stageWidth < COMPACT_WIDTH;
  const centerY = topInset + area * 0.5;
  const orbit = Math.min(stageWidth * 0.98, area * 1.12);
  const hero = Math.min(stageWidth * 0.36, area * 0.36, 168);
  const chipMax = (stageWidth - GUTTER * 3) / 2;
  const wash = [
    withAlpha(accent.tint, dark ? 0.34 : 0.22),
    withAlpha(accent.tint, dark ? 0.12 : 0.08),
    withAlpha(accent.tint, 0),
  ] as const;

  return (
    <View
      style={[styles.stage, { height, backgroundColor: t.colors.bg }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...(Platform.OS === "web" ? { "aria-hidden": true } : null)}
    >
      <LinearGradient colors={wash} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <View style={[styles.inner, { width: stageWidth }]}>
        <Orbits size={orbit} centerY={centerY} color={accent.tint} glow={dark ? 0.32 : 0.26} />

        <View style={[styles.center, { top: centerY - hero / 2, height: hero }]}>
          {store ? <StoreCenterpiece size={hero} store={store} accent={accent} /> : <MascotCenterpiece size={hero} />}
        </View>

        {compact ? null : (
          <Slot at={{ top: topInset + area * 0.04, left: GUTTER, maxWidth: chipMax }} enterDelay={420} drift={5} period={3400}>
            <DropChip accent={accent} />
          </Slot>
        )}
        <Slot
          at={{ top: topInset + area * (compact ? 0.04 : 0.15), right: GUTTER, maxWidth: chipMax }}
          enterDelay={560}
          drift={6}
          period={3900}
          phase={500}
        >
          <ChatChip accent={accent} />
        </Slot>
        {compact ? null : (
          <Slot
            at={{ bottom: SHEET_OVERLAP + area * 0.03, right: GUTTER, maxWidth: chipMax }}
            enterDelay={840}
            drift={4}
            period={3200}
            phase={300}
          >
            <ShippedChip />
          </Slot>
        )}
      </View>
    </View>
  );
}

/** A card's place on the stage: springs in once, then drifts. */
function Slot({
  at,
  enterDelay,
  drift,
  period,
  phase = 0,
  children,
}: {
  at: ViewStyle;
  enterDelay: number;
  drift: number;
  period: number;
  phase?: number;
  children: ReactNode;
}) {
  const { style } = useFloat({ distance: drift, duration: period, delay: phase, tilt: 0.6 });
  return (
    <Animated.View entering={ZoomIn.springify().damping(14).mass(0.8).delay(enterDelay)} style={[styles.slot, at]}>
      <Animated.View style={style}>{children}</Animated.View>
    </Animated.View>
  );
}

/** Two thin rings turning opposite ways, beads riding them, a glow behind it all. */
function Orbits({ size, centerY, color, glow }: { size: number; centerY: number; color: string; glow: number }) {
  const outer = useSpin(ORBIT_SLOW_MS, 1);
  const innerSpin = useSpin(ORBIT_FAST_MS, -1);
  const r = size / 2;
  const outerR = r - 6;
  const innerR = r * 0.66;
  const ring = withAlpha(color, 0.3);
  const bead = (radius: number, angle: number) => ({ cx: r + radius * Math.cos(angle), cy: r + radius * Math.sin(angle) });

  return (
    <Animated.View
      entering={FadeIn.duration(900)}
      style={[styles.orbit, { width: size, height: size, top: centerY - r, left: "50%", marginLeft: -r }]}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="welcome-glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={glow} />
            <Stop offset="0.6" stopColor={color} stopOpacity={glow * 0.25} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={r} cy={r} r={innerR} fill="url(#welcome-glow)" />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, outer]}>
        <Svg width={size} height={size}>
          <Circle cx={r} cy={r} r={outerR} stroke={ring} strokeWidth={1} strokeDasharray="2 7" fill="none" />
          <Circle {...bead(outerR, 0.6)} r={5} fill={color} />
          <Circle {...bead(outerR, 3.6)} r={3} fill={withAlpha(color, 0.6)} />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, innerSpin]}>
        <Svg width={size} height={size}>
          <Circle cx={r} cy={r} r={innerR} stroke={ring} strokeWidth={1.25} fill="none" />
          <Circle {...bead(innerR, 2.2)} r={4} fill={withAlpha(color, 0.85)} />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

/** The mascot, bobbing over its shadow. */
function MascotCenterpiece({ size }: { size: number }) {
  const t = useTheme();
  const height = size * MASCOT_RATIO;
  const { progress, style } = useFloat({ distance: 7, duration: 2600, tilt: 2.5 });
  // Up (progress 0) → the shadow tightens and fades; down → it spreads.
  const shadow = useAnimatedStyle(() => ({
    opacity: 0.35 + progress.value * 0.3,
    transform: [{ scaleX: 0.78 + progress.value * 0.22 }],
  }));

  return (
    <Animated.View entering={ZoomIn.springify().damping(11).delay(120)} style={styles.centerStack}>
      <Animated.View style={style}>
        <Image source={MASCOT} style={{ width: size, height }} contentFit="contain" />
      </Animated.View>
      <Animated.View style={[styles.shadow, { width: size * 0.62, backgroundColor: withAlpha(t.colors.text, 0.16) }, shadow]} />
    </Animated.View>
  );
}

/** A linked store: its logo on a raised tile, the mascot peeking from the corner. */
function StoreCenterpiece({ size, store, accent }: { size: number; store: StorePreview; accent: AuthAccent }) {
  const t = useTheme();
  const tile = size * 0.92;
  const peek = size * 0.46;
  const { style: tileFloat } = useFloat({ distance: 5, duration: 3000, tilt: 1 });
  const { style: peekFloat } = useFloat({ distance: 4, duration: 1800, delay: 400, tilt: 6 });

  return (
    <Animated.View entering={ZoomIn.springify().damping(12).delay(120)}>
      <Animated.View style={tileFloat}>
        <View
          style={[
            styles.tile,
            {
              width: tile,
              height: tile,
              borderRadius: tile * 0.3,
              backgroundColor: t.colors.surface,
              borderColor: withAlpha(accent.tint, 0.45),
              boxShadow: `0 22px 40px -22px ${withAlpha(accent.tint, 0.9)}`,
            },
          ]}
        >
          <StoreLogo choice={store} size={tile - 20} />
        </View>
      </Animated.View>
      <Animated.View
        entering={ZoomIn.springify().damping(9).delay(620)}
        style={[styles.peek, { right: -peek * 0.55, bottom: -peek * 0.3 }]}
      >
        <Animated.View style={peekFloat}>
          <Image source={MASCOT} style={{ width: peek, height: peek * MASCOT_RATIO }} contentFit="contain" />
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: { width: "100%", overflow: "hidden" },
  inner: { flex: 1, alignSelf: "center" },
  orbit: { position: "absolute", pointerEvents: "none" },
  center: { position: "absolute", left: 0, right: 0, alignItems: "center", justifyContent: "center" },
  centerStack: { alignItems: "center" },
  shadow: { height: 10, borderRadius: 999, marginTop: 6 },
  slot: { position: "absolute" },
  tile: { alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  peek: { position: "absolute", transform: [{ rotate: "-10deg" }] },
});
