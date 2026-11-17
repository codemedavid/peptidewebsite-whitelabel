/**
 * Pure geometry and wording for the estimated-level chart (LevelChart.tsx).
 *
 * lib/level.ts samples the curve every `stepHours`. Sampling alone misses
 * the peaks (a dose lands between two samples), so `exactSeries` adds the
 * exact jump at every logged dose and fills each decay with a few extra
 * points. Between two points of that series no dose happens, so the level at
 * any moment is the earlier point decayed by the half-life — exact, not
 * interpolated (`levelAt`).
 */
import { convertDose, type LevelPoint } from "../../lib/level";
import { dayKey, formatDay, parseDayKey, WEEKDAY_SHORT } from "../../lib/ids";
import type { CheckIn, DoseLog, DoseUnit } from "../../lib/types";
import { realEffects } from "./progress-model";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Settle the window to this, so the curve isn't rebuilt on every clock tick. */
const WINDOW_ROUND_MS = 10 * 60_000;
/** Projected tail after "now", as a share of the range (min 12 h). */
const FUTURE_SHARE = 0.12;
const MIN_FUTURE_HOURS = 12;
/** Aim for about this many samples; never more than MAX_SAMPLES. */
const TARGET_SAMPLES = 220;
const MAX_SAMPLES = 1200;
/** Extra decay points inside a gap: one per half a half-life, capped. */
const MAX_FILL_PER_GAP = 8;
/** Check-ins carry a day, not a time: pin them at midday. */
const CHECKIN_HOUR = 12;

export type LevelRangeKey = "7d" | "14d" | "30d" | "90d";

export const LEVEL_RANGES: readonly { key: LevelRangeKey; label: string; days: number; tickDays: number }[] = [
  { key: "7d", label: "7D", days: 7, tickDays: 1 },
  { key: "14d", label: "14D", days: 14, tickDays: 3 },
  { key: "30d", label: "30D", days: 30, tickDays: 7 },
  { key: "90d", label: "90D", days: 90, tickDays: 21 },
];

export interface LevelWindow {
  from: Date;
  to: Date;
  /** The settled "now" the window was built around (epoch ms). */
  nowMs: number;
  stepHours: number;
}

/** The chart window: `days` back from now, plus a short projected tail. */
export function levelWindow(now: Date, days: number, halfLifeHours: number | null): LevelWindow {
  const nowMs = Math.floor(now.getTime() / WINDOW_ROUND_MS) * WINDOW_ROUND_MS;
  const tailHours = Math.max(MIN_FUTURE_HOURS, days * 24 * FUTURE_SHARE);
  const fromMs = nowMs - days * DAY_MS;
  const toMs = nowMs + tailHours * HOUR_MS;
  const rangeHours = (toMs - fromMs) / HOUR_MS;
  const byHalfLife = halfLifeHours && halfLifeHours > 0 ? halfLifeHours / 3 : rangeHours / TARGET_SAMPLES;
  const stepHours = Math.max(rangeHours / MAX_SAMPLES, Math.min(byHalfLife, rangeHours / TARGET_SAMPLES));
  return { from: new Date(fromMs), to: new Date(toMs), nowMs, stepHours };
}

const decay = (ms: number, halfLifeMs: number) => 0.5 ** (ms / halfLifeMs);

type DoseEvent = { at: number; amount: number };

