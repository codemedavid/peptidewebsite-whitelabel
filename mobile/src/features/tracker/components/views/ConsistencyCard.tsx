/**
 * CONSISTENCY: on-schedule rings for 7 and 30 days, the current and best run,
 * a GitHub-style 12-week heatmap (columns = weeks, rows = weekdays) and, for
 * cycled protocols, where in the cycle you are. Rest days and skips never
 * count against you (lib/consistency). No history yet → a greyed sample.
 */
import { StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CyclePosition, DayInfo, DayState } from "../../lib/consistency";
import { formatDay, MONTH_LONG, parseDayKey, WEEKDAY_LETTERS } from "../../lib/ids";
import type { Protocol } from "../../lib/types";
import { Card, Dot, SectionHeader, TText } from "../kit";
import { ProgressBar, ProgressRing } from "../ProgressRing";
import { TSPACE, useTrackerTheme, type TrackerTheme } from "../theme";
import { AxisLabel, Legend, SampleFrame, useChartWidth } from "./chart-kit";
import { heatCounts, type Adherence } from "./progress-model";

const RING = 76;
const RING_STROKE = 8;
const CELL_MAX = 22;
const CELL_GAP = 3;
const DAY_LABEL_W = 14;
/** Weekday rows that get a letter (Mon, Wed, Fri) — all seven is too busy. */
const LABELLED_ROWS = new Set([1, 3, 5]);

export type CycleItem = { protocol: Protocol; pos: CyclePosition };

type Props = {
  adherence: Adherence;
  weeks: DayInfo[][];
  today: string;
  cycles: readonly CycleItem[];
};

export function ConsistencyCard({ adherence: a, weeks, today, cycles }: Props) {
  const counts = heatCounts(weeks, today);
  const hasHistory = counts.kept + counts.partial + counts.missed + counts.logged > 0;

  return (
    <Card>
      <SectionHeader title="Consistency" />
      {hasHistory ? (
        <>
          <Summary a={a} />
          <Heatmap weeks={weeks} today={today} label={heatLabel(weeks, counts)} />
        </>
      ) : (
        <>
          <SampleFrame label="Sample of the consistency rings and heatmap. Not your data.">
            <View style={styles.gap}>
              <Summary a={SAMPLE_ADHERENCE} />
              <Heatmap weeks={sampleWeeks(weeks)} today={today} label="" />
            </View>
          </SampleFrame>
          <TText variant="body" color="soft">
            Log a few doses and your on-schedule rate, runs and a 12-week map show up here.
          </TText>
        </>
      )}
      <HeatLegend />
      {cycles.length > 0 ? <Cycles items={cycles} /> : null}
      <TText variant="meta" color="faint">
        Rest days and skips never count against you.
      </TText>
    </Card>
  );
}

function Summary({ a }: { a: Adherence }) {
  const th = useTrackerTheme();
  return (
    <View style={styles.summary}>
      <Ring pct={a.pct7} label="7 days" />
      <Ring pct={a.pct30} label="30 days" />
      <View style={styles.runs}>
        <View style={styles.runRow} accessible accessibilityLabel={`Current run: ${a.run} doses in a row on schedule`}>
          <View style={[styles.runIcon, { backgroundColor: th.status.low.soft }]}>
            <Ionicons name="flame" size={14} color={th.status.low.text} />
          </View>
          <View>
            <TText variant="number">{String(a.run)}</TText>
            <TText variant="meta" color="soft" style={styles.small}>
              in a row
            </TText>
          </View>
        </View>
        <View style={styles.runRow} accessible accessibilityLabel={`Best run: ${a.best} doses in a row`}>
          <View style={[styles.runIcon, { backgroundColor: th.brandSoft }]}>
            <Ionicons name="trophy-outline" size={14} color={th.brandText} />
          </View>
          <View>
            <TText variant="number">{String(a.best)}</TText>
            <TText variant="meta" color="soft" style={styles.small}>
              best run
            </TText>
          </View>
        </View>
      </View>
    </View>
  );
}

function Ring({ pct, label }: { pct: number | null; label: string }) {
  const th = useTrackerTheme();
  const spoken = pct === null ? `${label}: not enough doses yet` : `${label}: ${pct}% on schedule`;
  return (
    <View style={styles.ringWrap}>
      <ProgressRing size={RING} stroke={RING_STROKE} progress={(pct ?? 0) / 100} color={th.status.done.solid} track={th.surfaceAlt} label={spoken}>
        <TText variant="number" tabular>
          {pct === null ? "—" : `${pct}%`}
        </TText>
      </ProgressRing>
      <TText variant="meta" color="soft" style={styles.small}>
        {label}
      </TText>
    </View>
  );
}

function cellLook(state: DayState, isFuture: boolean, th: TrackerTheme): { bg: string; border: string } {
  if (isFuture) return { bg: "transparent", border: "transparent" };
  switch (state) {
    case "kept":
    case "logged":
      return { bg: th.status.done.solid, border: th.status.done.solid };
    case "partial":
      return { bg: th.status.done.soft, border: th.status.done.solid };
    case "missed":
      return { bg: th.status.missed.soft, border: th.status.missed.solid };
    case "planned":
      return { bg: "transparent", border: th.line };
    case "rest":
      return { bg: th.surfaceAlt, border: th.surfaceAlt };
  }
}

