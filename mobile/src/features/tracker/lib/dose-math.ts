/**
 * Unit maths for a mixed vial: vial contents + water added → concentration →
 * the volume and syringe units for a dose (spec §5.2). The member enters every
 * number; this only converts them, and flags numbers that look like a typo.
 *
 * v1 SHOWS NO units / mL draw anywhere (App Store 1.4.2): the converter is a
 * later feature behind `mobile.tracker.converter`. Until then the app uses
 * this file only internally — mcg↔mg so a vial counts down (doseInVialUnit),
 * and the input checks in `inputWarnings` (dose over the whole vial, IU vs mg).
 */
import type { Dose, DoseUnit, Mix, SyringeKind, VialUnit } from "./types";

export interface SyringeSpec {
  label: string;
  /** Units a full barrel holds (U-100: 100 units = 1 mL). */
  units: number;
  ml: number;
}

export const SYRINGES: Record<SyringeKind, SyringeSpec> = {
  u100_1ml: { label: "U-100 · 1 mL", units: 100, ml: 1 },
  u100_05ml: { label: "U-100 · 0.5 mL", units: 50, ml: 0.5 },
  u100_03ml: { label: "U-100 · 0.3 mL", units: 30, ml: 0.3 },
};

export const SYRINGE_KINDS: SyringeKind[] = ["u100_1ml", "u100_05ml", "u100_03ml"];

/** U-100 insulin syringes: 100 units per mL. */
const UNITS_PER_ML = 100;
const TINY_DRAW_UNITS = 2;

export type DrawWarning = "tiny" | "overSyringe" | "overVial" | "iuMismatch";

export const DRAW_WARNING_TEXT: Record<DrawWarning, string> = {
  tiny: "This is a very small draw (under 2 units). Check your numbers.",
  overSyringe: "That's more than one full syringe. Check your numbers or choose a larger syringe.",
  overVial: "Your dose is more than the whole vial. Check your numbers.",
  iuMismatch: "IU can't be converted to mg. Use the same unit as your vial label.",
};

const BLOCKING: ReadonlySet<DrawWarning> = new Set(["overVial", "iuMismatch"]);

export type Draw =
  | { kind: "empty" }
  | {
      kind: "ok";
      volumeMl: number;
      units: number;
      dosesPerVial: number;
      warnings: DrawWarning[];
      isBlocked: boolean;
    }
  | { kind: "invalid"; warnings: DrawWarning[]; isBlocked: true };

/** mg / mcg into mcg; IU stays IU. Null when the units can't be compared. */
export function toBase(value: number, unit: DoseUnit | VialUnit): { amount: number; base: "mcg" | "iu" } | null {
  if (unit === "mg") return { amount: value * 1000, base: "mcg" };
  if (unit === "mcg") return { amount: value, base: "mcg" };
  if (unit === "iu") return { amount: value, base: "iu" };
  return null;
}

const positive = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** True when the dose can be measured against a mixed vial (mcg/mg/IU). */
export function isMassUnit(unit: DoseUnit): boolean {
  return unit === "mcg" || unit === "mg" || unit === "iu";
}

/** The draw for one dose from a mixed vial, with the warnings the setup screen shows. */
export function computeDraw(mix: Partial<Mix> | null, dose: Partial<Dose> | null, syringe: SyringeKind | null): Draw {
  if (!mix || !dose || !positive(mix.vialAmount) || !positive(mix.waterMl) || !positive(dose.value) || !mix.vialUnit || !dose.unit) {
    return { kind: "empty" };
  }
  const vial = toBase(mix.vialAmount, mix.vialUnit);
  const want = toBase(dose.value, dose.unit);
  if (!vial || !want || vial.base !== want.base) return { kind: "invalid", warnings: ["iuMismatch"], isBlocked: true };

  const perMl = vial.amount / mix.waterMl;
  const volumeMl = want.amount / perMl;
  const units = volumeMl * UNITS_PER_ML;
  const dosesPerVial = Math.floor(vial.amount / want.amount + 1e-9);

  const warnings: DrawWarning[] = [];
  if (want.amount > vial.amount + 1e-9) warnings.push("overVial");
  if (units < TINY_DRAW_UNITS) warnings.push("tiny");
  const capacity = SYRINGES[syringe ?? "u100_1ml"].units;
  if (units > capacity + 1e-9) warnings.push("overSyringe");

  return { kind: "ok", volumeMl, units, dosesPerVial, warnings, isBlocked: warnings.some((w) => BLOCKING.has(w)) };
}

