/**
 * The tracker's phone store, ported from MamaMicaGlow services/tracker/store.ts:
 * kept in memory for React (useSyncExternalStore) and written back to
 * AsyncStorage. Every action returns new data (nothing is edited in place),
 * stamps updatedAt, queues an outbox entry for POST /tracker/sync, and tells
 * listeners.
 *
 * SCOPED PER ACCOUNT: keys are `pepworld.tracker.<id>.<part>`, where id is a
 * short hash (lib/scope-key.ts) of the session's store + mode + account
 * (useSignedIn().scope) — the email never sits in a key name. Keys written
 * under the raw scope by older builds move over once, on first load. Switching
 * scope (sign-in, account switch) drops the in-memory copy at once and loads
 * the new account's own keys, so one account's tracker never shows (or syncs)
 * under another. Sign-out calls setTrackerScope(null). Each account's copy
 * stays on the phone under its own keys, so unsynced changes are never lost;
 * Tracker settings can remove synced copies from the phone (removeTrackerFromPhone).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { dayKey, newId } from "./lib/ids";
import { legacyGroupOf, scopeKeyId } from "./lib/scope-key";
import type { DoseDraft } from "./lib/quick-log";
import { withScheduleHistory } from "./lib/schedule";
import {
  DEFAULT_META,
  DEFAULT_SETTINGS,
  EMPTY_DATA,
  SETTINGS_ID,
  type CheckIn,
  type DoseLog,
  type OutboxOp,
  type OutboxTable,
  type Protocol,
  type SkipLog,
  type Synced,
  type TrackerData,
  type TrackerMeta,
  type TrackerSettings,
  type Vial,
} from "./lib/types";
import { activeVial, vialMix } from "./lib/vials";
import { deviceWeightUnit } from "./lib/weight";

const KEY_PREFIX = "pepworld.tracker.";

/** The parts of the store that are saved, one AsyncStorage key each. */
type Part = "protocols" | "doses" | "skips" | "vials" | "checkins" | "settings" | "outbox" | "meta";
const PARTS: readonly Part[] = ["protocols", "doses", "skips", "vials", "checkins", "settings", "outbox", "meta"];
/** Raw copies of keys that couldn't be read, kept before they are written again. */
const CORRUPT_BACKUP = "corruptBackup";
const READ_TRIES = 3;
const READ_RETRY_MS = 250;
const RELOAD_MAX_MS = 30_000;

/** Deleted records are remembered this long so a delete never comes back on pull. */
export const TOMBSTONE_DAYS = 60;

/** The AsyncStorage key for one part of one account's tracker (the scope hashed: no email in key names). */
export function trackerKey(scope: string, part: string): string {
  return `${KEY_PREFIX}${scopeKeyId(scope)}.${part}`;
}

/** Where builds before the hashed keys kept the same part (raw scope, email included). */
function legacyKey(scope: string, part: string): string {
  return `${KEY_PREFIX}${scope}.${part}`;
}

const ALL_PARTS: readonly string[] = [...PARTS, CORRUPT_BACKUP];

/**
 * Moves an account's keys from the raw-scope names to the hashed ones, once.
 * A part already under its hashed name is never overwritten; the legacy keys
 * are removed only after the copy succeeded (a failure retries next load).
 */
async function migrateLegacyKeys(scope: string): Promise<void> {
  const legacy = await AsyncStorage.multiGet(ALL_PARTS.map((part) => legacyKey(scope, part)));
  const found = ALL_PARTS.filter((_, i) => legacy[i]?.[1] !== null && legacy[i]?.[1] !== undefined);
  if (found.length === 0) return;
  const current = await AsyncStorage.multiGet(found.map((part) => trackerKey(scope, part)));
  const copy = found.filter((_, i) => current[i]?.[1] === null || current[i]?.[1] === undefined);
  if (copy.length > 0) {
    await AsyncStorage.multiSet(copy.map((part) => [trackerKey(scope, part), legacy[ALL_PARTS.indexOf(part)][1] as string]));
  }
  await AsyncStorage.multiRemove(found.map((part) => legacyKey(scope, part)));
}

