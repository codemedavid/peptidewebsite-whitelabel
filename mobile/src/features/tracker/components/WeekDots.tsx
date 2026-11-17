/**
 * Day marks (ported from MamaMicaGlow WeekDots, restyled): one mark per day,
 * shared by Today's week strip, the Calendar month grid and Progress heatmaps.
 *
 *   kept / logged  solid "done" + ✓      partial   half-filled "done"
 *   missed         soft "missed" + ✕     planned   open ring
 *   rest           a small dot           today     brand ring around the mark
 */
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { DayInfo, DayState } from "../lib/consistency";
import { formatWeekdayDay, WEEKDAY_LETTERS } from "../lib/ids";
import { haptic, TText } from "./kit";
import { TOUCH_MIN, useTrackerTheme } from "./theme";

export const DAY_SPOKEN: Record<DayState, string> = {
  kept: "all doses taken",
  partial: "some doses taken",
  missed: "missed",
  planned: "doses planned",
  rest: "rest day",
  logged: "logged",
};

type DayMarkProps = { state: DayState; size?: number; isToday?: boolean };

export function DayMark({ state, size = 26, isToday }: DayMarkProps) {
  const th = useTrackerTheme();
  const done = th.status.done;
  const missed = th.status.missed;
  const glyph = Math.round(size * 0.55);
  const box = { width: size, height: size, borderRadius: size / 2 };
  let inner;
  switch (state) {
    case "kept":
    case "logged":
      inner = (
        <View style={[styles.mark, box, { backgroundColor: done.solid }]}>
          <Ionicons name="checkmark" size={glyph} color={done.soft} />
        </View>
      );
      break;
    case "partial":
      inner = (
        <View style={[styles.mark, box, { backgroundColor: done.soft, borderWidth: 2, borderColor: done.solid }]}>
          <View style={[styles.half, { width: size / 2 - 2, height: size - 4, borderTopLeftRadius: size, borderBottomLeftRadius: size, backgroundColor: done.solid }]} />
        </View>
      );
      break;
    case "missed":
      inner = (
        <View style={[styles.mark, box, { backgroundColor: missed.soft }]}>
          <Ionicons name="close" size={glyph} color={missed.solid} />
        </View>
      );
      break;
    case "planned":
      inner = <View style={[styles.mark, box, { borderWidth: 2, borderColor: th.line }]} />;
      break;
    case "rest":
      inner = (
        <View style={[styles.mark, box]}>
          <View style={[styles.restDot, { backgroundColor: th.inkFaint }]} />
        </View>
      );
      break;
  }
  if (!isToday) return inner;
  return <View style={[styles.todayRing, { borderColor: th.brand, borderRadius: size }]}>{inner}</View>;
}

type WeekDotsProps = {
  days: DayInfo[];
  /** YYYY-MM-DD */
  today: string;
  /** Tap a day (e.g. open it in Calendar). Omit for a read-only strip. */
  onDay?: (day: string) => void;
  /** Greyed sample (empty state): not interactive, not read out per day. */
  isSample?: boolean;
};

/** Sunday → Saturday with a mark per day. */
export function WeekDots({ days, today, onDay, isSample }: WeekDotsProps) {
  const th = useTrackerTheme();
  return (
    <View style={styles.row} accessibilityElementsHidden={isSample} importantForAccessibility={isSample ? "no-hide-descendants" : "auto"}>
      {days.map((d, i) => {
        const isToday = d.day === today;
        return (
          <Pressable
            key={d.day}
            disabled={!onDay || isSample}
            onPress={() => {
              haptic("select");
              onDay?.(d.day);
            }}
            accessibilityRole={onDay ? "button" : "text"}
            accessibilityLabel={`${isToday ? "Today, " : ""}${formatWeekdayDay(d.day)}, ${DAY_SPOKEN[d.state]}`}
            style={({ pressed }) => [styles.cell, pressed ? { opacity: 0.6 } : null]}
          >
            <TText variant="micro" color={isToday ? th.brandText : "faint"}>
              {WEEKDAY_LETTERS[i % 7]}
            </TText>
            <DayMark state={d.state} isToday={isToday} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between" },
  cell: { alignItems: "center", gap: 6, minWidth: 36, minHeight: TOUCH_MIN + 12, flex: 1 },
  mark: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  half: { position: "absolute", left: 0 },
  restDot: { width: 4, height: 4, borderRadius: 2 },
  todayRing: { padding: 2, borderWidth: 2 },
});