function eventsOf(doses: readonly DoseLog[], unit: DoseUnit, fromMs: number, toMs: number): DoseEvent[] {
  const out: DoseEvent[] = [];
  for (const d of doses) {
    const at = Date.parse(d.takenAt);
    if (!Number.isFinite(at) || at <= fromMs || at > toMs) continue;
    const amount = convertDose(d.dose.value, d.dose.unit, unit);
    if (amount !== null && amount > 0) out.push({ at, amount });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Index of the last point with t < at (or -1). Points are sorted by t. */
function lastBefore(points: readonly LevelPoint[], at: number): number {
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < at) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * The sampled curve plus an exact before/after pair at every dose in range
 * and extra decay points in long gaps. Sorted by time; a jump is two points
 * with the same `t` (before, then after).
 */
export function exactSeries(points: readonly LevelPoint[], doses: readonly DoseLog[], halfLifeHours: number, unit: DoseUnit): LevelPoint[] {
  if (points.length < 2 || !(halfLifeHours > 0)) return [...points];
  const hl = halfLifeHours * HOUR_MS;
  const first = points[0].t;
  const last = points[points.length - 1].t;
  const events = eventsOf(doses, unit, first, last);

  const jumps: LevelPoint[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (i > 0 && events[i - 1].at === e.at) continue;
    const p = points[lastBefore(points, e.at)];
    if (!p) continue;
    let before = p.level * decay(e.at - p.t, hl);
    let after = 0;
    for (const o of events) {
      if (o.at > p.t && o.at < e.at) before += o.amount * decay(e.at - o.at, hl);
      if (o.at === e.at) after += o.amount;
    }
    jumps.push({ t: e.at, level: before }, { t: e.at, level: before + after });
  }

  const merged: LevelPoint[] = [];
  let j = 0;
  for (const p of points) {
    while (j < jumps.length && jumps[j].t <= p.t) merged.push(jumps[j++]);
    merged.push(p);
  }
  while (j < jumps.length) merged.push(jumps[j++]);

  const filled: LevelPoint[] = [];
  for (let i = 0; i < merged.length; i += 1) {
    const a = merged[i];
    filled.push(a);
    const b = merged[i + 1];
    if (!b) break;
    const gap = b.t - a.t;
    const stride = hl / 2;
    if (gap <= stride) continue;
    const n = Math.min(MAX_FILL_PER_GAP, Math.floor(gap / stride));
    const step = gap / (n + 1);
    for (let k = 1; k <= n; k += 1) filled.push({ t: a.t + k * step, level: a.level * decay(k * step, hl) });
  }
  return filled;
}

/** The exact level at `t` from an exactSeries (null outside it). */
export function levelAt(series: readonly LevelPoint[], t: number, halfLifeHours: number): number | null {
  if (series.length === 0 || t < series[0].t || t > series[series.length - 1].t) return null;
  let lo = 0;
  let hi = series.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const p = series[found];
  return p.level * decay(t - p.t, halfLifeHours * HOUR_MS);
}

/** 1, 2, 2.5 or 5 × 10ⁿ at or above `v` (the y-axis top). */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export interface Tick {
  t: number;
  label: string;
}

/** Local-midnight ticks every `tickDays`, counted back from today so today's tick is always there. */
export function dayTicks(from: Date, to: Date, nowMs: number, tickDays: number): Tick[] {
  const today = parseDayKey(dayKey(new Date(nowMs)));
  const out: Tick[] = [];
  for (let k = 0; ; k += 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - k * tickDays);
    if (d.getTime() < from.getTime()) break;
    if (d.getTime() <= to.getTime()) out.push({ t: d.getTime(), label: tickDays === 1 ? WEEKDAY_SHORT[d.getDay()] : formatDay(dayKey(d)) });
  }
  return out.reverse();
}

export interface Pin {
  checkin: CheckIn;
  t: number;
  /** Has side effects (a labelled pin) vs "none today" (a quiet dot). */
  hasEffects: boolean;
  /** "Nausea +1" — null when it would collide with the previous label. */
  label: string | null;
}

/** "Nausea", "Nausea +2". */
export function effectsLabel(effects: readonly string[]): string {
  if (effects.length === 0) return "None";
  return effects.length === 1 ? effects[0] : `${effects[0]} +${effects.length - 1}`;
}

/** Check-ins in the window as pins (midday of their day, never after now); labels thinned so they don't overlap. */
export function pinsFor(checkins: readonly CheckIn[], from: Date, nowMs: number, xOf: (t: number) => number, minLabelGap: number): Pin[] {
  let lastLabelX = -Infinity;
  const out: Pin[] = [];
  for (const c of checkins) {
    const day = parseDayKey(c.date);
    const t = Math.min(nowMs, new Date(day.getFullYear(), day.getMonth(), day.getDate(), CHECKIN_HOUR).getTime());
    if (!Number.isFinite(t) || t < from.getTime()) continue;
    const effects = realEffects(c);
    const hasEffects = effects.length > 0;
    let label: string | null = null;
    if (hasEffects && xOf(t) - lastLabelX >= minLabelGap) {
      label = effectsLabel(effects);
      lastLabelX = xOf(t);
    }
    out.push({ checkin: c, t, hasEffects, label });
  }
  return out;
}

/** "120 mcg", "1.5 mg" (estimated amounts read better rounded). */
export function amountText(value: number, unit: string): string {
  const v = Math.abs(value) < 1e-9 ? 0 : value;
  const abs = Math.abs(v);
  const n = abs >= 100 ? Math.round(v).toLocaleString("en-US") : abs >= 10 ? v.toFixed(0) : abs === 0 ? "0" : v.toFixed(1).replace(/\.0$/, "");
  return `${n} ${unit}`;
}

/** The chart's spoken summary (what a sighted user reads off it). */
export function levelSummary(p: {
  name: string;
  days: number;
  unit: string;
  doseCount: number;
  nowLevel: number | null;
  peak: LevelPoint | null;
  checkins: readonly CheckIn[];
}): string {
  const parts = [`Estimated ${p.name} level over the last ${p.days} days.`];
  parts.push(p.doseCount === 0 ? "No doses logged in this range." : `${p.doseCount} dose${p.doseCount === 1 ? "" : "s"} logged.`);
  if (p.nowLevel !== null) parts.push(`Now about ${amountText(p.nowLevel, p.unit)}.`);
  if (p.peak && p.peak.level > 0) parts.push(`Highest about ${amountText(p.peak.level, p.unit)} on ${formatDay(dayKey(new Date(p.peak.t)))}.`);
  const effects = p.checkins.filter((c) => realEffects(c).length > 0);
  if (effects.length > 0) {
    const list = effects.slice(-5).map((c) => `${formatDay(c.date)}: ${realEffects(c).join(", ")}`);
    parts.push(`Side effects on ${effects.length} day${effects.length === 1 ? "" : "s"}. ${list.join("; ")}.`);
  }
  const none = p.checkins.length - effects.length;
  if (none > 0) parts.push(`${none} check-in${none === 1 ? "" : "s"} with no side effects.`);
  return parts.join(" ");
}
