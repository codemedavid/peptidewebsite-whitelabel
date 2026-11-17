// Peptide Tracker sync — the PURE half (docs/mobile-admin/TRACKER.md §5).
//
// The phone is the source of truth. Each record is pushed whole, validated here
// per kind, and stored in one generic table (TrackerRecord). Last write wins on
// the record's own `updatedAt` (the client clock); deletes are tombstones.
//
// The shapes mirror the app's features/tracker/lib/types.ts (a port of
// MamaMicaGlow lib/tracker/types.ts). Only the essentials are checked — ids,
// required fields, types and sane bounds — and every object is .passthrough(),
// so a newer app build that adds a field is never refused by an older server.
// Open-ended labels (route, site, syringe, skip reason) are bounded tokens, not
// enums, for the same reason; the units that drive arithmetic are enums.
//
// No Prisma, no Next: scripts/test-tracker-records.ts runs this under plain Node.

import { z } from "zod";
import type { TrackerRecordKind, TrackerSyncRecord } from "@/lib/mobile/contract";
import { TRACKER_SERVER_CAPS as CAPS } from "./caps";

export { TRACKER_SERVER_CAPS } from "./caps";

export const TRACKER_KINDS: readonly TrackerRecordKind[] = ["protocol", "dose", "skip", "vial", "checkin", "settings"];

/** Serialized `data`, per record. */
export const MAX_RECORD_BYTES = 16 * 1024;
/** Records per POST /tracker/sync. */
export const MAX_PUSH_RECORDS = 500;
/** Live (non-tombstone) records per customer. */
export const MAX_LIVE_RECORDS = 20_000;
/** ALL rows per customer, live + tombstones: a phone can't grow the table without bound with deletes. */
export const MAX_TOTAL_RECORDS = 25_000;
/** POST /tracker/sync body, checked before it is parsed (500 records × 16 KB would be ~8 MB). */
export const MAX_SYNC_BODY_BYTES = 2 * 1024 * 1024;
/** Tombstones older than this are purged (the app forgets its own after 60 days). */
export const TOMBSTONE_RETENTION_DAYS = 90;
/** Old tombstones removed per sync, at most (one bounded DELETE). */
export const TOMBSTONE_PURGE_BATCH = 500;
/** The refusal reason when the customer's row cap is reached. */
export const STORAGE_FULL = "storage_full";

/** Tombstones deleted before this can be purged. */
export function tombstoneCutoff(now: Date): Date {
  return new Date(now.getTime() - TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}
/** Pulled records per sync response. */
export const PULL_PAGE_SIZE = 500;
/** A client clock this far ahead would win every merge for good — refuse it. */
export const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

const MAX_ID = CAPS.id;
const MAX_CURSOR = 512;
const ID_RE = /^[A-Za-z0-9_.:-]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TOKEN_RE = new RegExp(`^[a-z0-9_]{1,${CAPS.token}}$`, "i");
/** Before this the record can't be real data (and Date(0)-style defaults are fine for settings). */
const MIN_TIME = Date.UTC(1970, 0, 1);

// ── Field schemas ────────────────────────────────────────────────────────────

const isoString = z.string().max(40).refine((s) => ISO_RE.test(s) && Number.isFinite(Date.parse(s)), "not an ISO date-time");

function isRealDay(s: string): boolean {
  const m = YMD_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

const ymd = z.string().max(10).refine(isRealDay, "not a YYYY-MM-DD date");
const hhmm = z.string().regex(HHMM_RE, "not an HH:MM time");
const token = z.string().regex(TOKEN_RE, "not a short label");
const refId = z.string().min(1).max(MAX_ID);
const text = (max: number) => z.string().max(max);
const amount = (max: number) => z.number().finite().min(0).max(max);
const note = text(CAPS.note).nullable();
/** "YYYY-MM-DD" or a full ISO stamp — the app keys scheduled slots either way. */
const dayOrStamp = z.string().min(1).max(40);

const doseUnit = z.enum(["mcg", "mg", "iu", "caps", "ml", "units"]);
const vialUnit = z.enum(["mg", "mcg", "iu"]);
const scale = z.number().int().min(1).max(5).nullable();

const dose = z.object({ value: amount(1_000_000), unit: doseUnit }).passthrough();
const mix = z
  .object({ vialAmount: z.number().finite().positive().max(1_000_000), vialUnit, waterMl: amount(CAPS.waterMl) })
  .passthrough();
const schedule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily") }).passthrough(),
  z.object({ kind: z.literal("weekdays"), days: z.array(z.number().int().min(0).max(6)).max(7) }).passthrough(),
  z.object({ kind: z.literal("interval"), everyDays: z.number().int().min(1).max(CAPS.days) }).passthrough(),
  z.object({ kind: z.literal("asNeeded") }).passthrough(),
]);
const cycle = z.object({ onDays: z.number().int().min(1).max(CAPS.days), offDays: z.number().int().min(0).max(CAPS.days) }).passthrough();
const times = z.array(hhmm).max(CAPS.times);

