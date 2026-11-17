/**
 * When a protocol's doses fall (spec §5.2 "Schedule details"): daily, chosen
 * weekdays, every N days, or as needed — with an optional on/off cycle, start
 * and end dates, 1–3 times a day. Interval and cycle days count from startDate.
 */
import { addDays, atTime, daysBetween, dayKey, formatDay, formatTime, timeMinutes, weekday, WEEKDAY_SHORT } from "./ids";
import type { Cycle, Protocol, SchedulePeriod, ScheduleRule } from "./types";

export interface Occurrence {
  protocolId: string;
  day: string;
  time: string;
  at: Date;
  /** Stable slot key: `${protocolId}@${at ISO}`. */
  key: string;
}

/** Look-ahead limit when hunting for the next doses (a 30-day interval inside a long cycle still fits). */
const MAX_LOOKAHEAD_DAYS = 400;

export function slotKey(protocolId: string, at: Date): string {
  return `${protocolId}@${at.toISOString()}`;
}

function sortedTimes(times: readonly string[]): string[] {
  return [...times].filter((t) => timeMinutes(t) !== null).sort((a, b) => (timeMinutes(a) ?? 0) - (timeMinutes(b) ?? 0));
}

/** Whether the cycle (if any) is in an "on" day on `day`. */
export function inCycleOn(cycle: Cycle | null, startDate: string, day: string): boolean {
  if (!cycle || cycle.onDays <= 0) return true;
  const period = cycle.onDays + Math.max(0, cycle.offDays);
  if (period <= 0) return true;
  const pos = ((daysBetween(startDate, day) % period) + period) % period;
  return pos < cycle.onDays;
}

function ruleHits(rule: ScheduleRule, startDate: string, day: string): boolean {
  switch (rule.kind) {
    case "daily":
      return true;
    case "weekdays":
      return rule.days.includes(weekday(day));
    case "interval": {
      const every = Math.max(1, Math.round(rule.everyDays));
      return daysBetween(startDate, day) % every === 0;
    }
    case "asNeeded":
      return false;
  }
}

/** The schedule that applies on one day. */
type DayRule = Pick<SchedulePeriod, "schedule" | "cycle" | "times">;

/** Where the current pause began (older data without `pausedFrom`: the day of the last change). */
function pauseStart(p: Protocol): string {
  return p.pausedFrom ?? dayKey(new Date(p.updatedAt));
}

/**
 * The schedule in force on `day`, or null when nothing was due: before the
 * start, after the end, while paused. Days before a pause or an edit keep the
 * rule they had then (`history`), so history never gets rewritten.
 */
export function ruleOn(p: Protocol, day: string): DayRule | null {
  if (p.deletedAt) return null;
  if (daysBetween(p.startDate, day) < 0) return null;
  if (p.endDate && daysBetween(day, p.endDate) < 0) return null;
  const past = (p.history ?? []).find((h) => day < h.until);
  if (past) return past.paused ? null : past;
  if (p.status === "paused" && day >= pauseStart(p)) return null;
  return p;
}

/**
 * Whether `p` has doses scheduled on `day`. A paused protocol has none from
 * the day it was paused; an ended (archived) protocol keeps its past days up
 * to its end date.
 */
export function isOnDay(p: Protocol, day: string): boolean {
  const rule = ruleOn(p, day);
  return !!rule && ruleHits(rule.schedule, p.startDate, day) && inCycleOn(rule.cycle, p.startDate, day);
}

/** Every scheduled dose of `p` from day `from` to day `to`, inclusive, in time order. */
export function occurrences(p: Protocol, from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  const span = daysBetween(from, to);
  for (let i = 0; i <= span; i += 1) {
    const day = addDays(from, i);
    const rule = ruleOn(p, day);
    if (!rule || !ruleHits(rule.schedule, p.startDate, day) || !inCycleOn(rule.cycle, p.startDate, day)) continue;
    for (const time of sortedTimes(rule.times)) {
      const at = atTime(day, time);
      out.push({ protocolId: p.id, day, time, at, key: slotKey(p.id, at) });
    }
  }
  return out;
}

function sameRule(a: DayRule, b: DayRule): boolean {
  const shape = (r: DayRule) => JSON.stringify([r.schedule, r.cycle, sortedTimes(r.times)]);
  return shape(a) === shape(b);
}

/**
 * Carries `prev`'s past into its next version `next`, saved on `today`:
 * pausing records the day it began; resuming, ending or editing the schedule
 * keeps the old rule for the days before; restarting an ended protocol leaves
 * the days in between with nothing due.
 */