export interface TrackerState {
  /** The account this state belongs to (null = signed out / not bound yet). */
  scope: string | null;
  isLoaded: boolean;
  data: TrackerData;
  outbox: OutboxOp[];
  meta: TrackerMeta;
  /** The last write to the phone failed (storage full / blocked). */
  hasSaveError: boolean;
  /** The phone copy couldn't be read yet (retrying); nothing is written until it is. */
  hasLoadError: boolean;
}

type ListKey = "protocols" | "doses" | "skips" | "vials" | "checkins";
type Change = { table: OutboxTable; op: "upsert" | "delete"; id: string };

const LISTS: readonly ListKey[] = ["protocols", "doses", "skips", "vials", "checkins"];

function initial(scope: string | null): TrackerState {
  return { scope, isLoaded: false, data: EMPTY_DATA, outbox: [], meta: DEFAULT_META, hasSaveError: false, hasLoadError: false };
}

let state: TrackerState = initial(null);
const listeners = new Set<() => void>();
const writeHooks = new Set<() => void>();
const scopeHooks = new Set<(scope: string | null) => void>();
let loading: Promise<void> | null = null;
let writeChain: Promise<void> = Promise.resolve();
/** Parts changed since their last successful write. */
let unsaved: ReadonlySet<Part> = new Set();
/** Parts whose stored copy couldn't be read (and couldn't be backed up): never written this session. */
let blocked: ReadonlySet<Part> = new Set();
/** Meta changes made before the phone copy was read, re-applied on top of it. */
let earlyMeta: Partial<TrackerMeta> = {};
/** Bumped on every scope change, so a read or write already running for the old account is ignored. */
let generation = 0;

export const trackerStore = {
  getSnapshot: (): TrackerState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Sync and reminders hook in here (kept out to avoid import cycles). Returns an unsubscribe. */
export function onTrackerWrite(fn: () => void): () => void {
  writeHooks.add(fn);
  return () => writeHooks.delete(fn);
}

/** Called after every scope change (sync resets, reminders re-plan). Returns an unsubscribe. */
export function onTrackerScopeChange(fn: (scope: string | null) => void): () => void {
  scopeHooks.add(fn);
  return () => scopeHooks.delete(fn);
}

export function currentTrackerScope(): string | null {
  return state.scope;
}

/** The store's generation: async work captures it and drops its result when it changed. */
export function trackerGeneration(): number {
  return generation;
}

function setState(next: TrackerState): void {
  state = next;
  listeners.forEach((l) => l());
}

// ── Scope ────────────────────────────────────────────────────────────────

/**
 * Binds the store to an account (null on sign-out). The old account's unsaved
 * parts are written to ITS keys first; then memory is emptied and the new
 * account's keys are read. Same scope = no-op.
 */
export function setTrackerScope(next: string | null): void {
  if (next === state.scope) return;
  const old = state;
  const pending = [...unsaved].filter((part) => !blocked.has(part));
  if (old.scope && old.isLoaded && pending.length > 0) {
    const oldScope = old.scope;
    writeChain = writeChain
      .then(() => AsyncStorage.multiSet(pending.map((part) => [trackerKey(oldScope, part), JSON.stringify(partValue(old, part))])))
      .catch(() => undefined);
  }
  generation += 1;
  unsaved = new Set();
  blocked = new Set();
  earlyMeta = {};
  loading = null;
  setState(initial(next));
  scopeHooks.forEach((fn) => fn(next));
  if (next) void ensureTrackerLoaded();
}

// ── Loading ──────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The stored list, or null when it can't be read (bad JSON / not a list). */
function parseList<T extends Synced>(raw: string | null): T[] | null {
  if (raw === null || raw === undefined) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v.filter((r) => typeof r === "object" && r !== null && typeof (r as Synced).id === "string") as T[]) : null;
  } catch {
    return null;
  }
}

