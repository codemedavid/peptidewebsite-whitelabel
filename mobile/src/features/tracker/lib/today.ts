/**
 * Matching logs to scheduled doses (spec §7.3) and the Today screen's plan
 * (spec §5.1). A dose matches the nearest unmatched scheduled time of its
 * protocol whose window holds the time taken; the window opens 12 h before
 * (or halfway back to the previous dose) and closes at the next dose (or the
 * end of the next day). A slot whose window passed with no dose is missed.
 */
import { addDays, atTime, dayKey, parseDayKey } from "./ids";
import { nextOccurrences, occurrences, type Occurrence } from "./schedule";
import { isLive, type DoseLog, type Protocol, type SkipLog } from "./types";

const HOUR_MS = 3_600_000;
const LOOKBACK_MS = 12 * HOUR_MS;
const ON_TIME_MS = 3 * HOUR_MS;
/** A dose counts as "due" from this long before its time. */
export const DUE_EARLY_MS = 30 * 60_000;

export type SlotState = "taken" | "skipped" | "missed" | "open";
export type Timing = "onTime" | "late" | "early";

export interface Slot extends Occurrence {
  state: SlotState;
  dose: DoseLog | null;
  skip: SkipLog | null;
  timing: Timing | null;
  windowStart: Date;
  windowEnd: Date;
}

export interface MatchResult {
  slots: Slot[];
  /** Logs in the range that match no scheduled dose (one-offs, as-needed, extras). */
  extras: DoseLog[];
}

type Windowed = Occurrence & { windowStart: Date; windowEnd: Date };

function endOfNextDay(at: Date): Date {
  return parseDayKey(addDays(dayKey(at), 2));
}

function withWindows(occ: Occurrence[]): Windowed[] {
  return occ.map((o, i) => {
    const prev = occ[i - 1];
    const next = occ[i + 1];
    const back = o.at.getTime() - LOOKBACK_MS;
    const mid = prev ? (prev.at.getTime() + o.at.getTime()) / 2 : -Infinity;
    const nextEnd = endOfNextDay(o.at).getTime();
    return {
      ...o,
      windowStart: new Date(Math.max(back, mid)),
      windowEnd: new Date(next ? Math.min(next.at.getTime(), nextEnd) : nextEnd),
    };
  });
}

function timingOf(takenAt: Date, at: Date): Timing {
  const diff = takenAt.getTime() - at.getTime();
  if (Math.abs(diff) <= ON_TIME_MS) return "onTime";
  return diff > 0 ? "late" : "early";
}

/** Pairs each record (dose or skip) with one slot: exact scheduledFor first, then the nearest open window. */
function pair<T extends { protocolId: string | null; scheduledFor: string | null }>(
  records: T[],
  slotsByProtocol: Map<string, Windowed[]>,
  taken: Set<string>,
  timeOf: (r: T) => number,
): Map<string, T> {
  const out = new Map<string, T>();
  const rest: T[] = [];
  for (const r of records) {
    const own = slotsByProtocol.get(r.protocolId ?? "") ?? [];
    const planned = r.scheduledFor ? Date.parse(r.scheduledFor) : NaN;
    const exact = Number.isFinite(planned) ? own.find((s) => !taken.has(s.key) && s.at.getTime() === planned) : undefined;
    if (exact) {
      taken.add(exact.key);
      out.set(exact.key, r);
    } else rest.push(r);
  }
  for (const r of rest) {
    const t = timeOf(r);
    let best: Windowed | null = null;
    for (const s of slotsByProtocol.get(r.protocolId ?? "") ?? []) {
      if (taken.has(s.key) || t < s.windowStart.getTime() || t >= s.windowEnd.getTime()) continue;
      if (!best || Math.abs(t - s.at.getTime()) < Math.abs(t - best.at.getTime())) best = s;
    }
    if (best) {
      taken.add(best.key);
      out.set(best.key, r);
    }
  }
  return out;
}

/** Scheduled doses from day `from` to `to` (inclusive) with what happened to each. */
export function matchSlots(
  protocols: readonly Protocol[],
  doses: readonly DoseLog[],
  skips: readonly SkipLog[],
  from: string,
  to: string,
  now: Date,
): MatchResult {
  const live = protocols.filter(isLive);
  const byProtocol = new Map<string, Windowed[]>();
  for (const p of live) {
    const own = withWindows(occurrences(p, addDays(from, -2), addDays(to, 2)));
    if (own.length > 0) byProtocol.set(p.id, own);
  }
  const windowed = [...byProtocol.values()].flat().sort((a, b) => a.at.getTime() - b.at.getTime());

  const liveDoses = doses.filter(isLive).sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const linked = liveDoses.filter((d) => d.protocolId !== null);
  const used = new Set<string>();
  const doseBySlot = pair(linked, byProtocol, used, (d) => Date.parse(d.takenAt));
  const skipBySlot = pair(
    skips.filter(isLive).map((s) => ({ ...s, protocolId: s.protocolId as string | null })),
    byProtocol,
    used,
    (s) => Date.parse(s.scheduledFor),
  );

  const fromMs = parseDayKey(from).getTime();
  const toMs = parseDayKey(addDays(to, 1)).getTime();
  const inRange = (ms: number) => ms >= fromMs && ms < toMs;
  const nowMs = now.getTime();

  const slots: Slot[] = windowed
    .filter((s) => inRange(s.at.getTime()))
    .map((s) => {
      const dose = doseBySlot.get(s.key) ?? null;
      const skip = dose ? null : ((skipBySlot.get(s.key) as SkipLog | undefined) ?? null);
      const state: SlotState = dose ? "taken" : skip ? "skipped" : nowMs >= s.windowEnd.getTime() ? "missed" : "open";
      return { ...s, state, dose, skip, timing: dose ? timingOf(new Date(dose.takenAt), s.at) : null };
    });

  const matchedIds = new Set([...doseBySlot.values()].map((d) => d.id));
  const extras = liveDoses.filter((d) => !matchedIds.has(d.id) && inRange(Date.parse(d.takenAt)));
  return { slots, extras };
}

