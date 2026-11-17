/**
 * Input caps, in ONE place for the app. `SERVER_CAPS` mirrors the server's zod
 * caps (src/lib/tracker/caps.ts): a record over any of them is refused at
 * sync, so nothing the app builds may exceed them. `INPUT_CAPS` are the
 * (tighter) limits the screens' fields use; each must stay within its server
 * cap. mobile/scripts/test-tracker-caps.ts checks both against the server file.
 */

export const SERVER_CAPS = {
  id: 64,
  name: 120,
  category: 80,
  color: 32,
  note: 2000,
  lot: 80,
  effect: 60,
  effects: 30,
  token: 32,
  times: 6,
  history: 200,
  waterMl: 100,
  weightKg: 700,
  days: 365,
} as const;

export type CapKey = keyof typeof SERVER_CAPS;

/** What the fields allow (≤ SERVER_CAPS for the same key). */
export const INPUT_CAPS = {
  /** Protocol name (CompoundStep). */
  name: 60,
  /** Dose-log, skip and check-in notes. */
  note: 500,
  /** Vial lot number. */
  lot: 40,
  /** One typed side effect. */
  effect: SERVER_CAPS.effect,
  /** Side effects per check-in (chips + typed). */
  effects: SERVER_CAPS.effects,
  /** The "Other" side-effects box (comma-separated; each item is cut to `effect`). */
  effectsText: 180,
  /** Dose times per protocol. */
  times: 3,
  /** Water added, mL. */
  waterMl: SERVER_CAPS.waterMl,
  /** A plausible body weight, kg (a typo guard well inside the server's). */
  weightKg: 400,
  /** "Every N days". */
  everyDays: 30,
} as const;

/** Trims to a server cap (for text that doesn't come from a capped field, e.g. a store guide). */
export function capText(value: string, key: CapKey): string {
  const cap = SERVER_CAPS[key];
  return value.length > cap ? value.slice(0, cap) : value;
}