function parseObject<T extends object>(raw: string | null, fallback: T): T | null {
  if (raw === null || raw === undefined) return fallback;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? { ...fallback, ...(v as Partial<T>) } : null;
  } catch {
    return null;
  }
}

function parseOutbox(raw: string | null): OutboxOp[] | null {
  if (raw === null || raw === undefined) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    return v.filter(
      (o): o is OutboxOp =>
        typeof o === "object" && o !== null && typeof (o as OutboxOp).id === "string" && typeof (o as OutboxOp).recordId === "string" && typeof (o as OutboxOp).table === "string",
    );
  } catch {
    return null;
  }
}

function prune<T extends Synced>(list: T[], pending: Set<string>, now: number): T[] {
  const cutoff = now - TOMBSTONE_DAYS * 86_400_000;
  return list.filter((r) => !r.deletedAt || Date.parse(r.deletedAt) > cutoff || pending.has(r.id));
}

/** Every stored key, tried a few times; null when storage itself can't be read. */
async function readRaw(scope: string): Promise<Record<string, string | null> | null> {
  // Best effort: an older build's keys come over first (they stay put, and are retried next load, if this fails).
  await migrateLegacyKeys(scope).catch(() => undefined);
  const keys = PARTS.map((part) => trackerKey(scope, part));
  for (let i = 0; i < READ_TRIES; i += 1) {
    try {
      const pairs = await AsyncStorage.multiGet(keys);
      return Object.fromEntries(pairs.map(([key, value]) => [key.slice(trackerKey(scope, "").length), value]));
    } catch {
      if (i < READ_TRIES - 1) await delay(READ_RETRY_MS * (i + 1));
    }
  }
  return null;
}

/** Keeps a copy of unreadable keys before they get written again. Returns the parts it couldn't save. */
async function backUpUnreadable(scope: string, raw: Record<string, string | null>, parts: Part[]): Promise<Part[]> {
  if (parts.length === 0) return [];
  const key = trackerKey(scope, CORRUPT_BACKUP);
  try {
    const old = await AsyncStorage.getItem(key);
    let kept: unknown[] = [];
    try {
      const v: unknown = old ? JSON.parse(old) : [];
      kept = Array.isArray(v) ? v : [{ key, raw: old }];
    } catch {
      kept = [{ key, raw: old }];
    }
    const at = new Date().toISOString();
    const added = parts.map((part) => ({ key: trackerKey(scope, part), at, raw: raw[part] }));
    await AsyncStorage.setItem(key, JSON.stringify([...kept, ...added]));
    return [];
  } catch {
    return parts;
  }
}

/** A fresh install's settings: the weight unit follows the device's region (lb in the US, Liberia and Myanmar). */
function freshSettings(): TrackerSettings {
  return { ...DEFAULT_SETTINGS, weightUnit: deviceWeightUnit() };
}

/** The stored tracker, or null when storage can't be read at all. */
async function readAll(scope: string): Promise<{ state: TrackerState; blocked: Part[] } | null> {
  const got = await readRaw(scope);
  if (!got) return null;
  const lists = {
    protocols: parseList<Protocol>(got.protocols),
    doses: parseList<DoseLog>(got.doses),
    skips: parseList<SkipLog>(got.skips),
    vials: parseList<Vial>(got.vials),
    checkins: parseList<CheckIn>(got.checkins),
  };
  const outbox = parseOutbox(got.outbox);
  const meta = parseObject(got.meta, DEFAULT_META);
  const settings = got.settings === null || got.settings === undefined ? freshSettings() : parseObject(got.settings, DEFAULT_SETTINGS);
  const parsed: Record<Part, unknown> = { ...lists, outbox, meta, settings };
  const unreadable = PARTS.filter((part) => parsed[part] === null);

  const pending = new Set((outbox ?? []).map((o) => o.recordId));
  const now = Date.now();
  const list = <T extends Synced>(l: T[] | null) => prune(l ?? [], pending, now);
  return {
    blocked: await backUpUnreadable(scope, got, unreadable),
    state: {
      scope,
      isLoaded: true,
      hasSaveError: false,
      hasLoadError: false,
      outbox: outbox ?? [],
      meta: meta ?? DEFAULT_META,
      data: {
        protocols: list(lists.protocols),
        doses: list(lists.doses),
        skips: list(lists.skips),
        vials: list(lists.vials),
        checkins: list(lists.checkins),
        settings: settings ?? freshSettings(),
      },
    },
  };
}

