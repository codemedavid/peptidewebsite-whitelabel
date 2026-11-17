// Peptide Tracker text/list caps the server enforces (records.ts zod schemas).
//
// Pure constants, no imports: the app mirrors these in
// mobile/src/features/tracker/lib/caps.ts, and mobile/scripts/test-tracker-caps.ts
// imports this file to assert the two never drift (a client that allows more
// than the server gets its records silently refused at sync).

export const TRACKER_SERVER_CAPS = {
  /** Record ids and references (protocolId, vialId, catalogId). */
  id: 64,
  /** Protocol / dose-log name. */
  name: 120,
  /** Protocol category. */
  category: 80,
  /** Protocol colour token. */
  color: 32,
  /** Any free-text note (dose, skip, check-in). */
  note: 2000,
  /** Vial lot number. */
  lot: 80,
  /** One check-in side effect. */
  effect: 60,
  /** Side effects per check-in. */
  effects: 30,
  /** Open-ended labels: route, site, syringe, skip reason. */
  token: 32,
  /** Dose times per protocol. */
  times: 6,
  /** Schedule-history periods per protocol. */
  history: 200,
  /** Water added to a vial / a dose volume, mL. */
  waterMl: 100,
  /** A check-in weight, kg. */
  weightKg: 700,
  /** "Every N days" and cycle on/off days. */
  days: 365,
} as const;

export type TrackerCapKey = keyof typeof TRACKER_SERVER_CAPS;
