/**
 * Vial inventory (spec §5.8): what's left is always worked out from the doses
 * logged against the vial, never stored — editing or deleting a dose corrects
 * it automatically.
 */
import { addDays, daysBetween, dayKey } from "./ids";
import { doseInVialUnit } from "./dose-math";
import { nextOccurrences } from "./schedule";
import { isLive, type DoseLog, type Mix, type Protocol, type Vial, type VialUnit } from "./types";

/** Low stock: this many doses left or fewer… */
export const LOW_DOSES = 3;
/** …or this share of the vial or less. */
export const LOW_PCT = 15;

export interface VialStatus {
  vial: Vial;
  used: number;
  remaining: number;
  /** 0–100 */
  pct: number;
  /** Null when the protocol's dose can't be measured in the vial's unit. */
  dosesLeft: number | null;
  runOutDate: Date | null;
  daysSinceMixed: number | null;
  isLow: boolean;
  /** YYYY-MM-DD, or null when the vial isn't mixed and has no date set. */
  expiresOn: string | null;
  isExpired: boolean;
}

/** A mixed vial's default shelf life. */
export const VIAL_EXPIRY_DAYS = 28;

/** The vial's expiry day: its own date, else mixed + 28 days (null when neither is known). */
export function vialExpiry(vial: Pick<Vial, "expiresOn" | "mixedOn">): string | null {
  if (vial.expiresOn) return vial.expiresOn;
  return vial.mixedOn ? addDays(vial.mixedOn, VIAL_EXPIRY_DAYS) : null;
}

export function vialStatus(vial: Vial, doses: readonly DoseLog[], protocol: Protocol | null, now: Date): VialStatus {
  const mix = vial.waterMl ? { vialAmount: vial.amount, waterMl: vial.waterMl } : null;
  const used = doses
    .filter((d) => isLive(d) && d.vialId === vial.id)
    .reduce((sum, d) => {
      const own = doseInVialUnit(d.dose, vial.unit, mix);
      if (own !== null) return sum + own;
      // A dose in an unconvertible unit still used the volume it recorded.
      return d.volumeMl && mix ? sum + (d.volumeMl * mix.vialAmount) / mix.waterMl : sum;
    }, 0);
  const remaining = Math.max(0, vial.amount - used);
  const pct = vial.amount > 0 ? Math.round((remaining / vial.amount) * 100) : 0;

  const perDose = protocol ? doseInVialUnit(protocol.dose, vial.unit, mix) : null;
  const dosesLeft = perDose && perDose > 0 ? Math.floor(remaining / perDose + 1e-9) : null;

  let runOutDate: Date | null = null;
  if (protocol && dosesLeft !== null && vial.status === "active" && !vial.unopened) {
    if (dosesLeft === 0) runOutDate = now;
    else {
      const ahead = nextOccurrences(protocol, now, dosesLeft);
      runOutDate = ahead.length === dosesLeft ? ahead[ahead.length - 1].at : null;
    }
  }

  const daysSinceMixed = vial.mixedOn ? daysBetween(vial.mixedOn, dayKey(now)) : null;
  const isLow = vial.status === "active" && !vial.unopened && ((dosesLeft !== null && dosesLeft <= LOW_DOSES) || pct <= LOW_PCT);
  const expiresOn = vialExpiry(vial);
  const isExpired = vial.status !== "finished" && expiresOn !== null && daysBetween(expiresOn, dayKey(now)) > 0;
  return { vial, used, remaining, pct, dosesLeft, runOutDate, daysSinceMixed, isLow, expiresOn, isExpired };
}

/** The protocol's vial in use: the newest active one. */
export function activeVial(vials: readonly Vial[], protocolId: string): Vial | null {
  const own = vials.filter((v) => isLive(v) && v.protocolId === protocolId && v.status === "active" && !v.unopened);
  if (own.length === 0) return null;
  return [...own].sort((a, b) => (b.mixedOn ?? b.createdAt).localeCompare(a.mixedOn ?? a.createdAt))[0];
}

/** "Vial 2" — the vial's place among the protocol's vials, oldest first. */
export function vialNumber(vials: readonly Vial[], vial: Vial): number {
  const own = vials.filter((v) => isLive(v) && v.protocolId === vial.protocolId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return own.findIndex((v) => v.id === vial.id) + 1;
}

/** The mix a vial was made up with (null without the water added). */
export function vialMix(vial: Vial | null): Mix | null {
  return vial && vial.waterMl && vial.waterMl > 0 ? { vialAmount: vial.amount, vialUnit: vial.unit, waterMl: vial.waterMl } : null;
}

/**
 * The vial size + water in use: the vial in use when it has one (a new or
 * re-mixed vial can differ from setup), else the protocol's. Inventory only —
 * v1 never turns it into a units/mL draw.
 */
export function effectiveMix(protocol: Pick<Protocol, "id" | "mix">, vials: readonly Vial[]): Mix | null {
  return vialMix(activeVial(vials, protocol.id)) ?? protocol.mix;
}

/** The protocol with its mix taken from the vial in use (for screens and reminders that read `protocol.mix`). */
export function withVialMix<T extends Pick<Protocol, "id" | "mix">>(protocol: T, vials: readonly Vial[]): T {
  const mix = effectiveMix(protocol, vials);
  return mix === protocol.mix ? protocol : { ...protocol, mix };
}

function mixedDay(vial: Vial): string {
  return vial.mixedOn ?? dayKey(new Date(vial.createdAt));
}

/**
 * The vial a dose taken at `takenAt` came out of: the protocol's vial mixed
 * most recently on or before that day (the one in use wins a same-day tie).
 * Null when no vial was mixed yet, so a back-dated dose never comes off a
 * vial that didn't exist.
 */
export function vialForDose(vials: readonly Vial[], protocolId: string, takenAt: Date): Vial | null {
  const day = dayKey(takenAt);
  const own = vials.filter((v) => isLive(v) && v.protocolId === protocolId && !v.unopened && mixedDay(v) <= day);
  const rank = (v: Vial) => `${mixedDay(v)}|${v.status === "active" ? 1 : 0}|${v.createdAt}`;
  return [...own].sort((a, b) => rank(b).localeCompare(rank(a)))[0] ?? null;
}

/** The parts of a delivered order line (TrackerOrderVial) a new vial uses. */
export interface OrderLineDraft {
  key: string;
  strength: { value: number; unit: VialUnit } | null;
}

/**
 * A new, unopened vial from a delivered order line ("Add vial from my orders",
 * TRACKER.md §3). Null when the line states no strength — the user enters it
 * then. Water and mixing date stay empty until the user mixes it (unopened → false).
 */
export function vialFromOrder(line: OrderLineDraft, protocolId: string): Omit<Vial, "id" | "createdAt" | "updatedAt" | "deletedAt"> | null {
  const s = line.strength;
  if (!s || !Number.isFinite(s.value) || s.value <= 0) return null;
  return { protocolId, amount: s.value, unit: s.unit, waterMl: null, mixedOn: null, lot: null, status: "active", unopened: true, source: { kind: "order", key: line.key } };
}

/** Order lines already turned into a live vial (deleting the vial offers the line again). */
export function addedOrderKeys(vials: readonly Vial[]): Set<string> {
  const out = new Set<string>();
  for (const v of vials) if (isLive(v) && v.source?.kind === "order") out.add(v.source.key);
  return out;
}