const synced = {
  id: refId,
  createdAt: isoString,
  updatedAt: isoString,
  deletedAt: isoString.nullable(),
};

const protocolSchema = z
  .object({
    ...synced,
    name: text(CAPS.name).min(1),
    catalogId: refId.nullable(),
    category: text(CAPS.category).nullable(),
    color: text(CAPS.color),
    route: token,
    dose,
    mix: mix.nullable(),
    syringe: token.nullable(),
    schedule,
    cycle: cycle.nullable(),
    times,
    startDate: ymd,
    endDate: ymd.nullable(),
    status: z.enum(["active", "paused", "archived"]),
    reminders: z.boolean(),
    rotateSites: z.boolean(),
    checkDose: z.boolean(),
    pausedFrom: ymd.nullable().optional(),
    history: z
      .array(z.object({ until: ymd, schedule, cycle: cycle.nullable(), times, paused: z.boolean() }).passthrough())
      .max(CAPS.history)
      .optional(),
  })
  .passthrough();

const doseSchema = z
  .object({
    ...synced,
    protocolId: refId.nullable(),
    name: text(CAPS.name).min(1),
    takenAt: isoString,
    scheduledFor: dayOrStamp.nullable(),
    dose,
    volumeMl: amount(CAPS.waterMl).nullable(),
    units: amount(10_000).nullable(),
    route: token,
    site: token.nullable(),
    vialId: refId.nullable(),
    note,
  })
  .passthrough();

const skipSchema = z
  .object({ ...synced, protocolId: refId, scheduledFor: dayOrStamp, reason: token, note })
  .passthrough();

const vialSchema = z
  .object({
    ...synced,
    protocolId: refId,
    amount: z.number().finite().positive().max(1_000_000),
    unit: vialUnit,
    waterMl: amount(CAPS.waterMl).nullable(),
    mixedOn: dayOrStamp.nullable(),
    lot: text(CAPS.lot).nullable(),
    status: z.enum(["active", "finished"]),
  })
  .passthrough();

const checkinSchema = z
  .object({
    ...synced,
    date: ymd,
    energy: scale,
    mood: scale,
    appetite: scale,
    sleep: scale,
    effects: z.array(text(CAPS.effect)).max(CAPS.effects),
    note,
    weightKg: amount(CAPS.weightKg).nullable(),
  })
  .passthrough();

/** One settings record per customer; it carries no id/createdAt of its own. */
const settingsSchema = z
  .object({
    weightUnit: z.enum(["kg", "lb"]),
    defaultSyringe: token,
    doseReminders: z.boolean(),
    refillReminders: z.boolean(),
    checkinReminder: z.boolean(),
    checkinTime: hhmm,
    showNamesInNotifications: z.boolean(),
    suggestSites: z.boolean(),
    updatedAt: isoString,
  })
  .passthrough();

const SCHEMAS: Record<TrackerRecordKind, z.ZodTypeAny> = {
  protocol: protocolSchema,
  dose: doseSchema,
  skip: skipSchema,
  vial: vialSchema,
  checkin: checkinSchema,
  settings: settingsSchema,
};

// ── Records ──────────────────────────────────────────────────────────────────

/** A pushed record that passed validation, ready to merge. */
export type CleanRecord = {
  kind: TrackerRecordKind;
  localId: string;
  data: Record<string, unknown>;
  updatedAt: Date;
  deletedAt: Date | null;
};

/** What the table holds for one record (rowId = the server's own id). */
export type StoredRecord = CleanRecord & { rowId: string; createdAt: Date };

export type Rejection = { kind: TrackerRecordKind; id: string; reason: string };

