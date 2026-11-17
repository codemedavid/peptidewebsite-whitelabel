/**
 * The one consistency formula (spec §7.3) used by Today, Calendar, Progress
 * and the profile, so their numbers always agree.
 *
 * - On-schedule % = taken (on time or late) ÷ (taken + missed). Skips are
 *   neutral; doses still inside their window are not counted yet.
 * - The run = due doses in a row that weren't missed, newest first.
 * - Rest days, paused protocols and cycle off-days have no due doses.
 */
import { addDays, daysBetween, dayKey, formatDay, weekStart } from "./ids";
import { inCycleOn } from "./schedule";
import { matchSlots, type Slot } from "./today";
import { isLive, type DoseLog, type Protocol, type SkipLog, type Vial } from "./types";

export type DayState = "kept" | "partial" | "missed" | "planned" | "rest" | "logged";

export interface DayInfo {
  day: string;
  state: DayState;
  slots: Slot[];
  extras: DoseLog[];
}

/** History window for runs and milestones (keeps the maths cheap on every tick). */
export const RUN_LOOKBACK_DAYS = 180;
const PCT_DAYS = 30;
/** Fewer resolved doses than this and the % isn't shown yet. */
export const MIN_FOR_PCT = 3;

function stateOf(slots: Slot[], extras: DoseLog[]): DayState {
  if (slots.length === 0) return extras.length > 0 ? "logged" : "rest";
  const due = slots.filter((s) => s.state !== "skipped");
  if (due.length === 0) return "rest";
  const taken = due.filter((s) => s.state === "taken").length;
  if (taken === due.length) return "kept";
  if (taken > 0) return "partial";
  if (due.some((s) => s.state === "missed")) return "missed";
  return "planned";
}

/** Keeps only one protocol's records (Calendar's filter); null keeps everything. */
export function filterTo(protocolId: string | null, protocols: readonly Protocol[], doses: readonly DoseLog[], skips: readonly SkipLog[]) {
  if (!protocolId) return { protocols, doses, skips };
  return {
    protocols: protocols.filter((p) => p.id === protocolId),
    doses: doses.filter((d) => d.protocolId === protocolId),
    skips: skips.filter((s) => s.protocolId === protocolId),
  };
}

/** Each day from `from` to `to` with its state, slots and unscheduled logs. */
export function dayStates(
  protocols: readonly Protocol[],
  doses: readonly DoseLog[],
  skips: readonly SkipLog[],
  from: string,
  to: string,
  now: Date,
): DayInfo[] {
  const { slots, extras } = matchSlots(protocols, doses, skips, from, to, now);
  const out: DayInfo[] = [];
  const span = daysBetween(from, to);
  for (let i = 0; i <= span; i += 1) {
    const day = addDays(from, i);
    const daySlots = slots.filter((s) => s.day === day);
    const dayExtras = extras.filter((d) => dayKey(new Date(d.takenAt)) === day);
    out.push({ day, state: stateOf(daySlots, dayExtras), slots: daySlots, extras: dayExtras });
  }
  return out;
}

export interface Consistency {
  /** Null until there are a few resolved doses. */
  pct: number | null;
  run: number;
  taken30: number;
  missed30: number;
  skipped30: number;
}

export function onSchedule(slots: readonly Slot[], now: Date, days = PCT_DAYS): Pick<Consistency, "pct" | "taken30" | "missed30" | "skipped30"> {
  const since = now.getTime() - days * 86_400_000;
  const recent = slots.filter((s) => s.at.getTime() >= since);
  const taken = recent.filter((s) => s.state === "taken").length;
  const missed = recent.filter((s) => s.state === "missed").length;
  const skipped = recent.filter((s) => s.state === "skipped").length;
  const resolved = taken + missed;
  return { pct: resolved >= MIN_FOR_PCT ? Math.round((taken / resolved) * 100) : null, taken30: taken, missed30: missed, skipped30: skipped };
}

/** Due doses in a row, newest first, that weren't missed (skips and still-open doses don't count either way). */
export function currentRun(slots: readonly Slot[]): number {
  const resolved = slots.filter((s) => s.state === "taken" || s.state === "missed").sort((a, b) => b.at.getTime() - a.at.getTime());
  let run = 0;
  for (const s of resolved) {
    if (s.state === "missed") break;
    run += 1;
  }
  return run;
}

export function consistency(protocols: readonly Protocol[], doses: readonly DoseLog[], skips: readonly SkipLog[], now: Date): Consistency {
  const today = dayKey(now);
  const { slots } = matchSlots(protocols, doses, skips, addDays(today, -RUN_LOOKBACK_DAYS), addDays(today, 1), now);
  return { ...onSchedule(slots, now), run: currentRun(slots) };
}

/** Sunday–Saturday of this week. */
export function weekStrip(protocols: readonly Protocol[], doses: readonly DoseLog[], skips: readonly SkipLog[], now: Date): DayInfo[] {
  const start = weekStart(dayKey(now));
  return dayStates(protocols, doses, skips, start, addDays(start, 6), now);
}