/** Changes made in memory before the read finished go on top of what was stored. */
function withEarlyChanges(disk: TrackerState, mem: TrackerState, changed: ReadonlySet<Part>): TrackerState {
  const data = { ...disk.data };
  for (const key of LISTS) {
    if (!changed.has(key)) continue;
    const mine = mem.data[key] as Synced[];
    const ids = new Set(mine.map((r) => r.id));
    (data as Record<string, unknown>)[key] = [...(disk.data[key] as Synced[]).filter((r) => !ids.has(r.id)), ...mine];
  }
  if (changed.has("settings")) data.settings = mem.data.settings;
  const touched = new Set(mem.outbox.map((o) => `${o.table}:${o.recordId}`));
  const outbox = changed.has("outbox") ? [...disk.outbox.filter((o) => !touched.has(`${o.table}:${o.recordId}`)), ...mem.outbox] : disk.outbox;
  return { ...disk, data, outbox, meta: { ...disk.meta, ...earlyMeta } };
}

/** Reads the phone copy, retrying with growing waits while storage can't be read. */
async function loadUntilRead(scope: string, gen: number): Promise<void> {
  for (let wait = 1000; ; wait = Math.min(RELOAD_MAX_MS, wait * 2)) {
    const read = await readAll(scope);
    if (gen !== generation) return;
    if (read) {
      const changed = unsaved;
      blocked = new Set(read.blocked);
      setState(withEarlyChanges(read.state, state, changed));
      earlyMeta = {};
      if (changed.size > 0) persist([...changed]);
      return;
    }
    // Not marked loaded: screens wait, and nothing overwrites what's stored.
    if (!state.hasLoadError) setState({ ...state, hasLoadError: true });
    await delay(wait);
    if (gen !== generation) return;
  }
}

/** Loads the bound account's phone copy once (later calls wait on the same load). Resolves at once when unbound. */
export function ensureTrackerLoaded(): Promise<void> {
  if (state.isLoaded || !state.scope) return Promise.resolve();
  loading ??= loadUntilRead(state.scope, generation);
  return loading;
}

// ── Writing ──────────────────────────────────────────────────────────────

function partValue(s: TrackerState, part: Part): unknown {
  if (part === "outbox") return s.outbox;
  if (part === "meta") return s.meta;
  return s.data[part];
}

/**
 * Writes the changed parts to the bound account's keys. Nothing is written
 * before the phone copy was read (it would overwrite it), nor to a key that
 * couldn't be read, nor after the scope changed (setTrackerScope wrote those).
 */
function persist(parts: readonly Part[]): void {
  unsaved = new Set([...unsaved, ...parts]);
  const gen = generation;
  writeChain = writeChain
    .then(async () => {
      const s = state;
      if (gen !== generation || !s.scope || !s.isLoaded || unsaved.size === 0) return;
      const writing = [...unsaved].filter((part) => !blocked.has(part));
      unsaved = new Set([...unsaved].filter((part) => blocked.has(part)));
      if (writing.length === 0) return;
      try {
        await AsyncStorage.multiSet(writing.map((part) => [trackerKey(s.scope as string, part), JSON.stringify(partValue(s, part))]));
        if (gen === generation && state.hasSaveError) setState({ ...state, hasSaveError: false });
      } catch {
        if (gen !== generation) return;
        // Kept in memory; the next write tries these again.
        unsaved = new Set([...unsaved, ...writing]);
        setState({ ...state, hasSaveError: true });
      }
    })
    .catch(() => undefined);
}

