/**
 * The month (ported from MamaMicaGlow MonthGrid, extended): one cell per day
 * with the shared DayMark (all taken / partial / missed / planned), a skip
 * glyph when every due dose was skipped, shading on cycle off-days, a ring on
 * today, and — when showing every protocol — one small dot per protocol
 * (filled = taken). Cells outside the month stay empty. Every state has a
 * shape or a word, never colour alone.
 */
import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { DayInfo } from "../../lib/consistency";
import { formatWeekdayDay, parseDayKey, WEEKDAY_LETTERS } from "../../lib/ids";
import { haptic, TText } from "../kit";
import { TRADIUS, TSPACE, useTrackerTheme } from "../theme";
import { DAY_SPOKEN, DayMark } from "../WeekDots";
import type { DayExtra } from "./calendar-model";

const MARK = 22;
const MAX_DOTS = 3;
const CELL_H = 64;

type Props = {
  cells: readonly (string | null)[];
  days: ReadonlyMap<string, DayInfo>;
  extras: ReadonlyMap<string, DayExtra>;
  today: string;
  selected: string;
  showDots: boolean;
  onSelect: (day: string) => void;
};

export function MonthGrid({ cells, days, extras, today, selected, showDots, onSelect }: Props) {
  const th = useTrackerTheme();
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  return (
    <View style={styles.wrap}>
      <View style={styles.row} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {WEEKDAY_LETTERS.map((l, i) => (
          <TText key={i} variant="micro" color={th.inkFaint} style={styles.head}>
            {l}
          </TText>
        ))}
      </View>
      {weeks.map((week, w) => (
        <View key={w} style={styles.row}>
          {week.map((day, i) =>
            day ? (
              <Cell
                key={day}
                day={day}
                info={days.get(day) ?? null}
                extra={extras.get(day) ?? null}
                isToday={day === today}
                isSelected={day === selected}
                showDots={showDots}
                onSelect={onSelect}
              />
            ) : (
              <View key={`blank-${w}-${i}`} style={styles.cell} />
            ),
          )}
        </View>
      ))}
    </View>
  );
}

type CellProps = {
  day: string;
  info: DayInfo | null;
  extra: DayExtra | null;
  isToday: boolean;
  isSelected: boolean;
  showDots: boolean;
  onSelect: (day: string) => void;
};

const Cell = memo(function Cell({ day, info, extra, isToday, isSelected, showDots, onSelect }: CellProps) {
  const th = useTrackerTheme();
  const state = info?.state ?? "rest";
  const isOff = (extra?.offCycle.length ?? 0) > 0;
  const isSkipped = extra?.allSkipped ?? false;
  const dots = showDots ? (extra?.dots ?? []).slice(0, MAX_DOTS) : [];
  const doseCount = info ? info.slots.length + info.extras.length : 0;
  const spokenState = isSkipped ? "skipped" : isOff && state === "rest" ? "off-cycle day" : DAY_SPOKEN[state];
  const spoken = `${isToday ? "Today, " : ""}${formatWeekdayDay(day)}, ${spokenState}${doseCount > 1 ? `, ${doseCount} doses` : ""}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityState={{ selected: isSelected }}
      onPress={() => {
        haptic("select");
        onSelect(day);
      }}
      style={({ pressed }) => [
        styles.cell,
        isOff ? { backgroundColor: th.surfaceAlt } : null,
        isSelected ? { backgroundColor: th.brandTint, borderColor: th.brand } : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <TText variant="meta" tabular color={isToday ? th.brandText : "ink"} style={styles.num}>
        {String(parseDayKey(day).getDate())}
      </TText>
      {isSkipped ? (
        <View style={[styles.skip, { backgroundColor: th.status.skipped.soft }, isToday ? { borderWidth: 2, borderColor: th.brand } : null]}>
          <Ionicons name="play-skip-forward" size={11} color={th.status.skipped.text} />
        </View>
      ) : isOff && state === "rest" ? (
        <View style={[styles.off, isToday ? { borderWidth: 2, borderColor: th.brand } : null]}>
          <Ionicons name="moon-outline" size={12} color={th.inkFaint} />
        </View>
      ) : (
        <DayMark state={state} size={MARK - (isToday ? 6 : 0)} isToday={isToday} />
      )}
      <View style={styles.dots}>
        {dots.map((d) => (
          <View key={d.protocolId} style={[styles.dot, { borderColor: d.color, backgroundColor: d.isTaken ? d.color : "transparent" }]} />
        ))}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  row: { flexDirection: "row" },
  head: { flex: 1, textAlign: "center", paddingBottom: TSPACE.xs },
  cell: {
    flex: 1,
    minHeight: CELL_H,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: TRADIUS.sm,
    borderWidth: 1.5,
    borderColor: "transparent",
    margin: 1,
  },
  pressed: { opacity: 0.6 },
  num: { fontSize: 13, lineHeight: 16 },
  skip: { width: MARK, height: MARK, borderRadius: MARK / 2, alignItems: "center", justifyContent: "center" },
  off: { width: MARK, height: MARK, borderRadius: MARK / 2, alignItems: "center", justifyContent: "center" },
  dots: { flexDirection: "row", gap: 2, height: 5 },
  dot: { width: 5, height: 5, borderRadius: 2.5, borderWidth: 1 },
});
