/**
 * PROGRESS (TRACKER.md §4): the estimated level curve with side effects
 * pinned on it (the hero), consistency, how you've felt, weight and
 * milestones. Every card has a greyed sample for its empty state, so the
 * screen is never blank (Shotsy's blank dashboard is a known gap).
 * Heavy maths re-runs at most every few minutes (useSettledNow), not on
 * every clock tick.
 */
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useTrackerState } from "../../hooks";
import { cyclePosition, heatmap, milestones } from "../../lib/consistency";
import { dayKey } from "../../lib/ids";
import { DisclaimerFooter } from "../kit";
import { TSPACE } from "../theme";
import { useSettledNow } from "./chart-kit";
import { CheckInTrends } from "./CheckInTrends";
import { ConsistencyCard, type CycleItem } from "./ConsistencyCard";
import { LevelCard } from "./LevelCard";
import { Milestones } from "./Milestones";
import { adherence, checkInTrends } from "./progress-model";
import { WeightCard } from "./WeightCard";

export type ProgressViewProps = { now: Date };

const HEATMAP_WEEKS = 12;

export function ProgressView({ now }: ProgressViewProps) {
  const { data } = useTrackerState();
  const settled = useSettledNow(now);
  const today = dayKey(settled);

  const view = useMemo(() => {
    const { protocols, doses, skips, vials } = data;
    const cycles: CycleItem[] = protocols
      .filter((p) => p.status === "active")
      .flatMap((p) => {
        const pos = cyclePosition(p, settled);
        return pos ? [{ protocol: p, pos }] : [];
      });
    return {
      adherence: adherence(protocols, doses, skips, settled),
      weeks: heatmap(protocols, doses, skips, settled, HEATMAP_WEEKS),
      cycles,
      earned: milestones(protocols, doses, skips, vials, settled),
    };
  }, [data, settled]);

  const trends = useMemo(() => checkInTrends(data.checkins, settled), [data.checkins, settled]);

  return (
    <View style={styles.wrap}>
      <LevelCard now={now} />
      <ConsistencyCard adherence={view.adherence} weeks={view.weeks} today={today} cycles={view.cycles} />
      <CheckInTrends trends={trends} today={today} />
      <WeightCard checkins={data.checkins} unit={data.settings.weightUnit} today={today} />
      <Milestones earned={view.earned} today={today} />
      <DisclaimerFooter />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: TSPACE.lg },
});
