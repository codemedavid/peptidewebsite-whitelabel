/**
 * Sync glue for POST /tracker/sync (replaces MamaMicaGlow's cloud-map.ts):
 * records ⇄ the contract's TrackerSyncRecord envelope, a shape check on what
 * the server sends back, and the last-write-wins merge. Pure, so the rules are
 * testable (mobile/scripts/test-tracker-merge.ts).
 *
 * LWW: the newer `updatedAt` wins; on a tie a tombstone wins. A record with a
 * local change still waiting in the outbox is never overwritten — that change
 * goes up next and the server answers with the winner.
 */
import { isDayKey } from "./ids";
import {
  DEFAULT_SETTINGS,
  SETTINGS_ID,
  type CheckIn,
  type DoseLog,
  type OutboxTable,
  type Protocol,
  type SkipLog,
  type Synced,
  type TrackerData,
  type TrackerSettings,
  type Vial,
} from "./types";

/** The contract's TrackerSyncRecord, structurally (lib stays free of app imports). */
export interface SyncRecord {
  kind: OutboxTable;
  id: string;
  data: unknown;
  updatedAt: string;
  deletedAt: string | null;
}

export type ListKind = Exclude<OutboxTable, "settings">;

export const LIST_OF: Record<ListKind, "protocols" | "doses" | "skips" | "vials" | "checkins"> = {
  protocol: "protocols",
  dose: "doses",
  skip: "skips",
  vial: "vials",
  checkin: "checkins",
};

const KINDS: readonly OutboxTable[] = ["protocol", "dose", "skip", "vial", "checkin", "settings"];

export function isRecordKind(value: unknown): value is OutboxTable {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value);
}

/** The envelope for a local record (deleted ones go up as tombstones). */
export function toSyncRecord(kind: ListKind, record: Synced): SyncRecord {
  return { kind, id: record.id, data: record, updatedAt: record.updatedAt, deletedAt: record.deletedAt };
}

export function settingsRecord(settings: TrackerSettings): SyncRecord {
  return { kind: "settings", id: SETTINGS_ID, data: settings, updatedAt: settings.updatedAt, deletedAt: null };
}

