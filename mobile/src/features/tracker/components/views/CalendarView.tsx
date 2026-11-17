/**
 * CALENDAR (TRACKER.md §4): the month at a glance → the chosen day.
 *
 *   header       month title (announced on change), prev / next, the month's
 *                tally and a "Today" jump when you've wandered off
 *   filter       All + each protocol (colour dot) when there are several
 *   MonthGrid    day marks, skips, cycle off-days, protocol dots, today ring;
 *                swipe sideways to change month (transform + opacity only,
 *                an instant switch under Reduce motion)
 *   DayList      the selected day: edit / log late / skip / undo / check-in
 *
 * `initialDate` (?date=) comes from Today's week strip.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View, type GestureResponderEvent } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { router } from "expo-router";
import { skipDose, undoSkip, useHistory, useProtocols, useTrackerState } from "../../hooks";
import type { DayInfo } from "../../lib/consistency";
import { dayKey, isDayKey } from "../../lib/ids";
import type { Slot } from "../../lib/today";
import { confirm } from "../dialog";
import { Card, DisclaimerFooter, haptic, IconButton, PressButton, TText } from "../kit";
import { trackerHref } from "../routes";
import { SkipSheet } from "../SkipSheet";
import { TMOTION, TRADIUS, TSPACE, useTrackerTheme } from "../theme";
import { showTrackerToast } from "../toast";
import { DayMark } from "../WeekDots";
import { dayExtras, monthCells, monthOf, monthTally, monthTitle, shiftMonth } from "./calendar-model";
import { DayList } from "./DayList";
import { Legend } from "./chart-kit";
import { MonthGrid } from "./MonthGrid";
import { ProtocolChips } from "./ProtocolChips";

export type CalendarViewProps = {
  now: Date;
  /** YYYY-MM-DD to open on (from ?date=). */
  initialDate?: string;
};

/** Sideways travel (pt) or speed that turns a drag into a month change. */
const SWIPE_DISTANCE = 56;
/** A quick drag (under this many ms) changes month with less travel. */
const FLICK_MS = 220;
/** A drag claims the gesture once it's clearly sideways. */
const SWIPE_SLOP = 14;
/** How far the grid follows the finger (a hint, not a carousel). */
const FOLLOW = 0.35;
const ENTER_OFFSET = 36;