/** `weeks` rows of seven days (oldest first), ending with this week. */
export function heatmap(protocols: readonly Protocol[], doses: readonly DoseLog[], skips: readonly SkipLog[], now: Date, weeks = 12): DayInfo[][] {
  const end = addDays(weekStart(dayKey(now)), 6);
  const start = addDays(end, -(weeks * 7 - 1));
  const days = dayStates(protocols, doses, skips, start, end, now);
  return Array.from({ length: weeks }, (_, w) => days.slice(w * 7, w * 7 + 7));
}

export interface CyclePosition {
  phase: "on" | "off";
  label: string;
  /** 0–1 through the current phase. */
  progress: number;
}

/** "Week 5 of 8 · off from Nov 9" / "Day 3 of 5 · off from Oct 16" / "Off · back on Nov 9". */
export function cyclePosition(p: Protocol, now: Date): CyclePosition | null {
  if (!p.cycle || p.cycle.onDays <= 0) return null;
  const today = dayKey(now);
  const elapsed = daysBetween(p.startDate, today);
  if (elapsed < 0) return null;
  const { onDays, offDays } = p.cycle;
  const period = onDays + offDays;
  const pos = elapsed % period;
  const cycleStart = addDays(today, -pos);
  const inWeeks = onDays % 7 === 0 && offDays % 7 === 0 && onDays >= 14;
  if (inCycleOn(p.cycle, p.startDate, today)) {
    const label = inWeeks ? `Week ${Math.floor(pos / 7) + 1} of ${onDays / 7}` : `Day ${pos + 1} of ${onDays}`;
    const tail = offDays > 0 ? ` · off from ${formatDay(addDays(cycleStart, onDays))}` : "";
    return { phase: "on", label: `${label}${tail}`, progress: (pos + 1) / onDays };
  }
  return { phase: "off", label: `Off · back on ${formatDay(addDays(cycleStart, period))}`, progress: (pos - onDays + 1) / Math.max(1, offDays) };
}

// ── Milestones (rare on purpose, spec §5.6) ──────────────────────────────

export interface Milestone {
  key: string;
  title: string;
  day: string;
}

const DOSE_COUNTS = [25, 50, 100, 250];
const RUN_COUNTS = [10, 30, 60, 100];

function firstFullWeek(slots: readonly Slot[], now: Date): string | null {
  const thisWeek = weekStart(dayKey(now));
  const byWeek = new Map<string, Slot[]>();
  for (const s of slots) {
    const w = weekStart(s.day);
    if (w !== thisWeek) byWeek.set(w, [...(byWeek.get(w) ?? []), s]);
  }
  const weeks = [...byWeek.keys()].sort();
  for (const w of weeks) {
    const due = (byWeek.get(w) ?? []).filter((s) => s.state !== "skipped");
    if (due.length > 0 && due.every((s) => s.state === "taken")) return addDays(w, 6);
  }
  return null;
}

export function milestones(
  protocols: readonly Protocol[],
  doses: readonly DoseLog[],
  skips: readonly SkipLog[],
  vials: readonly Vial[],
  now: Date,
): Milestone[] {
  const out: Milestone[] = [];
  const taken = doses.filter(isLive).sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const dayOf = (d: DoseLog) => dayKey(new Date(d.takenAt));
  if (taken[0]) out.push({ key: "first-dose", title: "First dose logged", day: dayOf(taken[0]) });

  const today = dayKey(now);
  const { slots } = matchSlots(protocols, doses, skips, addDays(today, -RUN_LOOKBACK_DAYS), today, now);
  const week = firstFullWeek(slots, now);
  if (week) out.push({ key: "full-week", title: "First full week on schedule", day: week });

  for (const n of DOSE_COUNTS) {
    if (taken.length >= n) out.push({ key: `doses-${n}`, title: `${n} doses logged`, day: dayOf(taken[n - 1]) });
  }

  const chronological = slots.filter((s) => s.state === "taken" || s.state === "missed").sort((a, b) => a.at.getTime() - b.at.getTime());
  let run = 0;
  const runDays = new Map<number, string>();
  for (const s of chronological) {
    run = s.state === "taken" ? run + 1 : 0;
    if (RUN_COUNTS.includes(run) && !runDays.has(run)) runDays.set(run, s.dose ? dayOf(s.dose) : s.day);
  }
  for (const n of RUN_COUNTS) {
    const day = runDays.get(n);
    if (day) out.push({ key: `run-${n}`, title: `${n} doses in a row on schedule`, day });
  }

  const finished = vials.filter((v) => isLive(v) && v.status === "finished").sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  if (finished[0]) out.push({ key: "first-vial", title: "First vial finished", day: dayKey(new Date(finished[0].updatedAt)) });

  const cycleDays = protocols
    .filter((p) => isLive(p) && p.cycle && p.cycle.onDays > 0)
    .map((p) => addDays(p.startDate, (p.cycle?.onDays ?? 0) + (p.cycle?.offDays ?? 0)))
    .filter((d) => daysBetween(d, today) >= 0)
    .sort();
  if (cycleDays[0]) out.push({ key: "cycle", title: "A full cycle completed", day: cycleDays[0] });

  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