/** A delete whose record is gone from the phone (tombstone pruned): the envelope alone carries it. */
export function tombstoneRecord(kind: ListKind, id: string, at: string): SyncRecord {
  return { kind, id, data: { id }, updatedAt: at, deletedAt: at };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isIso = (v: unknown): v is string => isStr(v) && Number.isFinite(Date.parse(v));
const isDose = (v: unknown) => isObj(v) && isNum(v.value) && isStr(v.unit);

const SHAPE: Record<ListKind, (d: Obj) => boolean> = {
  protocol: (d) =>
    isStr(d.name) && isDose(d.dose) && isObj(d.schedule) && isStr(d.schedule.kind) && Array.isArray(d.times) && isDayKey(d.startDate) && isStr(d.status) && isStr(d.route),
  dose: (d) => isStr(d.name) && isIso(d.takenAt) && isDose(d.dose) && isStr(d.route),
  skip: (d) => isStr(d.protocolId) && isIso(d.scheduledFor) && isStr(d.reason),
  vial: (d) => isStr(d.protocolId) && isNum(d.amount) && isStr(d.unit) && isStr(d.status),
  checkin: (d) => isDayKey(d.date) && Array.isArray(d.effects),
};

export type Parsed = { kind: ListKind; record: Synced } | { kind: "settings"; settings: TrackerSettings };

/**
 * A pulled envelope as a local record, or null when it doesn't look like one
 * (never trusted blindly). The envelope's id and timestamps win over `data`'s.
 * A tombstone only needs its envelope.
 */
export function parseRemote(rec: unknown): Parsed | null {
  if (!isObj(rec) || !isRecordKind(rec.kind) || !isStr(rec.id) || !rec.id || !isIso(rec.updatedAt)) return null;
  const deletedAt = rec.deletedAt === null || rec.deletedAt === undefined ? null : isIso(rec.deletedAt) ? rec.deletedAt : undefined;
  if (deletedAt === undefined) return null;
  const data = isObj(rec.data) ? rec.data : {};
  if (rec.kind === "settings") {
    return { kind: "settings", settings: { ...DEFAULT_SETTINGS, ...(data as Partial<TrackerSettings>), updatedAt: rec.updatedAt } };
  }
  if (!deletedAt && !SHAPE[rec.kind](data)) return null;
  const createdAt = isIso(data.createdAt) ? data.createdAt : rec.updatedAt;
  return { kind: rec.kind, record: { ...data, id: rec.id, createdAt, updatedAt: rec.updatedAt, deletedAt } as Synced };
}

/** Whether `remote` beats `local` under LWW (tie → the tombstone). */
export function remoteWins(local: Synced, remote: Synced): boolean {
  const l = Date.parse(local.updatedAt);
  const r = Date.parse(remote.updatedAt);
  if (r !== l) return r > l;
  return !!remote.deletedAt && !local.deletedAt;
}

/**
 * Merges pulled records into a local list. `pending` = ids with a local change
 * still in the outbox (kept as they are). A tombstone for a record this phone
 * never had is ignored.
 */
export function mergeRecords<T extends Synced>(local: readonly T[], remote: readonly T[], pending: ReadonlySet<string>): T[] {
  if (remote.length === 0) return [...local];
  const byId = new Map(local.map((r) => [r.id, r] as const));
  const replaced = new Map<string, T>();
  const added = new Map<string, T>();
  for (const r of remote) {
    const mine = replaced.get(r.id) ?? byId.get(r.id);
    if (!mine) {
      const seen = added.get(r.id);
      if (seen ? remoteWins(seen, r) : !r.deletedAt) added.set(r.id, r);
      continue;
    }
    if (pending.has(r.id)) continue;
    if (remoteWins(mine, r)) replaced.set(r.id, r);
  }
  return [...local.map((r) => replaced.get(r.id) ?? r), ...added.values()];
}

export function mergeSettings(local: TrackerSettings, remote: TrackerSettings | null, isPending: boolean): TrackerSettings {
  if (!remote || isPending) return local;
  return Date.parse(remote.updatedAt) > Date.parse(local.updatedAt) ? { ...local, ...remote } : local;
}

/** Applies a page of pulled envelopes to the local data. Returns the merged lists (unchanged ones as they were). */
export function applyPulled(data: TrackerData, pulled: readonly unknown[], pending: ReadonlySet<string>): { data: TrackerData; skipped: number } {
  const byKind: Record<ListKind, Synced[]> = { protocol: [], dose: [], skip: [], vial: [], checkin: [] };
  let settings: TrackerSettings | null = null;
  let skipped = 0;
  for (const raw of pulled) {
    const parsed = parseRemote(raw);
    if (!parsed) {
      skipped += 1;
      continue;
    }
    if (parsed.kind === "settings") {
      if (!settings || Date.parse(parsed.settings.updatedAt) > Date.parse(settings.updatedAt)) settings = parsed.settings;
    } else byKind[parsed.kind].push(parsed.record);
  }
  const pendingOf = (kind: OutboxTable) => new Set([...pending].filter((k) => k.startsWith(`${kind}:`)).map((k) => k.slice(kind.length + 1)));
  const next: TrackerData = {
    protocols: mergeRecords<Protocol>(data.protocols, byKind.protocol as Protocol[], pendingOf("protocol")),
    doses: mergeRecords<DoseLog>(data.doses, byKind.dose as DoseLog[], pendingOf("dose")),
    skips: mergeRecords<SkipLog>(data.skips, byKind.skip as SkipLog[], pendingOf("skip")),
    vials: mergeRecords<Vial>(data.vials, byKind.vial as Vial[], pendingOf("vial")),
    checkins: mergeRecords<CheckIn>(data.checkins, byKind.checkin as CheckIn[], pendingOf("checkin")),
    settings: mergeSettings(data.settings, settings, pending.has(`settings:${SETTINGS_ID}`)),
  };
  return { data: next, skipped };
}