export function CalendarView({ now, initialDate }: CalendarViewProps) {
  const reduced = useReducedMotion();
  const { data } = useTrackerState();
  const { protocols, byId } = useProtocols();
  const today = dayKey(now);
  const [selected, setSelected] = useState(() => (isDayKey(initialDate) ? initialDate : today));
  const [month, setMonth] = useState(() => monthOf(isDayKey(initialDate) ? initialDate : today));
  const [filterId, setFilterId] = useState<string | null>(null);
  const [skipping, setSkipping] = useState<Slot | null>(null);
  const filter = filterId && byId.has(filterId) ? filterId : null;

  const { days } = useHistory(month, filter, now);
  const scoped = useMemo(() => (filter ? protocols.filter((p) => p.id === filter) : protocols), [protocols, filter]);
  const view = useMemo(() => {
    const byDay = new Map<string, DayInfo>(days.map((d) => [d.day, d] as const));
    return { byDay, extras: dayExtras(days, scoped), tally: monthTally(days), cells: monthCells(month) };
  }, [days, scoped, month]);

  // ── Month change + swipe ───────────────────────────────────────────────
  const tx = useSharedValue(0);
  const fade = useSharedValue(1);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: tx.get() }], opacity: fade.get() }));

  const go = (dir: 1 | -1) => {
    const next = shiftMonth(month, dir);
    haptic("select");
    setMonth(next);
    setSelected(next === monthOf(today) ? today : `${next}-01`);
    if (reduced) {
      tx.set(0);
      fade.set(1);
      return;
    }
    tx.set(dir * ENTER_OFFSET);
    fade.set(0.25);
    tx.set(withTiming(0, { duration: TMOTION.sheet }));
    fade.set(withTiming(1, { duration: TMOTION.sheet }));
  };
  // Swipe: claim only clearly-sideways drags so the page still scrolls.
  const touch = useRef({ x: 0, y: 0, at: 0 });
  const dxOf = (e: GestureResponderEvent) => e.nativeEvent.pageX - touch.current.x;
  const swipe = {
    onTouchStart: (e: GestureResponderEvent) => {
      touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, at: e.nativeEvent.timestamp };
    },
    onMoveShouldSetResponderCapture: (e: GestureResponderEvent) => {
      const dx = dxOf(e);
      const dy = e.nativeEvent.pageY - touch.current.y;
      return Math.abs(dx) > SWIPE_SLOP && Math.abs(dx) > Math.abs(dy) * 1.5;
    },
    onResponderTerminationRequest: () => false,
    onResponderMove: (e: GestureResponderEvent) => {
      if (!reduced) tx.set(dxOf(e) * FOLLOW);
    },
    onResponderRelease: (e: GestureResponderEvent) => {
      const dx = dxOf(e);
      const isFlick = e.nativeEvent.timestamp - touch.current.at < FLICK_MS && Math.abs(dx) > SWIPE_SLOP * 2;
      if (Math.abs(dx) > SWIPE_DISTANCE || isFlick) go(dx < 0 ? 1 : -1);
      else tx.set(reduced ? 0 : withTiming(0, { duration: TMOTION.release }));
    },
    onResponderTerminate: () => tx.set(0),
  };

  const jumpToday = () => {
    haptic("select");
    setMonth(monthOf(today));
    setSelected(today);
  };

  const info: DayInfo = view.byDay.get(selected) ?? { day: selected, state: "rest", slots: [], extras: [] };
  const checkin = data.checkins.find((c) => c.date === selected) ?? null;
  const isAway = month !== monthOf(today) || selected !== today;
  const t = view.tally;
  const tallyText = [t.taken ? `${t.taken} taken` : null, t.missed ? `${t.missed} missed` : null, t.skipped ? `${t.skipped} skipped` : null, t.ahead ? `${t.ahead} ahead` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.wrap}>
      <Card style={styles.monthCard}>
        <View style={styles.header}>
          <View style={styles.fill}>
            <TText variant="title" accessibilityRole="header" accessibilityLiveRegion="polite" numberOfLines={1}>
              {monthTitle(month)}
            </TText>
            <TText variant="meta" color="soft" tabular numberOfLines={2}>
              {tallyText || "Nothing scheduled this month"}
            </TText>
          </View>
          <IconButton icon="chevron-back" label="Previous month" tone="alt" onPress={() => go(-1)} />
          <IconButton icon="chevron-forward" label="Next month" tone="alt" onPress={() => go(1)} />
        </View>
        {isAway ? <PressButton label="Today" icon="today-outline" size="sm" tone="soft" onPress={jumpToday} style={styles.today} /> : null}
        {protocols.length > 1 ? <ProtocolChips protocols={protocols} value={filter} onChange={setFilterId} label="Show one protocol" hasAll /> : null}

        <View {...swipe} accessibilityHint="Swipe left or right to change month">
          <Animated.View style={slide}>
            <MonthGrid
              cells={view.cells}
              days={view.byDay}
              extras={view.extras}
              today={today}
              selected={selected}
              showDots={filter === null && protocols.length > 1}
              onSelect={setSelected}
            />
          </Animated.View>
        </View>
        <CalendarLegend />
      </Card>

      {protocols.length === 0 ? (
        <Card tone="alt">
          <TText variant="body" color="soft">
            Set up a protocol and your doses, skips and check-ins fill this month in.
          </TText>
          <PressButton label="Set up a protocol" icon="add" size="md" onPress={() => router.push(trackerHref.protocolEdit())} />
        </Card>
      ) : null}

      <DayList
        info={info}
        today={today}
        protocols={byId}
        checkin={checkin}
        weightUnit={data.settings.weightUnit}
        offCycle={view.extras.get(selected)?.offCycle ?? []}
        onOpenDose={(d) => router.push(trackerHref.log({ doseId: d.id }))}
        onLogSlot={(s) => router.push(trackerHref.log({ protocolId: s.protocolId, slot: s.at.toISOString() }))}
        onSkipSlot={setSkipping}
        onUndoSkip={(s) => {
          const skip = s.skip;
          if (!skip) return;
          confirm("Undo this skip?", "The dose goes back to due or missed.", "Undo skip", () => undoSkip(skip.id), false);
        }}
        onCheckIn={() => router.push(trackerHref.checkin(selected))}
        onAddDose={() => router.push(trackerHref.log({ date: selected }))}
      />

      <DisclaimerFooter />

      <SkipSheet
        title={skipping ? (byId.get(skipping.protocolId)?.name ?? "dose") : null}
        onClose={() => setSkipping(null)}
        onSkip={(reason, note) => {
          if (skipping) {
            const skip = skipDose({ protocolId: skipping.protocolId, scheduledFor: skipping.at.toISOString(), reason, note });
            showTrackerToast({ message: `Skipped ${byId.get(skipping.protocolId)?.name ?? "dose"}`, icon: "play-skip-forward", undo: () => undoSkip(skip.id) });
          }
          setSkipping(null);
        }}
      />
    </View>
  );
}

function CalendarLegend() {
  const th = useTrackerTheme();
  const box = (child: ReactNode) => <View style={styles.legendBox}>{child}</View>;
  return (
    <Legend
      items={[
        { key: "kept", label: "All taken", swatch: box(<DayMark state="kept" size={14} />) },
        { key: "partial", label: "Some", swatch: box(<DayMark state="partial" size={14} />) },
        { key: "missed", label: "Missed", swatch: box(<DayMark state="missed" size={14} />) },
        { key: "planned", label: "Planned", swatch: box(<DayMark state="planned" size={14} />) },
        {
          key: "off",
          label: "Off-cycle",
          swatch: box(<View style={[styles.offSwatch, { backgroundColor: th.surfaceAlt, borderColor: th.line }]} />),
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { gap: TSPACE.lg },
  fill: { flex: 1 },
  monthCard: { paddingHorizontal: TSPACE.sm },
  header: { flexDirection: "row", alignItems: "center", gap: TSPACE.xs, paddingHorizontal: TSPACE.sm },
  today: { alignSelf: "flex-start", marginLeft: TSPACE.sm },
  legendBox: { width: 16, alignItems: "center" },
  offSwatch: { width: 14, height: 14, borderRadius: TRADIUS.xs / 2, borderWidth: StyleSheet.hairlineWidth },
});
