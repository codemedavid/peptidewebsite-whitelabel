/**
 * Tracker data model, ported from MamaMicaGlow lib/tracker/types.ts (the
 * "spec §" notes across lib/ point at that app's tracker spec). Pure types and
 * defaults only, so every lib module and its mobile/scripts/test-tracker-*.ts
 * can run under plain Node.
 *
 * The phone is the source of truth: each record carries its own id, timestamps
 * and a `deletedAt` tombstone (kept 60 days) so a delete survives the next sync
 * (POST /tracker/sync, docs/mobile-admin/TRACKER.md §5).
 */

export type DoseUnit = "mcg" | "mg" | "iu" | "caps" | "ml" | "units";
export type VialUnit = "mg" | "mcg" | "iu";
export type Route = "injection" | "pen" | "oral" | "nasal" | "topical" | "other";
export type SyringeKind = "u100_1ml" | "u100_05ml" | "u100_03ml";

export type ScheduleRule =
  | { kind: "daily" }
  /** 0 = Sunday. */
  | { kind: "weekdays"; days: number[] }
  /** 2 = every other day; counted from the protocol's startDate. */
  | { kind: "interval"; everyDays: number }
  | { kind: "asNeeded" };

/** On/off cycle, counted from the protocol's startDate. */
export interface Cycle {
  onDays: number;
  offDays: number;
}