/** One outbox entry per record: a newer change replaces an older pending one. */
function enqueue(outbox: OutboxOp[], changes: Change[], at: string): OutboxOp[] {
  const touched = new Set(changes.map((c) => `${c.table}:${c.id}`));
  const kept = outbox.filter((o) => !touched.has(`${o.table}:${o.recordId}`));
  return [...kept, ...changes.map((c) => ({ id: newId(), table: c.table, op: c.op, recordId: c.id, at }))];
}

/** Writes are refused while signed out: there is no account to keep them under. */
function assertBound(): void {
  if (!state.scope) throw new Error("The tracker isn't bound to a signed-in account.");
}

function commit(data: Partial<TrackerData>, changes: Change[], meta?: Partial<TrackerMeta>): void {
  assertBound();
  const at = new Date().toISOString();
  setState({
    ...state,
    data: { ...state.data, ...data },
    outbox: changes.length > 0 ? enqueue(state.outbox, changes, at) : state.outbox,
    meta: meta ? { ...state.meta, ...meta } : state.meta,
  });
  if (meta && !state.isLoaded) earlyMeta = { ...earlyMeta, ...meta };
  const parts = [...(Object.keys(data) as Part[]), ...(changes.length > 0 ? (["outbox"] as const) : []), ...(meta ? (["meta"] as const) : [])];
  persist(parts);
  if (changes.length > 0) writeHooks.forEach((fn) => fn());
}

function upsertIn<T extends Synced>(list: readonly T[], record: T): T[] {
  return list.some((r) => r.id === record.id) ? list.map((r) => (r.id === record.id ? record : r)) : [...list, record];
}

function stamp<T extends Synced>(record: Omit<T, keyof Synced> & Partial<Synced>, now = new Date().toISOString()): T {
  return { ...record, id: record.id ?? newId(), createdAt: record.createdAt ?? now, updatedAt: now, deletedAt: record.deletedAt ?? null } as T;
}

function tombstone<T extends Synced>(list: readonly T[], ids: ReadonlySet<string>, now: string): T[] {
  return list.map((r) => (ids.has(r.id) && !r.deletedAt ? { ...r, deletedAt: now, updatedAt: now } : r));
}

const TABLE_OF: Record<ListKey, OutboxTable> = { protocols: "protocol", doses: "dose", skips: "skip", vials: "vial", checkins: "checkin" };

function saveRecord<K extends ListKey>(key: K, record: TrackerData[K][number]): void {
  const list = upsertIn(state.data[key] as Synced[], record as Synced);
  commit({ [key]: list } as Partial<TrackerData>, [{ table: TABLE_OF[key], op: "upsert", id: record.id }]);
}

// ── Actions ──────────────────────────────────────────────────────────────

export type ProtocolDraft = Omit<Protocol, keyof Synced> & Partial<Synced>;
export type VialDraft = Omit<Vial, keyof Synced> & Partial<Synced>;
export type SkipDraft = Omit<SkipLog, keyof Synced>;
export type CheckInDraft = Omit<CheckIn, keyof Synced>;

const sameMix = (a: Protocol["mix"], b: Protocol["mix"]) => a?.vialAmount === b?.vialAmount && a?.vialUnit === b?.vialUnit && a?.waterMl === b?.waterMl;

/**
 * Creates or updates a protocol; a new protocol with a mix also gets its first
 * vial (mixed on `firstVial.mixedOn`). The vial in use is where units come
 * from, so editing the mix updates that vial too. Pausing or a new schedule
 * keeps past days as they were (withScheduleHistory).
 */