function Heatmap({ weeks, today, label }: { weeks: DayInfo[][]; today: string; label: string }) {
  const th = useTrackerTheme();
  const [width, onLayout] = useChartWidth();
  const cols = weeks.length || 1;
  const cell = Math.min(CELL_MAX, Math.floor((width - DAY_LABEL_W - 2 - CELL_GAP * cols) / cols));
  // A month name over the first week that starts in it.
  const monthAt = weeks.map((w, i) => {
    const m = parseDayKey(w[0].day).getMonth();
    const prev = i > 0 ? parseDayKey(weeks[i - 1][0].day).getMonth() : -1;
    return m !== prev ? MONTH_LONG[m].slice(0, 3) : null;
  });
  return (
    <View onLayout={onLayout} accessible={!!label} accessibilityRole="image" accessibilityLabel={label || undefined}>
      {width > 0 && cell > 0 ? (
        <View style={styles.heat}>
          <View style={[styles.dayCol, { width: DAY_LABEL_W, paddingTop: 16 }]}>
            {WEEKDAY_LETTERS.map((l, r) => (
              <View key={r} style={{ height: cell, marginBottom: CELL_GAP, justifyContent: "center" }}>
                {LABELLED_ROWS.has(r) ? <AxisLabel style={styles.dayLetter}>{l}</AxisLabel> : null}
              </View>
            ))}
          </View>
          {weeks.map((w, i) => (
            <View key={w[0].day} style={{ width: cell, marginRight: CELL_GAP }}>
              <View style={styles.monthSlot}>{monthAt[i] ? <AxisLabel style={styles.month}>{monthAt[i]}</AxisLabel> : null}</View>
              {w.map((d) => {
                const look = cellLook(d.state, d.day > today, th);
                const isToday = d.day === today;
                return (
                  <View
                    key={d.day}
                    style={{
                      width: cell,
                      height: cell,
                      marginBottom: CELL_GAP,
                      borderRadius: Math.max(3, cell / 5),
                      backgroundColor: look.bg,
                      borderWidth: isToday ? 2 : 1,
                      borderColor: isToday ? th.brand : look.border,
                    }}
                  />
                );
              })}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function HeatLegend() {
  const th = useTrackerTheme();
  const sw = (bg: string, border: string) => <View style={[styles.swatch, { backgroundColor: bg, borderColor: border }]} />;
  return (
    <Legend
      items={[
        { key: "kept", label: "All taken", swatch: sw(th.status.done.solid, th.status.done.solid) },
        { key: "partial", label: "Some", swatch: sw(th.status.done.soft, th.status.done.solid) },
        { key: "missed", label: "Missed", swatch: sw(th.status.missed.soft, th.status.missed.solid) },
        { key: "rest", label: "Rest", swatch: sw(th.surfaceAlt, th.surfaceAlt) },
      ]}
    />
  );
}

function Cycles({ items }: { items: readonly CycleItem[] }) {
  const th = useTrackerTheme();
  return (
    <View style={[styles.cycles, { borderTopColor: th.line }]}>
      <TText variant="micro" color="faint" accessibilityRole="header">
        Cycles
      </TText>
      {items.map(({ protocol, pos }) => (
        <View key={protocol.id} style={styles.cycle} accessible accessibilityLabel={`${protocol.name}: ${pos.phase === "on" ? "on cycle" : "off cycle"}, ${pos.label}`}>
          <View style={styles.cycleHead}>
            <Dot color={protocol.color} />
            <TText variant="bodyStrong" numberOfLines={1} style={styles.fill}>
              {protocol.name}
            </TText>
            <TText variant="meta" color={pos.phase === "on" ? th.status.done.text : th.inkSoft}>
              {pos.phase === "on" ? "On" : "Off"}
            </TText>
          </View>
          <ProgressBar progress={pos.progress} color={pos.phase === "on" ? th.status.done.solid : th.inkFaint} height={8} />
          <TText variant="meta" color="soft" tabular>
            {pos.label}
          </TText>
        </View>
      ))}
    </View>
  );
}

function heatLabel(weeks: DayInfo[][], c: Record<DayState, number>): string {
  const first = weeks[0]?.[0]?.day;
  return `Last ${weeks.length} weeks${first ? ` since ${formatDay(first)}` : ""}: ${c.kept + c.logged} days all taken, ${c.partial} partly taken, ${c.missed} missed, ${c.rest} rest days.`;
}

const SAMPLE_ADHERENCE: Adherence = { pct7: 86, pct30: 92, run: 12, best: 30, taken30: 0, missed30: 0, skipped30: 0 };
const SAMPLE_PATTERN: DayState[] = ["kept", "kept", "rest", "kept", "partial", "kept", "rest", "kept", "missed", "kept", "kept", "rest", "kept"];

/** Same dates as the real map, made-up states (past days only). */
function sampleWeeks(weeks: DayInfo[][]): DayInfo[][] {
  return weeks.map((w, wi) => w.map((d, di) => ({ ...d, state: SAMPLE_PATTERN[(wi * 7 + di) % SAMPLE_PATTERN.length] })));
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gap: { gap: TSPACE.md },
  small: { fontSize: 12, lineHeight: 16 },
  summary: { flexDirection: "row", alignItems: "center", gap: TSPACE.md, flexWrap: "wrap" },
  ringWrap: { alignItems: "center", gap: TSPACE.xs },
  runs: { flex: 1, minWidth: 96, gap: TSPACE.sm },
  runRow: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm },
  runIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  heat: { flexDirection: "row" },
  dayCol: { marginRight: 2 },
  dayLetter: { fontSize: 10, lineHeight: 12 },
  monthSlot: { height: 16, overflow: "visible" },
  month: { fontSize: 10, lineHeight: 12, width: 40 },
  swatch: { width: 12, height: 12, borderRadius: 3, borderWidth: 1 },
  cycles: { gap: TSPACE.md, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: TSPACE.md },
  cycle: { gap: 6 },
  cycleHead: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm },
});