export interface Synced {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Dose {
  value: number;
  unit: DoseUnit;
}

export interface Mix {
  vialAmount: number;
  vialUnit: VialUnit;
  waterMl: number;
}

export type ProtocolStatus = "active" | "paused" | "archived";

/**
 * Where a record was started from, so the app can hide what's already been
 * added: a delivered order line (TrackerOrderVial.key) or the store's guide
 * (TrackerStoreGuide.name). Absent = entered by hand.
 */
export type RecordSource = { kind: "order"; key: string } | { kind: "guide"; name: string };

export interface Protocol extends Synced {
  name: string;
  catalogId: string | null;
  category: string | null;
  color: string;
  route: Route;
  dose: Dose;
  mix: Mix | null;
  syringe: SyringeKind | null;
  schedule: ScheduleRule;
  cycle: Cycle | null;
  /** "HH:MM", 1–3 of them. */
  times: string[];
  /** YYYY-MM-DD */
  startDate: string;
  endDate: string | null;
  status: ProtocolStatus;
  reminders: boolean;
  rotateSites: boolean;
  /** Moved over from the old tracker with a dose it couldn't read: the detail screen asks to check it. */
  checkDose: boolean;
  /** YYYY-MM-DD the current pause began (status 'paused'); days before it keep their doses. */
  pausedFrom?: string | null;
  /** Earlier schedules, oldest first, so pausing or editing never rewrites past days (lib/schedule.ts). */
  history?: SchedulePeriod[];
  /** User-entered elimination half-life, for the estimated level curve (lib/level.ts). Never suggested by the app. */
  halfLifeHours?: number | null;
  /** Copied from the store's guide (or an order), when it was. */
  source?: RecordSource | null;
}

/** A past stretch of a protocol's schedule: it covered every day before `until` (back to the previous period, or startDate). */
export interface SchedulePeriod {
  /** YYYY-MM-DD, exclusive. */
  until: string;
  schedule: ScheduleRule;
  cycle: Cycle | null;
  times: string[];
  /** No doses were due (paused, or between an end and a restart). */
  paused: boolean;
}

export const SITE_IDS = ["belly_ll", "belly_lr", "belly_ul", "belly_ur", "thigh_l", "thigh_r", "glute_l", "glute_r", "arm_l", "arm_r"] as const;
export type SiteId = (typeof SITE_IDS)[number];

export interface DoseLog extends Synced {
  protocolId: string | null;
  /** Snapshot of the name: one-offs, and history after a protocol is gone. */
  name: string;
  takenAt: string;
  scheduledFor: string | null;
  dose: Dose;
  volumeMl: number | null;
  units: number | null;
  route: Route;
  site: SiteId | null;
  vialId: string | null;
  note: string | null;
}

export const SKIP_REASONS = ["rest", "side_effects", "ran_out", "forgot", "travel", "other"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  rest: "Rest day",
  side_effects: "Side effects",
  ran_out: "Ran out",
  forgot: "Forgot",
  travel: "Travelling",
  other: "Other",
};

export interface SkipLog extends Synced {
  protocolId: string;
  scheduledFor: string;
  reason: SkipReason;
  note: string | null;
}

export interface Vial extends Synced {
  protocolId: string;
  amount: number;
  unit: VialUnit;
  waterMl: number | null;
  mixedOn: string | null;
  lot: string | null;
  status: "active" | "finished";
  /**
   * On the shelf, not opened yet (e.g. added from an order): never logged
   * against and never the vial in use. A flag rather than a status so it
   * passes the server's active|finished check (passthrough field).
   */
  unopened?: boolean;
  /** YYYY-MM-DD; null = the default, mixedOn + VIAL_EXPIRY_DAYS (lib/vials.ts vialExpiry). */
  expiresOn?: string | null;
  /** Added from a delivered order line, when it was. */
  source?: RecordSource | null;
}

export type Scale = 1 | 2 | 3 | 4 | 5;

export interface CheckIn extends Synced {
  /** YYYY-MM-DD — one check-in per day. */
  date: string;
  energy: Scale | null;
  mood: Scale | null;
  appetite: Scale | null;
  sleep: Scale | null;
  effects: string[];
  note: string | null;
  weightKg: number | null;
}

export const SIDE_EFFECTS = ["Nausea", "Headache", "Site redness", "Fatigue", "Bloating", "Dizziness", "Low appetite"] as const;

export type WeightUnit = "kg" | "lb";

export interface TrackerSettings {
  weightUnit: WeightUnit;
  defaultSyringe: SyringeKind;
  doseReminders: boolean;
  refillReminders: boolean;
  checkinReminder: boolean;
  /** "HH:MM" */
  checkinTime: string;
  /** Peptide names + amounts in reminder titles (lock screen). Off by default: health data. */
  showNamesInNotifications: boolean;
  suggestSites: boolean;
  updatedAt: string;
}

export const DEFAULT_SETTINGS: TrackerSettings = {
  weightUnit: "lb",
  defaultSyringe: "u100_1ml",
  doseReminders: true,
  refillReminders: true,
  checkinReminder: false,
  checkinTime: "20:00",
  showNamesInNotifications: false,
  suggestSites: true,
  updatedAt: new Date(0).toISOString(),
};

/** One record kind per synced list (matches the contract's TrackerRecordKind). */
export type OutboxTable = "protocol" | "dose" | "skip" | "vial" | "checkin" | "settings";

/** A local change waiting to go up. One entry per record: a newer change replaces an older one. */
export interface OutboxOp {
  id: string;
  table: OutboxTable;
  op: "upsert" | "delete";
  recordId: string;
  at: string;
}

/** The settings record's fixed id on the server. */
export const SETTINGS_ID = "settings";

export interface TrackerMeta {
  /** The server's opaque sync cursor (null = pull everything on the next sync). */
  cursor: string | null;
  lastPullAt: string | null;
  lastFlushAt: string | null;
  firstDoseCelebrated: boolean;
  /** Changes the server refused (they left the outbox), since the user last cleared the notice. */
  rejectedCount: number;
  /** Why the latest one was refused (the server's words, for support). */
  lastRejectReason: string | null;
  /** "kind:id" of the latest refused records, oldest first (at most MAX_REJECTED_IDS). */
  rejectedIds: string[];
}

export const MAX_REJECTED_IDS = 50;

export const DEFAULT_META: TrackerMeta = {
  cursor: null,
  lastPullAt: null,
  lastFlushAt: null,
  firstDoseCelebrated: false,
  rejectedCount: 0,
  lastRejectReason: null,
  rejectedIds: [],
};

export interface TrackerData {
  protocols: Protocol[];
  doses: DoseLog[];
  skips: SkipLog[];
  vials: Vial[];
  checkins: CheckIn[];
  settings: TrackerSettings;
}

export const EMPTY_DATA: TrackerData = {
  protocols: [],
  doses: [],
  skips: [],
  vials: [],
  checkins: [],
  settings: DEFAULT_SETTINGS,
};

/** The six protocol colours offered in setup (dot + accents). */
export const PROTOCOL_COLORS = ["#7C3AED", "#EC4899", "#0EA5E9", "#16A34A", "#F59E0B", "#E11D48"] as const;

export const LB_PER_KG = 2.2046226218;
export const KG_PER_LB = 0.45359237;

/** Not deleted. */
export function isLive<T extends Synced>(record: T): boolean {
  return record.deletedAt === null;
}
