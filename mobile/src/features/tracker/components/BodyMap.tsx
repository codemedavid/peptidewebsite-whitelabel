/**
 * Injection-site picker (ported from MamaMicaGlow BodyMap, restyled): a front /
 * back toggle and one large figure with tappable zones coloured by recency
 * (lib/sites siteStates): Ready (rested) · Recovering (healing) · Used recently.
 * The suggestion is preselected and ringed, but ANY zone can be tapped —
 * nothing ever blocks a log. Screen readers get a radio group with each zone's
 * state and last use. Without `onChange` it's a read-only picture.
 */
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import Ionicons from "@expo/vector-icons/Ionicons";
import { siteA11yLabel, siteLabel, siteStates, SITES } from "../lib/sites";
import type { DoseLog, SiteId } from "../lib/types";
import { SITE_LOOK } from "./format";
import { Dot, haptic, SegmentedControl, TText } from "./kit";
import { TRADIUS, TSPACE, useTrackerTheme } from "./theme";

/** Zone boxes in % of a 100 × 160 figure. Front shows the user's left on the viewer's right. */
const ZONES: Record<SiteId, { left: number; top: number; width: number; height: number }> = {
  belly_ur: { left: 36, top: 29, width: 14, height: 9 },
  belly_ul: { left: 50, top: 29, width: 14, height: 9 },
  belly_lr: { left: 36, top: 38.5, width: 14, height: 9 },
  belly_ll: { left: 50, top: 38.5, width: 14, height: 9 },
  thigh_r: { left: 31, top: 60, width: 17, height: 18 },
  thigh_l: { left: 52, top: 60, width: 17, height: 18 },
  // Back: the user's left is on the viewer's left.
  arm_l: { left: 12, top: 22, width: 15, height: 18 },
  arm_r: { left: 73, top: 22, width: 15, height: 18 },
  glute_l: { left: 32, top: 49, width: 18, height: 11 },
  glute_r: { left: 50, top: 49, width: 18, height: 11 },
};

const BODY =
  "M42,26 L58,26 Q70,27 72,32 L84,74 Q85,78 81,79 L76,66 L70,44 L69,92 L64,155 L54,155 L51,100 L49,100 L46,155 L36,155 L31,92 L30,44 L24,66 L19,79 Q15,78 16,74 L28,32 Q30,27 42,26 Z";

const FIGURE_MAX_W = 220;

type View2 = "front" | "back";

type Props = {
  doses: readonly DoseLog[];
  now: Date;
  value: SiteId | null;
  onChange?: (site: SiteId | null) => void;
  suggested: SiteId | null;
};

export function BodyMap({ doses, now, value, onChange, suggested }: Props) {
  const th = useTrackerTheme();
  const states = useMemo(() => siteStates(doses, now), [doses, now]);
  const isReadOnly = !onChange;
  const focus = value ?? suggested;
  const [view, setView] = useState<View2>(() => SITES.find((s) => s.id === focus)?.view ?? "front");
  const look = (id: SiteId) => th.status[SITE_LOOK[states[id].state].status];

  return (
    <View style={styles.wrap}>
      <SegmentedControl
        label="Body view"
        options={[
          { key: "front", label: "Front" },
          { key: "back", label: "Back" },
        ]}
        value={view}
        onChange={setView}
      />
      <View style={styles.figureWrap}>
        <View style={styles.figure} accessibilityRole={isReadOnly ? undefined : "radiogroup"} accessibilityLabel="Injection site">
          <Svg width="100%" height="100%" viewBox="0 0 100 160" style={StyleSheet.absoluteFill}>
            <Circle cx={50} cy={14} r={10} fill={th.surfaceAlt} stroke={th.inkFaint} strokeWidth={0.8} />
            <Path d={BODY} fill={th.surfaceAlt} stroke={th.inkFaint} strokeWidth={0.8} strokeLinejoin="round" />
          </Svg>
          {SITES.filter((s) => s.view === view).map((s) => {
            const z = ZONES[s.id];
            const c = look(s.id);
            const isSelected = value === s.id;
            const isSuggested = suggested === s.id;
            return (
              <Pressable
                key={s.id}
                disabled={isReadOnly}
                onPress={() => {
                  haptic("select");
                  onChange?.(isSelected ? null : s.id);
                }}
                accessibilityRole={isReadOnly ? "text" : "radio"}
                accessibilityState={isReadOnly ? undefined : { checked: isSelected }}
                accessibilityLabel={`${siteA11yLabel(states[s.id])}${isSuggested ? ", suggested" : ""}`}
                hitSlop={4}
                style={[
                  styles.zone,
                  { left: `${z.left}%`, top: `${z.top}%`, width: `${z.width}%`, height: `${z.height}%` },
                  { backgroundColor: isSelected ? th.brand : c.soft, borderColor: isSelected || isSuggested ? th.brand : c.solid },
                  isSuggested && !isSelected ? styles.suggested : null,
                ]}
              >
                {isSelected ? <Ionicons name="checkmark" size={16} color={th.onBrand} /> : null}
              </Pressable>
            );
          })}
        </View>
        <View style={styles.sides} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <TText variant="micro" color="faint">
            {view === "front" ? "Right" : "Left"}
          </TText>
          <TText variant="micro" color="faint">
            {view === "front" ? "Left" : "Right"}
          </TText>
        </View>
      </View>
      <View style={styles.legend}>
        {(["rested", "healing", "recent"] as const).map((k) => (
          <View key={k} style={styles.legendItem}>
            <Dot color={th.status[SITE_LOOK[k].status].soft} ring={th.status[SITE_LOOK[k].status].solid} size={14} />
            <TText variant="meta" color="soft">
              {SITE_LOOK[k].word}
            </TText>
          </View>
        ))}
      </View>
      {value ? (
        <TText variant="bodyStrong" accessibilityLabel={`Selected site: ${siteA11yLabel(states[value])}`}>
          {`${siteLabel(value)} · ${SITE_LOOK[states[value].state].word}`}
        </TText>
      ) : suggested && !isReadOnly ? (
        <TText variant="meta" color="soft">{`Suggested: ${siteLabel(suggested)}`}</TText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: TSPACE.md },
  figureWrap: { alignSelf: "center", width: "70%", maxWidth: FIGURE_MAX_W, gap: 4 },
  figure: { width: "100%", aspectRatio: 100 / 160 },
  zone: { position: "absolute", borderRadius: TRADIUS.xs, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  suggested: { borderWidth: 3, borderStyle: "dashed" },
  sides: { flexDirection: "row", justifyContent: "space-between" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: TSPACE.md, justifyContent: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
});