export function saveProtocol(draft: ProtocolDraft, firstVial: { mixedOn: string } | null = null): Protocol {
  const prev = draft.id ? state.data.protocols.find((p) => p.id === draft.id && !p.deletedAt) : undefined;
  const stamped = stamp<Protocol>(draft);
  const protocol = prev ? withScheduleHistory(prev, stamped, dayKey(new Date())) : stamped;
  const changes: Change[] = [{ table: "protocol", op: "upsert", id: protocol.id }];
  let vials = state.data.vials;
  const inUse = prev ? activeVial(vials, protocol.id) : null;
  if (inUse && protocol.mix && !sameMix(prev?.mix ?? null, protocol.mix) && !sameMix(vialMix(inUse), protocol.mix)) {
    const vial: Vial = { ...inUse, amount: protocol.mix.vialAmount, unit: protocol.mix.vialUnit, waterMl: protocol.mix.waterMl, updatedAt: protocol.updatedAt };
    vials = upsertIn(vials, vial);
    changes.push({ table: "vial", op: "upsert", id: vial.id });
  }
  if (firstVial && protocol.mix) {
    const vial = stamp<Vial>({
      protocolId: protocol.id,
      amount: protocol.mix.vialAmount,
      unit: protocol.mix.vialUnit,
      waterMl: protocol.mix.waterMl,
      mixedOn: firstVial.mixedOn,
      lot: null,
      status: "active",
    });
    vials = [...vials, vial];
    changes.push({ table: "vial", op: "upsert", id: vial.id });
  }
  commit({ protocols: upsertIn(state.data.protocols, protocol), vials }, changes);
  return protocol;
}

export function setProtocolStatus(id: string, status: Protocol["status"], endDate: string | null = null): void {
  const p = state.data.protocols.find((x) => x.id === id);
  if (!p) return;
  // Ending sets the end date; restarting an ended protocol clears it.
  const nextEnd = status === "archived" ? (endDate ?? p.endDate) : p.status === "archived" ? null : p.endDate;
  const now = new Date();
  saveRecord("protocols", withScheduleHistory(p, { ...p, status, endDate: nextEnd, updatedAt: now.toISOString() }, dayKey(now)));
}

/** Deletes a protocol with its logs, skips and vials. */
export function deleteProtocol(id: string): void {
  const now = new Date().toISOString();
  const { protocols, doses, skips, vials } = state.data;
  const doseIds = new Set(doses.filter((d) => d.protocolId === id && !d.deletedAt).map((d) => d.id));
  const skipIds = new Set(skips.filter((s) => s.protocolId === id && !s.deletedAt).map((s) => s.id));
  const vialIds = new Set(vials.filter((v) => v.protocolId === id && !v.deletedAt).map((v) => v.id));
  commit(
    {
      protocols: tombstone(protocols, new Set([id]), now),
      doses: tombstone(doses, doseIds, now),
      skips: tombstone(skips, skipIds, now),
      vials: tombstone(vials, vialIds, now),
    },
    [
      { table: "protocol", op: "delete", id },
      ...[...doseIds].map((d) => ({ table: "dose" as const, op: "delete" as const, id: d })),
      ...[...skipIds].map((s) => ({ table: "skip" as const, op: "delete" as const, id: s })),
      ...[...vialIds].map((v) => ({ table: "vial" as const, op: "delete" as const, id: v })),
    ],
  );
}

/** Logs a dose. With a `vialId` it comes off that vial (what's left is worked out from the logs). */
export function logDose(draft: DoseDraft): DoseLog {
  const dose = stamp<DoseLog>(draft);
  saveRecord("doses", dose);
  return dose;
}

export function updateDose(dose: DoseLog): void {
  saveRecord("doses", { ...dose, updatedAt: new Date().toISOString() });
}