export type ValidateResult = { ok: true; record: CleanRecord } | ({ ok: false } & Rejection);

const isKind = (v: unknown): v is TrackerRecordKind => typeof v === "string" && (TRACKER_KINDS as readonly string[]).includes(v);
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  const where = issue?.path.length ? issue.path.join(".") : "data";
  return `${where}: ${issue?.message ?? "invalid"}`.slice(0, 200);
}

/** A time the server accepts as a client clock: ISO, after 1970, not a day ahead. */
function clientTime(v: unknown, now: Date): { ok: true; date: Date } | { ok: false; reason: string } {
  const parsed = isoString.safeParse(v);
  if (!parsed.success) return { ok: false, reason: "not an ISO date-time" };
  const date = new Date(parsed.data);
  if (date.getTime() < MIN_TIME) return { ok: false, reason: "date is too far in the past" };
  if (date.getTime() > now.getTime() + MAX_FUTURE_MS) return { ok: false, reason: "date is in the future (check the phone's clock)" };
  return { ok: true, date };
}

/** Validate one pushed record. Never throws. */
export function validatePushRecord(raw: unknown, now: Date = new Date()): ValidateResult {
  if (!isPlainObject(raw)) return { ok: false, kind: "dose", id: "", reason: "not a record" };
  const id = typeof raw.id === "string" ? raw.id.slice(0, MAX_ID * 2) : "";
  const echoKind = (typeof raw.kind === "string" ? raw.kind.slice(0, 32) : "") as TrackerRecordKind;
  const refuse = (reason: string): ValidateResult => ({ ok: false, kind: echoKind, id, reason });

  if (!isKind(raw.kind)) return refuse("unknown kind");
  const kind = raw.kind;
  if (!id || id.length > MAX_ID || !ID_RE.test(id)) return refuse("bad id");

  const updated = clientTime(raw.updatedAt, now);
  if (!updated.ok) return refuse(`updatedAt: ${updated.reason}`);
  let deletedAt: Date | null = null;
  if (raw.deletedAt !== null && raw.deletedAt !== undefined) {
    const deleted = clientTime(raw.deletedAt, now);
    if (!deleted.ok) return refuse(`deletedAt: ${deleted.reason}`);
    deletedAt = deleted.date;
  }

  // A tombstone only has to identify itself: it may carry the last full copy,
  // a stub, or nothing at all — and is STORED as just { id } (no health data
  // kept for something the customer deleted).
  const data = raw.data === null || raw.data === undefined ? (deletedAt ? {} : raw.data) : raw.data;
  if (!isPlainObject(data)) return refuse("data must be an object");
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(data), "utf8");
  } catch {
    return refuse("data is not JSON");
  }
  if (size > MAX_RECORD_BYTES) return refuse(`too large (max ${MAX_RECORD_BYTES / 1024} KB)`);
  if (data.id !== undefined && data.id !== id) return refuse("data.id does not match the record id");

  if (!deletedAt) {
    if (kind !== "settings" && data.id !== id) return refuse("data.id does not match the record id");
    const parsed = SCHEMAS[kind].safeParse(data);
    if (!parsed.success) return refuse(firstIssue(parsed.error));
  }
  return { ok: true, record: { kind, localId: id, data: deletedAt ? { id } : data, updatedAt: updated.date, deletedAt } };
}

// ── Request ──────────────────────────────────────────────────────────────────

export type ParsedSyncRequest = { ok: true; cursor: string | null; push: unknown[] } | { ok: false; message: string };

export function parseSyncRequest(body: unknown): ParsedSyncRequest {
  if (!isPlainObject(body)) return { ok: false, message: "The sync request couldn't be read." };
  const cursor = body.cursor ?? null;
  if (cursor !== null && typeof cursor !== "string") return { ok: false, message: "Bad sync cursor." };
  const push = body.push ?? [];
  if (!Array.isArray(push)) return { ok: false, message: "The sync request couldn't be read." };
  if (push.length > MAX_PUSH_RECORDS) {
    return { ok: false, message: `Send at most ${MAX_PUSH_RECORDS} changes per sync.` };
  }
  return { ok: true, cursor, push };
}

// ── Merge ────────────────────────────────────────────────────────────────────

type Stamped = { updatedAt: Date; deletedAt: Date | null };

/**
 * Last write wins on the client's `updatedAt`. A tie keeps what is stored (so a
 * retried push is a no-op). A tombstone is just a newer write: it wins when it
 * is newer, and an older live copy can never bring it back.
 */
