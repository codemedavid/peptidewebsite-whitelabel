/**
 * The estimated level curve (TRACKER.md §1, v2): every logged dose decays by
 * first-order elimination from the half-life the USER entered, and the curve
 * is the sum of what is left of each at time t:
 *
 *   level(t) = Σ amount_i · 0.5 ^ ((t − takenAt_i) / halfLifeHours)   for takenAt_i ≤ t
 *
 * THIS IS AN ESTIMATE for tracking only, never a measurement and never advice:
 * it assumes instant absorption, one compartment and a fixed half-life, and it
 * knows nothing about the person. Amounts are in the protocol's dose unit;
 * doses logged in a unit that can't be converted to it are left out. The UI
 * overlays check-in side effects on it.
 */
import { toBase } from "./dose-math";
import type { DoseLog, DoseUnit } from "./types";

const HOUR_MS = 3_600_000;
/** Upper bound on points, so a tiny step over a long range can't stall a render. */
export const MAX_LEVEL_POINTS = 2000;

export interface LevelPoint {
  /** Epoch ms. */
  t: number;
  /** Estimated amount still present, in the protocol's dose unit. */
  level: number;
}

type LevelDose = Pick<DoseLog, "takenAt" | "dose" | "deletedAt">;

/** `value` of `from` expressed in `to` (mcg ⇄ mg; same unit as is). Null when they can't be compared. */
export function convertDose(value: number, from: DoseUnit, to: DoseUnit): number | null {
  if (from === to) return value;
  const a = toBase(value, from);
  const unit = toBase(1, to);
  if (!a || !unit || a.base !== unit.base) return null;
  return a.amount / unit.amount;
}

/**
 * Points from `from` to `to` (inclusive) every `stepHours`. `unit` defaults to
 * the newest dose's unit. Empty when the half-life or step isn't a positive
 * number or the range is backwards.
 */
export function levelCurve(
  doses: readonly LevelDose[],
  halfLifeHours: number,
  from: Date,
  to: Date,
  stepHours: number,
  unit?: DoseUnit,
): LevelPoint[] {
  const start = from.getTime();
  const end = to.getTime();
  if (!(halfLifeHours > 0) || !(stepHours > 0) || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];

  const live = doses
    .filter((d) => !d.deletedAt && Number.isFinite(Date.parse(d.takenAt)))
    .sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const target = unit ?? live[live.length - 1]?.dose.unit;
  const events: { at: number; amount: number }[] = [];
  for (const d of live) {
    const amount = target ? convertDose(d.dose.value, d.dose.unit, target) : null;
    if (amount !== null && amount > 0) events.push({ at: Date.parse(d.takenAt), amount });
  }

  const stepMs = Math.max(stepHours * HOUR_MS, (end - start) / (MAX_LEVEL_POINTS - 1));
  const halfLifeMs = halfLifeHours * HOUR_MS;
  const points: LevelPoint[] = [];
  for (let i = 0; ; i += 1) {
    const t = Math.min(end, start + i * stepMs);
    let level = 0;
    for (const e of events) {
      if (e.at > t) break;
      level += e.amount * 0.5 ** ((t - e.at) / halfLifeMs);
    }
    points.push({ t, level });
    if (t >= end) break;
  }
  return points;
}