function deleteFrom(key: ListKey, ids: string[]): void {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const set = new Set(ids);
  commit(
    { [key]: tombstone(state.data[key] as Synced[], set, now) } as Partial<TrackerData>,
    ids.map((id) => ({ table: TABLE_OF[key], op: "delete", id })),
  );
}

/** Deletes logs (also how Undo works: the delete is queued even if the log never left the phone). */
export function deleteDoses(ids: string[]): void {
  deleteFrom("doses", ids);
}

export function logSkip(draft: SkipDraft): SkipLog {
  const skip = stamp<SkipLog>(draft);
  saveRecord("skips", skip);
  return skip;
}

export function deleteSkip(id: string): void {
  deleteFrom("skips", [id]);
}

/**
 * Saves a vial. A vial that becomes the one in use (new and active, or opened:
 * `unopened` cleared) finishes the protocol's other active ones, and its mix
 * becomes the protocol's (units on Today, Taken and reminders all follow it).
 */
export function saveVial(draft: VialDraft): Vial {
  const vial = stamp<Vial>(draft);
  const now = vial.updatedAt;
  const before = state.data.vials.find((v) => v.id === vial.id);
  const inUse = (v: Vial | undefined) => !!v && v.status === "active" && !v.unopened;
  const opening = inUse(vial) && !inUse(before);
  const others = opening ? state.data.vials.filter((v) => v.id !== vial.id && v.protocolId === vial.protocolId && inUse(v) && !v.deletedAt) : [];
  const finishedIds = new Set(others.map((v) => v.id));
  const vials = upsertIn(
    state.data.vials.map((v) => (finishedIds.has(v.id) ? { ...v, status: "finished" as const, updatedAt: now } : v)),
    vial,
  );
  const changes: Change[] = [
    ...[...finishedIds].map((id) => ({ table: "vial" as const, op: "upsert" as const, id })),
    { table: "vial", op: "upsert", id: vial.id },
  ];
  const protocol = state.data.protocols.find((p) => p.id === vial.protocolId && !p.deletedAt);
  const mix = vialMix(vial);
  let protocols = state.data.protocols;
  if (protocol && mix && activeVial(vials, protocol.id)?.id === vial.id && !sameMix(protocol.mix, mix)) {
    protocols = upsertIn(protocols, { ...protocol, mix, syringe: protocol.syringe ?? state.data.settings.defaultSyringe, updatedAt: now });
    changes.push({ table: "protocol", op: "upsert", id: protocol.id });
  }
  commit({ vials, protocols }, changes);
  return vial;
}

export function deleteVial(id: string): void {
  deleteFrom("vials", [id]);
}

/** One check-in per day: saving a date that has one updates it. */
export function saveCheckIn(draft: CheckInDraft): CheckIn {
  const existing = state.data.checkins.find((c) => c.date === draft.date && !c.deletedAt);
  const checkin = stamp<CheckIn>({ ...draft, id: existing?.id, createdAt: existing?.createdAt });
  saveRecord("checkins", checkin);
  return checkin;
}

/** Sets that day's check-in weight (creates the check-in when there is none). */
export function recordWeight(day: string, weightKg: number): void {
  const existing = state.data.checkins.find((c) => c.date === day && !c.deletedAt);
  const base = existing ?? { date: day, energy: null, mood: null, appetite: null, sleep: null, effects: [], note: null };
  saveCheckIn({ ...base, date: day, weightKg });
}

export function deleteCheckIn(id: string): void {
  deleteFrom("checkins", [id]);
}

export function saveSettings(patch: Partial<TrackerSettings>): void {
  const settings = { ...state.data.settings, ...patch, updatedAt: new Date().toISOString() };
  commit({ settings }, [{ table: "settings", op: "upsert", id: SETTINGS_ID }]);
}