// ── Today ────────────────────────────────────────────────────────────────

export type TodayMode = "empty" | "rest" | "done" | "due" | "upcoming";

export interface TimeGroup {
  time: string;
  label: string;
  slots: Slot[];
}

export interface NextAfter {
  protocol: Protocol;
  at: Date;
}

export interface TodayPlan {
  day: string;
  mode: TodayMode;
  slots: Slot[];
  groups: TimeGroup[];
  extras: DoseLog[];
  /** Open doses sharing the earliest open time. */
  next: Slot[];
  /** Minutes past the next dose's time (0 when not late). */
  lateMinutes: number;
  minutesUntil: number;
  taken: number;
  total: number;
  /** The next dose after today, for the rest / done card. */
  after: NextAfter | null;
}

function groupLabel(time: string): string {
  const hour = Number(time.slice(0, 2));
  return hour < 12 ? "MORNING" : hour < 17 ? "AFTERNOON" : "EVENING";
}

/** The first dose after today across active protocols. */
export function nextAfterToday(protocols: readonly Protocol[], now: Date): NextAfter | null {
  const tomorrow = parseDayKey(addDays(dayKey(now), 1));
  let best: NextAfter | null = null;
  for (const p of protocols) {
    if (!isLive(p)) continue;
    const [o] = nextOccurrences(p, tomorrow, 1);
    if (o && (!best || o.at < best.at)) best = { protocol: p, at: o.at };
  }
  return best;
}

export function buildToday(protocols: readonly Protocol[], doses: readonly DoseLog[], skips: readonly SkipLog[], now: Date): TodayPlan {
  const day = dayKey(now);
  const { slots, extras } = matchSlots(protocols, doses, skips, day, day, now);
  const order = new Map(protocols.map((p, i) => [p.id, i] as const));
  const sorted = [...slots].sort((a, b) => a.at.getTime() - b.at.getTime() || (order.get(a.protocolId) ?? 0) - (order.get(b.protocolId) ?? 0));

  const groups: TimeGroup[] = [];
  for (const s of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.time === s.time) last.slots.push(s);
    else groups.push({ time: s.time, label: groupLabel(s.time), slots: [s] });
  }

  const open = sorted.filter((s) => s.state === "open");
  const next = open.length > 0 ? open.filter((s) => s.at.getTime() === open[0].at.getTime()) : [];
  const hasProtocols = protocols.some((p) => isLive(p) && p.status !== "archived");

  let mode: TodayMode;
  if (!hasProtocols && extras.length === 0) mode = "empty";
  else if (sorted.length === 0) mode = "rest";
  else if (next.length === 0) mode = "done";
  else mode = now.getTime() >= next[0].at.getTime() - DUE_EARLY_MS ? "due" : "upcoming";

  const deltaMin = next.length > 0 ? Math.round((now.getTime() - next[0].at.getTime()) / 60_000) : 0;
  return {
    day,
    mode,
    slots: sorted,
    groups,
    extras,
    next,
    lateMinutes: Math.max(0, deltaMin),
    minutesUntil: Math.max(0, -deltaMin),
    taken: sorted.filter((s) => s.state === "taken").length,
    total: sorted.filter((s) => s.state !== "skipped").length,
    after: nextAfterToday(protocols, now),
  };
}

/** "in 2 h", "in 45 min", "now", "45 min late", "2 h late". */
export function relativeLabel(plan: Pick<TodayPlan, "lateMinutes" | "minutesUntil">): string {
  if (plan.lateMinutes > 5) return plan.lateMinutes >= 90 ? `${Math.round(plan.lateMinutes / 60)} h late` : `${plan.lateMinutes} min late`;
  if (plan.minutesUntil <= 5) return "now";
  return plan.minutesUntil >= 90 ? `in ${Math.round(plan.minutesUntil / 60)} h` : `in ${plan.minutesUntil} min`;
}

/** The scheduled time for a back-dated log on `day`: the protocol's first time that day. */
export function defaultTimeOn(day: string, protocol: Protocol | null): Date {
  return atTime(day, protocol?.times[0] ?? "09:00");
}
