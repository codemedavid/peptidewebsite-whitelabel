/**
 * Pure numbers behind the Progress cards. Built on lib/consistency (the one
 * on-schedule formula Today and the Calendar also use) so every screen agrees.
 */
import { currentRun, onSchedule, RUN_LOOKBACK_DAYS, type DayInfo, type DayState } from "../../lib/consistency";
import { addDays, dayKey } from "../../lib/ids";
import { matchSlots, type Slot } from "../../lib/today";
import type { CheckIn, DoseLog, Protocol, Scale, SkipLog, WeightUnit } from "../../lib/types";
import { toUnit } from "../../lib/weight";
import { NO_EFFECTS } from "../checkin-model";

/** The real side effects of a check-in (the check-in screen's "None" is not one). */
export function realEffects(c: Pick<CheckIn, "effects">): string[] {
  return c.effects.filter((e) => e !== NO_EFFECTS);
}

/**
 * Whether a check-in answered the side-effects question: some, or an explicit
 * "None" (checkin-model: `effects: []` = not answered — e.g. a weight-only entry).
 */
export function reportsEffects(c: Pick<CheckIn, "effects">): boolean {
  return c.effects.length > 0;
}

export interface Adherence {
  /** Null until a few doses in the window are resolved. */
  pct7: number | null;
  pct30: number | null;
  run: number;
  best: number;
  taken30: number;
  missed30: number;
  skipped30: number;
}

/** Longest run of due doses taken in a row (skips and open doses don't break it). */
export function bestRun(slots: readonly Slot[]): number {
  const resolved = slots.filter((s) => s.state === "taken" || s.state === "missed").sort((a, b) => a.at.getTime() - b.at.getTime());
  let best = 0;
  let run = 0;
  for (const s of resolved) {
    run = s.state === "taken" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

export function adherence(protocols: readonly Protocol[], doses: readonly DoseLog[], skips: readonly SkipLog[], now: Date): Adherence {
  const today = dayKey(now);
  const { slots } = matchSlots(protocols, doses, skips, addDays(today, -RUN_LOOKBACK_DAYS), addDays(today, 1), now);
  const w7 = onSchedule(slots, now, 7);
  const w30 = onSchedule(slots, now, 30);
  return { pct7: w7.pct, pct30: w30.pct, run: currentRun(slots), best: bestRun(slots), taken30: w30.taken30, missed30: w30.missed30, skipped30: w30.skipped30 };
}

/** How many past days (today included) fell in each state. */
export function heatCounts(weeks: readonly DayInfo[][], today: string): Record<DayState, number> {
  const out: Record<DayState, number> = { kept: 0, partial: 0, missed: 0, planned: 0, rest: 0, logged: 0 };
  for (const w of weeks) for (const d of w) if (d.day <= today) out[d.state] += 1;
  return out;
}

export type MetricKey = "energy" | "mood" | "appetite" | "sleep";

export const METRICS: readonly { key: MetricKey; label: string; icon: "flash-outline" | "happy-outline" | "restaurant-outline" | "moon-outline" }[] = [
  { key: "energy", label: "Energy", icon: "flash-outline" },
  { key: "mood", label: "Mood", icon: "happy-outline" },
  { key: "appetite", label: "Appetite", icon: "restaurant-outline" },
  { key: "sleep", label: "Sleep", icon: "moon-outline" },
];

export interface MetricTrend {
  key: MetricKey;
  label: string;
  /** One value per day of the window, oldest first (null = no rating). */
  values: (Scale | null)[];
  avg: number | null;
  count: number;
  /** Last 7 days' average minus the 7 before (null without both). */
  delta: number | null;
}

export interface EffectCount {
  name: string;
  days: number;
}

export interface CheckInTrendData {
  days: number;
  metrics: MetricTrend[];
  effects: EffectCount[];
  /** Check-ins that rated the day with no side effects. */
  noneDays: number;
  /** Check-ins in the window that said anything about how the day went. */
  reported: number;
}

const avgOf = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const WEEK = 7;

export function checkInTrends(checkins: readonly CheckIn[], now: Date, days = 30): CheckInTrendData {
  const today = dayKey(now);
  const first = addDays(today, -(days - 1));
  const byDay = new Map(checkins.filter((c) => c.date >= first && c.date <= today).map((c) => [c.date, c] as const));
  const window = Array.from({ length: days }, (_, i) => addDays(first, i));
  const metrics = METRICS.map((m) => {
    const values = window.map((d) => byDay.get(d)?.[m.key] ?? null);
    const rated = values.filter((v): v is Scale => v !== null);
    const last = values.slice(-WEEK).filter((v): v is Scale => v !== null);
    const prev = values.slice(-2 * WEEK, -WEEK).filter((v): v is Scale => v !== null);
    const a = avgOf(last);
    const b = avgOf(prev);
    return { key: m.key, label: m.label, values, avg: avgOf(rated), count: rated.length, delta: a !== null && b !== null ? a - b : null };
  });
  const counts = new Map<string, number>();
  let noneDays = 0;
  let reported = 0;
  for (const c of byDay.values()) {
    if (!reportsEffects(c)) continue;
    reported += 1;
    const effects = realEffects(c);
    if (effects.length === 0) noneDays += 1;
    for (const e of new Set(effects)) counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  const effects = [...counts.entries()].map(([name, n]) => ({ name, days: n })).sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
  return { days, metrics, effects, noneDays, reported };
}

export interface WeightPoint {
  day: string;
  value: number;
}

/** Weigh-ins from `since` (null = all), oldest first, in the user's unit. */
export function weightSeries(checkins: readonly CheckIn[], unit: WeightUnit, since: string | null): WeightPoint[] {
  return checkins
    .filter((c): c is CheckIn & { weightKg: number } => c.weightKg !== null && Number.isFinite(c.weightKg) && (since === null || c.date >= since))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((c) => ({ day: c.date, value: toUnit(c.weightKg, unit) }));
}