/** Deletes every protocol, log, vial and check-in (settings stay). */
export function resetTracker(): void {
  const now = new Date().toISOString();
  const changes: Change[] = [];
  const data: Partial<TrackerData> = {};
  for (const key of LISTS) {
    const live = (state.data[key] as Synced[]).filter((r) => !r.deletedAt).map((r) => r.id);
    (data as Record<string, unknown>)[key] = tombstone(state.data[key] as Synced[], new Set(live), now);
    changes.push(...live.map((id) => ({ table: TABLE_OF[key], op: "delete" as const, id })));
  }
  commit(data, changes, { firstDoseCelebrated: false });
}

export function setTrackerMeta(patch: Partial<TrackerMeta>): void {
  commit({}, [], patch);
}

/** Dismisses "N changes couldn't sync" (the records were already refused by the server). */
export function clearSyncRejections(): void {
  commit({}, [], { rejectedCount: 0, lastRejectReason: null, rejectedIds: [] });
}

// ── Sync plumbing (no outbox entries) ────────────────────────────────────

/**
 * Applies one sync round in a single write: the sent outbox entries leave
 * (accepted or rejected alike — a rejected record would fail the same way
 * again), pulled data is merged in by the caller, and the cursor moves on.
 * Entries replaced by a newer change while the request ran stay (new op id).
 */
export function applySyncResult(sentOpIds: readonly string[], data: TrackerData | null, meta: Partial<TrackerMeta>): void {
  const sent = new Set(sentOpIds);
  setState({
    ...state,
    outbox: state.outbox.filter((o) => !sent.has(o.id)),
    data: data ?? state.data,
    meta: { ...state.meta, ...meta },
  });
  persist(data ? ["outbox", "meta", ...LISTS, "settings"] : ["outbox", "meta"]);
}

/** Queues every record for upload (e.g. after the server lost them, or a cursor reset). */
export function enqueueEverything(): void {
  const changes: Change[] = [];
  for (const key of LISTS) {
    for (const r of state.data[key] as Synced[]) changes.push({ table: TABLE_OF[key], op: r.deletedAt ? "delete" : "upsert", id: r.id });
  }
  changes.push({ table: "settings", op: "upsert", id: SETTINGS_ID });
  commit({}, changes);
}

/**
 * Removes one account's tracker from this phone (account deletion). Clears
 * memory too when it is the bound account. Server data is deleted by the
 * account/delete flow, not here.
 */
export async function wipeTrackerScope(scope: string): Promise<void> {
  if (state.scope === scope) setTrackerScope(null);
  await writeChain.catch(() => undefined);
  const keys = ALL_PARTS.flatMap((part) => [trackerKey(scope, part), legacyKey(scope, part)]);
  await AsyncStorage.multiRemove(keys).catch(() => undefined);
}

/** An outbox value with nothing waiting (absent, empty, or unreadable-as-a-list counts as NOT empty — keep it). */
function isEmptyOutbox(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) return true;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && v.length === 0;
  } catch {
    return false;
  }
}

/**
 * Removes the tracker copies OTHER accounts left on this phone (signed out
 * here earlier) — only those fully synced: a copy with changes still waiting
 * stays, so nothing unsynced is ever lost. Returns how many copies were kept.
 */
export async function wipeSyncedOtherCopies(keepScope: string): Promise<{ removed: number; kept: number }> {
  const all = await AsyncStorage.getAllKeys();
  const groups = new Map<string, string[]>();
  for (const key of all) {
    const g = legacyGroupOf(key, KEY_PREFIX);
    if (!g || !ALL_PARTS.includes(g.part)) continue;
    groups.set(g.group, [...(groups.get(g.group) ?? []), key]);
  }
  groups.delete(scopeKeyId(keepScope));
  groups.delete(keepScope);
  let removed = 0;
  let kept = 0;
  for (const [group, keys] of groups) {
    const outbox = await AsyncStorage.getItem(`${KEY_PREFIX}${group}.outbox`);
    if (!isEmptyOutbox(outbox)) {
      kept += 1;
      continue;
    }
    await AsyncStorage.multiRemove(keys);
    removed += 1;
  }
  return { removed, kept };
}
