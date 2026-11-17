/**
 * Pure helpers for the Calendar: month keys ("YYYY-MM"), the Sunday-aligned
 * grid, per-day extras the month grid draws on top of the day state (cycle
 * off-days, all-skipped days, one dot per protocol) and the month's tally.
 */
import type { DayInfo } from "../../lib/consistency";
import { dayKey, isDayKey, MONTH_LONG, parseDayKey, weekday } from "../../lib/ids";
import { inCycleOn, ruleOn } from "../../lib/schedule";
import { realEffects, reportsEffects } from "./progress-model";
import { formatWeight } from "../../lib/weight";
import type { CheckIn, Protocol, WeightUnit } from "../../lib/types";

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-17" → "2026-11". */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** "November 2026". */
export function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_LONG[m - 1]} ${y}`;
}

/** The month's days, Sunday-aligned, padded with nulls to whole weeks. */
export function monthCells(month: string): (string | null)[] {
  const first = `${month}-01`;
  if (!isDayKey(first)) return [];
  const start = parseDayKey(first);
  const count = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const lead = weekday(first);
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= count; d += 1) cells.push(dayKey(new Date(start.getFullYear(), start.getMonth(), d)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export interface ProtocolDot {
  protocolId: string;
  color: string;
  isTaken: boolean;
}

export interface DayExtra {
  /** Nothing due because a cycle is in its off phase. */
  offCycle: string[];
  /** Every due dose that day was skipped. */
  allSkipped: boolean;
  dots: ProtocolDot[];
}

/** Draws on top of DayInfo.state: off-cycle shading, skipped days and protocol dots. */
export function dayExtras(days: readonly DayInfo[], protocols: readonly Protocol[]): Map<string, DayExtra> {
  const byId = new Map(protocols.map((p) => [p.id, p] as const));
  const cycled = protocols.filter((p) => p.cycle || (p.history ?? []).some((h) => h.cycle));
  const out = new Map<string, DayExtra>();
  for (const d of days) {
    const offCycle =
      d.slots.length > 0
        ? []
        : cycled
            .filter((p) => {
              const rule = ruleOn(p, d.day);
              return !!rule && !!rule.cycle && !inCycleOn(rule.cycle, p.startDate, d.day);
            })
            .map((p) => p.name);
    const taken = new Map<string, boolean>();
    for (const s of d.slots) taken.set(s.protocolId, (taken.get(s.protocolId) ?? false) || s.state === "taken");
    for (const x of d.extras) if (x.protocolId) taken.set(x.protocolId, true);
    const dots = [...taken.entries()].flatMap(([id, isTaken]) => {
      const p = byId.get(id);
      return p ? [{ protocolId: id, color: p.color, isTaken }] : [];
    });
    out.set(d.day, { offCycle, allSkipped: d.slots.length > 0 && d.slots.every((s) => s.state === "skipped"), dots });
  }
  return out;
}

export interface MonthTally {
  taken: number;
  missed: number;
  skipped: number;
  /** Still to come this month (today's open doses included). */
  ahead: number;
}

export function monthTally(days: readonly DayInfo[]): MonthTally {
  const t: MonthTally = { taken: 0, missed: 0, skipped: 0, ahead: 0 };
  for (const d of days) {
    t.taken += d.extras.length;
    for (const s of d.slots) {
      if (s.state === "taken") t.taken += 1;
      else if (s.state === "missed") t.missed += 1;
      else if (s.state === "skipped") t.skipped += 1;
      else t.ahead += 1;
    }
  }
  return t;
}

const SCALES = [
  ["energy", "Energy"],
  ["mood", "Mood"],
  ["appetite", "Appetite"],
  ["sleep", "Sleep"],
] as const;

/** "Nausea, Headache · Energy 4/5 · Mood 3/5 · 72.4 kg". */
export function checkInSummary(c: CheckIn, unit: WeightUnit): string {
  const effects = realEffects(c);
  const parts: string[] = [];
  if (effects.length > 0) parts.push(effects.join(", "));
  else if (reportsEffects(c)) parts.push("No side effects");
  for (const [k, label] of SCALES) if (c[k] !== null) parts.push(`${label} ${c[k]}/5`);
  if (c.weightKg !== null) parts.push(formatWeight(c.weightKg, unit));
  return parts.length > 0 ? parts.join(" · ") : "Saved";
}