export function withScheduleHistory(prev: Protocol, next: Protocol, today: string): Protocol {
  let history: SchedulePeriod[] = [...(prev.history ?? [])];
  const push = (until: string, rule: DayRule, paused: boolean) => {
    const boundary = history[history.length - 1]?.until ?? prev.startDate;
    if (until <= boundary) return;
    history = [...history, { until, schedule: rule.schedule, cycle: rule.cycle, times: [...rule.times], paused }];
  };
  const wasPaused = prev.status === "paused";
  const isPaused = next.status === "paused";
  const ruleChanged = !sameRule(prev, next);
  const pausedSince = wasPaused ? (pauseStart(prev) < today ? pauseStart(prev) : today) : null;

  if (pausedSince && (!isPaused || ruleChanged)) {
    push(pausedSince, prev, false);
    // Resumed: today is due again. Ended while paused: nothing is due through the end day.
    if (!isPaused) push(next.status === "archived" ? addDays(today, 1) : today, prev, true);
  }
  if (prev.status === "archived" && next.status !== "archived" && prev.endDate && !next.endDate) {
    push(addDays(prev.endDate, 1), prev, false);
    push(today, prev, true);
  }
  // While paused the days since the pause stay empty whatever the rule; otherwise the old rule keeps the past.
  if (ruleChanged && !wasPaused) push(today, prev, false);
  const pausedFrom = isPaused ? (pausedSince ?? today) : null;
  return { ...next, history, pausedFrom };
}

/** All protocols' occurrences in the range, in time order. */
export function allOccurrences(protocols: readonly Protocol[], from: string, to: string): Occurrence[] {
  return protocols.flatMap((p) => occurrences(p, from, to)).sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** The next `n` doses of `p` at or after `now`. */
export function nextOccurrences(p: Protocol, now: Date, n: number): Occurrence[] {
  const out: Occurrence[] = [];
  if (n <= 0 || p.schedule.kind === "asNeeded" || p.status !== "active") return out;
  const today = dayKey(now);
  for (let i = 0; i < MAX_LOOKAHEAD_DAYS && out.length < n; i += 1) {
    const day = addDays(today, i);
    if (p.endDate && daysBetween(day, p.endDate) < 0) break;
    for (const o of occurrences(p, day, day)) {
      if (o.at.getTime() >= now.getTime() && out.length < n) out.push(o);
    }
  }
  return out;
}

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const RULE_TEXT = (rule: ScheduleRule): string => {
  switch (rule.kind) {
    case "daily":
      return "Daily";
    case "asNeeded":
      return "As needed";
    case "interval":
      return rule.everyDays === 2 ? "Every other day" : `Every ${rule.everyDays} days`;
    case "weekdays": {
      const days = [...rule.days].sort((a, b) => a - b);
      if (days.length === 7) return "Daily";
      if (days.length === 1) return `Every ${WEEKDAY_LONG[days[0]]}`;
      return days.map((d) => WEEKDAY_SHORT[d]).join(", ") || "No days chosen";
    }
  }
};

export function describeCycle(cycle: Cycle | null): string | null {
  if (!cycle) return null;
  const weeks = cycle.onDays % 7 === 0 && cycle.offDays % 7 === 0 && cycle.onDays >= 14;
  return weeks ? `${cycle.onDays / 7} wk on / ${cycle.offDays / 7} off` : `${cycle.onDays} on / ${cycle.offDays} off`;
}

/** "Every other day · 8:00 AM", "Every Monday · 8:00 PM", "Mon, Thu · 8:00 AM & 9:00 PM · 5 on / 2 off". */
export function describeSchedule(p: Pick<Protocol, "schedule" | "times" | "cycle" | "endDate">): string {
  const parts = [RULE_TEXT(p.schedule)];
  if (p.schedule.kind !== "asNeeded" && p.times.length > 0) parts.push(sortedTimes(p.times).map(formatTime).join(" & "));
  const cycle = describeCycle(p.cycle);
  if (cycle && p.schedule.kind !== "asNeeded") parts.push(cycle);
  if (p.endDate) parts.push(`until ${formatDay(p.endDate)}`);
  return parts.join(" · ");
}

/** Old "biweekly" schedules: the same weekdays, one week on and one off, from the week they were made. */
export function biweeklyCycle(): Cycle {
  return { onDays: 7, offDays: 7 };
}

/** Cycle presets offered in setup. */
export const CYCLE_PRESETS: { key: string; label: string; cycle: Cycle }[] = [
  { key: "5-2", label: "5 on / 2 off", cycle: { onDays: 5, offDays: 2 } },
  { key: "8w-4w", label: "8 wk on / 4 off", cycle: { onDays: 56, offDays: 28 } },
];

/** Helper chips under the weekday row. */
export const WEEKDAY_PRESETS: { key: string; label: string; days: number[] }[] = [
  { key: "2x", label: "2× a week", days: [1, 4] },
  { key: "3x", label: "3× a week", days: [1, 3, 5] },
];