/** The checks on the numbers themselves (not on a syringe draw) — the only warnings v1 shows. */
export function inputWarnings(draw: Draw): DrawWarning[] {
  return draw.kind === "empty" ? [] : draw.warnings.filter((w) => BLOCKING.has(w));
}

/** A dose converted into the vial's own unit (for counting what's left). Null when it can't be. */
export function doseInVialUnit(dose: Dose, vialUnit: VialUnit, mix: Pick<Mix, "vialAmount" | "waterMl"> | null): number | null {
  const vialBase = toBase(1, vialUnit);
  if (!vialBase) return null;
  const want = toBase(dose.value, dose.unit);
  if (want && want.base === vialBase.base) return want.amount / vialBase.amount;
  // Volumes (and legacy syringe "units") convert through the mix's concentration.
  if (mix && positive(mix.vialAmount) && positive(mix.waterMl)) {
    const ml = dose.unit === "ml" ? dose.value : dose.unit === "units" ? dose.value / UNITS_PER_ML : null;
    if (ml !== null) return (ml * mix.vialAmount) / mix.waterMl;
  }
  return null;
}

/** Trims trailing zeros: 0.10 → "0.1" is NOT wanted for mL, so callers pick the decimals. */
function fixed(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

function trim(value: number, decimals: number): string {
  const s = value.toFixed(decimals);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** "0.10 mL" (≈ when rounded). */
export function formatMl(ml: number): string {
  const s = fixed(ml, 2);
  return `${Math.abs(Number(s) - ml) > 1e-9 ? "≈" : ""}${s} mL`;
}

/** "10 u" / "≈12.5 u". */
export function formatUnits(units: number, long = false): string {
  const s = trim(units, 1);
  return `${Math.abs(Number(s) - units) > 1e-9 ? "≈" : ""}${s}${long ? " units" : " u"}`;
}

const UNIT_LABEL: Record<DoseUnit, string> = { mcg: "mcg", mg: "mg", iu: "IU", caps: "caps", ml: "mL", units: "units" };

export function unitLabel(unit: DoseUnit | VialUnit): string {
  return UNIT_LABEL[unit];
}

/** "250 mcg", "0.25 mg", "1 caps". */
export function formatDose(dose: Dose): string {
  return `${trim(dose.value, 3)} ${UNIT_LABEL[dose.unit]}`;
}

/** "250 mcg · 0.10 mL · 10 u" — or just "250 mcg" without a usable mix. */
export function formatTriple(dose: Dose, mix: Mix | null, syringe: SyringeKind | null = null): string {
  const draw = computeDraw(mix, dose, syringe);
  if (draw.kind !== "ok") return formatDose(dose);
  return `${formatDose(dose)} · ${formatMl(draw.volumeMl)} · ${formatUnits(draw.units)}`;
}

/** Parses typed numbers ("2", "0.25", "2,5"). Null when blank or not a number. */
export function parseAmount(text: string): number | null {
  const cleaned = text.trim().replace(",", ".");
  if (!cleaned || !/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Reads a dose written as text ("250mcg", "0.25 mg", "10 units", "5000 IU"). */
export function parseDoseText(text: string | null | undefined): Dose | null {
  if (!text) return null;
  const m = /(\d+(?:[.,]\d+)?)\s*(mcg|µg|ug|mg|iu|ml|units?|u|caps?|capsules?|tablets?)?\b/i.exec(text.trim());
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  const raw = (m[2] ?? "").toLowerCase();
  const unit: DoseUnit | null =
    raw === "mcg" || raw === "µg" || raw === "ug"
      ? "mcg"
      : raw === "mg"
        ? "mg"
        : raw === "iu"
          ? "iu"
          : raw === "ml"
            ? "ml"
            : raw.startsWith("cap") || raw.startsWith("tablet")
              ? "caps"
              : raw === "u" || raw.startsWith("unit")
                ? "units"
                : null;
  return unit ? { value, unit } : null;
}
