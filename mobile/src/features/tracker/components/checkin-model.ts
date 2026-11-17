/**
 * The check-in form's rules (pure — tested by scripts/test-tracker-checkin-model.ts).
 *
 * Side effects: `effects: []` means "not answered"; `[NO_EFFECTS]` means the
 * user said "No side effects today" (the gap TRACKER.md §1 found in Shotsy).
 * Choosing it clears every other effect, and choosing any effect clears it.
 */
import { INPUT_CAPS } from "../lib/caps";
import { parseAmount } from "../lib/dose-math";
import { SIDE_EFFECTS, type CheckIn, type Scale, type WeightUnit } from "../lib/types";
import { toKg, toUnit } from "../lib/weight";

/** Stored in `effects` for an explicit "No side effects today" (other screens: count it as zero effects). */
export const NO_EFFECTS = "None";
/** The free-text chip ("Other"). */
export const MAX_OTHER_LEN = INPUT_CAPS.effect;
export const MAX_NOTE_LEN = INPUT_CAPS.note;
/** The whole "Other" box (each comma-separated item is still cut to MAX_OTHER_LEN). */
export const MAX_OTHER_TEXT = INPUT_CAPS.effectsText;
/** Plausible body weights in kg; outside this it's a typo. */
export const MIN_KG = 20;
export const MAX_KG = INPUT_CAPS.weightKg;

export type ScaleKey = "energy" | "mood" | "appetite" | "sleep";
export const SCALE_POINTS: readonly Scale[] = [1, 2, 3, 4, 5];

export type ScaleSpec = { key: ScaleKey; label: string; words: readonly [string, string, string, string, string] };

export const SCALES: readonly ScaleSpec[] = [
  { key: "energy", label: "Energy", words: ["Drained", "Low", "Okay", "Good", "Great"] },
  { key: "mood", label: "Mood", words: ["Very low", "Low", "Okay", "Good", "Great"] },
  { key: "appetite", label: "Appetite", words: ["None", "Low", "Normal", "Strong", "Very strong"] },
  { key: "sleep", label: "Sleep", words: ["Very poor", "Poor", "Okay", "Good", "Great"] },
];

const KNOWN = new Set<string>(SIDE_EFFECTS);

export type CheckInForm = {
  scales: Record<ScaleKey, Scale | null>;
  /** Known chips (SIDE_EFFECTS) and/or NO_EFFECTS. */
  effects: string[];
  /** The "Other" text, comma-separated. */
  other: string;
  weight: string;
  note: string;
};

export const EMPTY_FORM: CheckInForm = {
  scales: { energy: null, mood: null, appetite: null, sleep: null },
  effects: [],
  other: "",
  weight: "",
  note: "",
};

/** The form for a saved day (weight shown in the user's unit). */
export function formFrom(existing: CheckIn | null | undefined, unit: WeightUnit): CheckInForm {
  if (!existing) return EMPTY_FORM;
  return {
    scales: { energy: existing.energy, mood: existing.mood, appetite: existing.appetite, sleep: existing.sleep },
    effects: existing.effects.filter((e) => KNOWN.has(e) || e === NO_EFFECTS),
    other: existing.effects.filter((e) => !KNOWN.has(e) && e !== NO_EFFECTS).join(", "),
    weight: existing.weightKg ? toUnit(existing.weightKg, unit).toFixed(1) : "",
    note: existing.note ?? "",
  };
}

/** Taps an effect chip: "none" and real effects exclude each other. */
export function toggleEffect(effects: readonly string[], effect: string): string[] {
  if (effects.includes(effect)) return effects.filter((e) => e !== effect);
  if (effect === NO_EFFECTS) return [NO_EFFECTS];
  return [...effects.filter((e) => e !== NO_EFFECTS), effect];
}

/** The "Other" text as separate effects (trimmed, de-duplicated, length-capped). */
export function otherEffects(other: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of other.split(",")) {
    const e = raw.trim().slice(0, MAX_OTHER_LEN);
    const k = e.toLowerCase();
    if (!e || seen.has(k) || KNOWN.has(e) || e === NO_EFFECTS) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

export type CheckInValues = Omit<CheckIn, "id" | "createdAt" | "updatedAt" | "deletedAt" | "date">;

export type FormResult = { ok: true; values: CheckInValues } | { ok: false; reason: string };

/** Validates and converts the form (weight → kg). "None" wins only when no other effect was typed. */
export function formToValues(form: CheckInForm, unit: WeightUnit): FormResult {
  let weightKg: number | null = null;
  if (form.weight.trim()) {
    const value = parseAmount(form.weight);
    if (value === null) return { ok: false, reason: `Enter your weight as a number in ${unit}.` };
    weightKg = Math.round(toKg(value, unit) * 100) / 100;
    if (weightKg < MIN_KG || weightKg > MAX_KG) return { ok: false, reason: `That doesn’t look like a weight in ${unit}.` };
  }
  const typed = form.effects.includes(NO_EFFECTS) ? [] : otherEffects(form.other);
  // The server takes at most INPUT_CAPS.effects per check-in; chips first, then typed ones.
  const effects = [...form.effects, ...typed].slice(0, INPUT_CAPS.effects);
  const note = form.note.trim().slice(0, MAX_NOTE_LEN);
  return { ok: true, values: { ...form.scales, effects, note: note || null, weightKg } };
}

/** Something to save (an all-empty check-in is not worth a record). */
export function hasAnswer(form: CheckInForm): boolean {
  return Object.values(form.scales).some((v) => v !== null) || form.effects.length > 0 || otherEffects(form.other).length > 0 || !!form.weight.trim() || !!form.note.trim();
}

/** The latest weigh-in before `date` (for "Last: 72.4 kg · 3 Nov"). */
export function lastWeight(checkins: readonly CheckIn[], date: string): CheckIn | null {
  let best: CheckIn | null = null;
  for (const c of checkins) {
    if (c.weightKg === null || c.date >= date) continue;
    if (!best || c.date > best.date) best = c;
  }
  return best;
}