export function mergeDecision(existing: Stamped | null, incoming: Stamped): "insert" | "update" | "skip" {
  if (!existing) return "insert";
  return incoming.updatedAt.getTime() > existing.updatedAt.getTime() ? "update" : "skip";
}

export type PushPlan = {
  inserts: CleanRecord[];
  /** Winners over a stored row — written back under the same rowId. */
  replaces: (CleanRecord & { rowId: string; createdAt: Date })[];
  /** Pushed copies that lost to a NEWER stored copy, which goes back to the phone. */
  losers: StoredRecord[];
  rejected: Rejection[];
};

export const recordKey = (r: { kind: string; localId: string }): string => `${r.kind}:${r.localId}`;

/**
 * Decide every pushed record against what is stored. `liveCount` is the
 * customer's current live total; a write that would push it past `cap` is
 * refused (edits and deletes never are — only records that add a live one).
 * `total` caps ALL rows (live + tombstones): a write that adds a row past it
 * is refused as STORAGE_FULL (writes over a stored row add none and never are).
 */
export function planPush(
  records: readonly CleanRecord[],
  existing: ReadonlyMap<string, StoredRecord>,
  liveCount: number,
  cap: number,
  total: { count: number; cap: number } = { count: 0, cap: Number.POSITIVE_INFINITY },
): PushPlan {
  // The same record twice in one push: only the newest copy counts.
  const newest = new Map<string, CleanRecord>();
  for (const r of records) {
    const prev = newest.get(recordKey(r));
    if (!prev || r.updatedAt.getTime() > prev.updatedAt.getTime()) newest.set(recordKey(r), r);
  }

  const plan: PushPlan = { inserts: [], replaces: [], losers: [], rejected: [] };
  let live = liveCount;
  let rows = total.count;
  for (const r of newest.values()) {
    const stored = existing.get(recordKey(r)) ?? null;
    const decision = mergeDecision(stored, r);
    if (decision === "skip") {
      // A tie is a retry of what is stored — nothing to send back.
      if (stored!.updatedAt.getTime() > r.updatedAt.getTime()) plan.losers.push(stored!);
      continue;
    }
    if (!stored && rows + 1 > total.cap) {
      plan.rejected.push({ kind: r.kind, id: r.localId, reason: STORAGE_FULL });
      continue;
    }
    const delta = (r.deletedAt ? 0 : 1) - (stored && !stored.deletedAt ? 1 : 0);
    if (delta > 0 && live + delta > cap) {
      plan.rejected.push({ kind: r.kind, id: r.localId, reason: `tracker record limit reached (${cap})` });
      continue;
    }
    live += delta;
    if (!stored) rows += 1;
    if (stored) plan.replaces.push({ ...r, rowId: stored.rowId, createdAt: stored.createdAt });
    else plan.inserts.push(r);
  }
  return plan;
}

// ── Cursor ───────────────────────────────────────────────────────────────────

/** Position in the customer's change feed: (server syncedAt, row id). */
export type SyncCursor = { syncedAt: Date; id: string };

export function encodeCursor(c: SyncCursor): string {
  return Buffer.from(JSON.stringify({ t: c.syncedAt.toISOString(), i: c.id }), "utf8").toString("base64url");
}

/** Null for absent or unreadable — the caller then pulls from the start (safe: merges are idempotent). */
export function decodeCursor(raw: string | null | undefined): SyncCursor | null {
  if (!raw || raw.length > MAX_CURSOR) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!isPlainObject(parsed) || typeof parsed.t !== "string" || typeof parsed.i !== "string") return null;
    if (!ISO_RE.test(parsed.t) || parsed.i.length > MAX_ID) return null;
    const syncedAt = new Date(parsed.t);
    return Number.isFinite(syncedAt.getTime()) ? { syncedAt, id: parsed.i } : null;
  } catch {
    return null;
  }
}

/** The start of the feed, for a customer with nothing stored yet. */
export const START_CURSOR: SyncCursor = { syncedAt: new Date(0), id: "" };

// ── Wire ─────────────────────────────────────────────────────────────────────

export function toWireRecord(r: CleanRecord): TrackerSyncRecord {
  return {
    kind: r.kind,
    id: r.localId,
    data: r.data,
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  };
}
