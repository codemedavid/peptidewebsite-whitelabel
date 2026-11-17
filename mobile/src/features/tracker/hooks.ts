/**
 * The tracker's React API for the UI (ported from MamaMicaGlow
 * hooks/useTracker.ts). Read hooks derive everything from the phone store with
 * the pure lib/ modules; action functions write through the store (which
 * queues sync and re-plans reminders). The store is bound to the account by
 * useTrackerRuntime (signed-in layout); until it is — or while it still holds
 * another account — every hook reports `isLoaded: false` with empty data.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { TrackerOrderVial, TrackerStoreGuide } from "@contract";
import { qk, trackerApi } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { trackerAccess, type TrackerAccess } from "./access";
import { consistency, dayStates, weekStrip, type Consistency, type DayInfo } from "./lib/consistency";
import { addDays, dayKey, isDayKey } from "./lib/ids";
import { levelCurve, type LevelPoint } from "./lib/level";
import { quickDose, type DoseDraft } from "./lib/quick-log";
import { buildToday, type TodayPlan } from "./lib/today";
import { EMPTY_DATA, isLive, type CheckIn, type DoseLog, type DoseUnit, type Protocol, type SkipLog, type TrackerData, type TrackerSettings } from "./lib/types";
import { addedOrderKeys, vialStatus, type VialStatus } from "./lib/vials";
import * as store from "./store";
import { syncTracker } from "./sync";

/** Keeps "due now" honest while a tracker screen is open. */
export const CLOCK_TICK_MS = 60_000;

/** The current time, refreshed every minute and whenever the app comes back. */
export function useNow(tickMs = CLOCK_TICK_MS): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), tickMs);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setNow(new Date());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [tickMs]);
  return now;
}

// ── Access ───────────────────────────────────────────────────────────────

/** { enabled, guideImport, tab } from the signed-in /me (`tab` = customer mode && enabled). */
export function useTrackerAccess(): TrackerAccess {
  const { me } = useSignedIn();
  return useMemo(() => trackerAccess(me), [me]);
}

// ── State ────────────────────────────────────────────────────────────────

export interface TrackerView {
  isLoaded: boolean;
  /** Everything except deleted records. */
  data: TrackerData;
  /** The last write to the phone failed (storage full / blocked). */
  hasSaveError: boolean;
  /** The phone copy can't be read yet (retrying). */
  hasLoadError: boolean;
  /** Local changes not yet on the server. */
  pendingCount: number;
  lastSyncAt: string | null;
  /** Changes the server refused since the user last dismissed the notice. */
  rejectedCount: number;
  /** Why the latest one was refused. */
  lastRejectReason: string | null;
}

function liveOnly(data: TrackerData): TrackerData {
  return {
    protocols: data.protocols.filter(isLive),
    doses: data.doses.filter(isLive),
    skips: data.skips.filter(isLive),
    vials: data.vials.filter(isLive),
    checkins: data.checkins.filter(isLive),
    settings: data.settings,
  };
}

/** The tracker's live data for THIS account. */
export function useTrackerState(): TrackerView {
  const { scope } = useSignedIn();
  const s = useSyncExternalStore(store.trackerStore.subscribe, store.trackerStore.getSnapshot, store.trackerStore.getSnapshot);
  const mine = s.scope === scope;
  const data = useMemo(() => (mine ? liveOnly(s.data) : EMPTY_DATA), [mine, s.data]);
  return {
    isLoaded: mine && s.isLoaded,
    data,
    hasSaveError: mine && s.hasSaveError,
    hasLoadError: mine && s.hasLoadError,
    pendingCount: mine ? s.outbox.length : 0,
    lastSyncAt: mine ? s.meta.lastPullAt : null,
    rejectedCount: mine ? (s.meta.rejectedCount ?? 0) : 0,
    lastRejectReason: mine ? (s.meta.lastRejectReason ?? null) : null,
  };
}

export interface TodayView {
  isLoaded: boolean;
  plan: TodayPlan;
  /** Sunday–Saturday of this week (done / missed / due). */
  week: DayInfo[];
  /** On-schedule % and the current run (the streak). */
  consistency: Consistency;
  /** Active vials that are low or expired, for the warning card. */
  lowVials: (VialStatus & { protocol: Protocol | null })[];
  /** Today's check-in, if any. */
  checkin: CheckIn | null;
}

/** Everything the Today screen shows, for `date` (pass useNow()). */
export function useToday(date: Date): TodayView {
  const { isLoaded, data } = useTrackerState();
  return useMemo(() => {
    const { protocols, doses, skips, vials, checkins } = data;
    const byId = new Map(protocols.map((p) => [p.id, p] as const));
    const lowVials = vials
      .filter((v) => v.status === "active" && !v.unopened)
      .map((v) => ({ ...vialStatus(v, doses, byId.get(v.protocolId) ?? null, date), protocol: byId.get(v.protocolId) ?? null }))
      .filter((v) => v.isLow || v.isExpired);
    const today = dayKey(date);
    return {
      isLoaded,
      plan: buildToday(protocols, doses, skips, date),
      week: weekStrip(protocols, doses, skips, date),
      consistency: consistency(protocols, doses, skips, date),
      lowVials,
      checkin: checkins.find((c) => c.date === today) ?? null,
    };
  }, [isLoaded, data, date]);
}

const STATUS_ORDER: Record<Protocol["status"], number> = { active: 0, paused: 1, archived: 2 };

/** Live protocols: active first, then paused, then ended; newest first within each. */
export function useProtocols(): { isLoaded: boolean; protocols: Protocol[]; byId: Map<string, Protocol> } {
  const { isLoaded, data } = useTrackerState();
  return useMemo(() => {
    const protocols = [...data.protocols].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.createdAt.localeCompare(a.createdAt));
    return { isLoaded, protocols, byId: new Map(protocols.map((p) => [p.id, p] as const)) };
  }, [isLoaded, data.protocols]);
}

export type VialView = VialStatus & { protocol: Protocol | null };

/** Every live vial with what's left, doses left, run-out and expiry; plus the order lines already added. */
export function useVials(now: Date = new Date()): { isLoaded: boolean; vials: VialView[]; orderKeys: Set<string> } {
  const { isLoaded, data } = useTrackerState();
  const day = dayKey(now);
  return useMemo(() => {
    const at = now;
    const byId = new Map(data.protocols.map((p) => [p.id, p] as const));
    const rank = (v: VialStatus["vial"]) => (v.status === "finished" ? 2 : v.unopened ? 1 : 0);
    const vials = data.vials
      .map((v) => ({ ...vialStatus(v, data.doses, byId.get(v.protocolId) ?? null, at), protocol: byId.get(v.protocolId) ?? null }))
      .sort((a, b) => rank(a.vial) - rank(b.vial) || b.vial.createdAt.localeCompare(a.vial.createdAt));
    return { isLoaded, vials, orderKeys: addedOrderKeys(data.vials) };
    // `now` re-derives per day, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, data.vials, data.doses, data.protocols, day]);
}

/**
 * One month's calendar ("YYYY-MM"): each day's state, scheduled slots and
 * unscheduled logs. `protocolId` filters to one protocol (null = all).
 */
export function useHistory(month: string, protocolId: string | null = null, now: Date = new Date()): { isLoaded: boolean; days: DayInfo[] } {
  const { isLoaded, data } = useTrackerState();
  const day = dayKey(now);
  return useMemo(() => {
    const from = `${month}-01`;
    if (!isDayKey(from)) return { isLoaded, days: [] };
    const [y, m] = month.split("-").map(Number);
    const to = addDays(`${String(m === 12 ? y + 1 : y).padStart(4, "0")}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
    const protocols = protocolId ? data.protocols.filter((p) => p.id === protocolId) : data.protocols;
    const doses = protocolId ? data.doses.filter((d) => d.protocolId === protocolId) : data.doses;
    const skips = protocolId ? data.skips.filter((s) => s.protocolId === protocolId) : data.skips;
    return { isLoaded, days: dayStates(protocols, doses, skips, from, to, now) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, data, month, protocolId, day]);
}

export interface DayRange {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, inclusive. */
  to: string;
}

/** Check-ins in the range, oldest first. */
export function useCheckIns(range: DayRange): { isLoaded: boolean; checkins: CheckIn[] } {
  const { isLoaded, data } = useTrackerState();
  return useMemo(
    () => ({
      isLoaded,
      checkins: data.checkins.filter((c) => c.date >= range.from && c.date <= range.to).sort((a, b) => a.date.localeCompare(b.date)),
    }),
    [isLoaded, data.checkins, range.from, range.to],
  );
}

export interface LevelRange {
  from: Date;
  to: Date;
  /** Default 1 h (fewer points over long ranges: capped at MAX_LEVEL_POINTS). */
  stepHours?: number;
}

export interface LevelCurveView {
  /** ESTIMATE ONLY (see lib/level.ts) — label it so in the UI. */
  points: LevelPoint[];
  unit: DoseUnit;
  halfLifeHours: number;
  /** Doses logged in the range (markers on the curve). */
  doses: DoseLog[];
  /** Check-ins in the range, for the side-effect overlay. */
  checkins: CheckIn[];
}

const LEVEL_WARMUP_HALF_LIVES = 6;

/**
 * The estimated level curve for one protocol, or null when it has no
 * user-entered half-life (or doesn't exist). Doses from before `from` still
 * count (about six half-lives back), so the curve doesn't start at zero.
 */
export function useLevelCurve(protocolId: string, range: LevelRange): LevelCurveView | null {
  const { data } = useTrackerState();
  const fromMs = range.from.getTime();
  const toMs = range.to.getTime();
  const step = range.stepHours ?? 1;
  return useMemo(() => {
    const protocol = data.protocols.find((p) => p.id === protocolId);
    const halfLife = protocol?.halfLifeHours ?? null;
    if (!protocol || !halfLife || halfLife <= 0) return null;
    const warmup = fromMs - halfLife * LEVEL_WARMUP_HALF_LIVES * 3_600_000;
    const own = data.doses.filter((d) => d.protocolId === protocolId && Date.parse(d.takenAt) >= warmup && Date.parse(d.takenAt) <= toMs);
    const from = new Date(fromMs);
    const to = new Date(toMs);
    const fromDay = dayKey(from);
    const toDay = dayKey(to);
    return {
      points: levelCurve(own, halfLife, from, to, step, protocol.dose.unit),
      unit: protocol.dose.unit,
      halfLifeHours: halfLife,
      doses: own.filter((d) => Date.parse(d.takenAt) >= fromMs),
      checkins: data.checkins.filter((c) => c.date >= fromDay && c.date <= toDay).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }, [data.protocols, data.doses, data.checkins, protocolId, fromMs, toMs, step]);
}

// ── Store data from the server ───────────────────────────────────────────

/** Delivered order lines not yet added as a vial (GET /tracker/order-vials). Customers only: the team buys nothing in the app. */
export function useOrderVials(enabled = true) {
  const { scope } = useSignedIn();
  const { data } = useTrackerState();
  const access = useTrackerAccess();
  const query = useQuery({ queryKey: qk.trackerOrderVials(scope), queryFn: trackerApi.orderVials, enabled: enabled && access.active && access.tab });
  const added = useMemo(() => addedOrderKeys(data.vials), [data.vials]);
  const lines = useMemo<TrackerOrderVial[]>(() => (query.data ?? []).filter((l) => !added.has(l.key)), [query.data, added]);
  return { ...query, lines };
}

/** The store's guides for "Start from the store's guide" (only fetched when guide import is granted). */
export function useStoreGuides() {
  const { scope } = useSignedIn();
  const access = useTrackerAccess();
  return useQuery<TrackerStoreGuide[]>({ queryKey: qk.trackerStoreGuides(scope), queryFn: trackerApi.storeGuides, enabled: access.guideImport });
}

// ── Actions ──────────────────────────────────────────────────────────────

export type { CheckInDraft, ProtocolDraft, SkipDraft, VialDraft } from "./store";
export type { DoseDraft } from "./lib/quick-log";

/** Create or update a protocol. A new one with a mix gets its first vial when `firstVial` is given. */
export function saveProtocol(draft: store.ProtocolDraft, firstVial: { mixedOn: string } | null = null): Protocol {
  return store.saveProtocol(draft, firstVial);
}

/** Pause (true) or resume (false). Past days keep their schedule. */
export function pauseProtocol(id: string, paused: boolean): void {
  store.setProtocolStatus(id, paused ? "paused" : "active");
}

/** End a protocol (kept in history) on `endDate` (default: its own end date, else open). */
export function endProtocol(id: string, endDate: string | null = null): void {
  store.setProtocolStatus(id, "archived", endDate);
}

/** Delete a protocol with its logs, skips and vials. */
export function deleteProtocol(id: string): void {
  store.deleteProtocol(id);
}

/** Log a dose. With `vialId` set (quickDose sets the open vial) it comes off that vial. */
export function logDose(draft: DoseDraft): DoseLog {
  return store.logDose(draft);
}

/** One-tap "Taken" for a scheduled slot, with the protocol's defaults (dose, site, open vial). Null if the protocol is gone. */
export function logScheduledDose(protocolId: string, scheduledFor: Date | null, now: Date = new Date()): DoseLog | null {
  const { data } = store.trackerStore.getSnapshot();
  const protocol = data.protocols.find((p) => p.id === protocolId && isLive(p));
  return protocol ? store.logDose(quickDose(protocol, scheduledFor, data, now)) : null;
}

/** The pre-filled draft the log sheet starts from (dose, site, open vial, now). */
export function draftDose(protocolId: string, scheduledFor: Date | null, now: Date = new Date()): DoseDraft | null {
  const { data } = store.trackerStore.getSnapshot();
  const protocol = data.protocols.find((p) => p.id === protocolId && isLive(p));
  return protocol ? quickDose(protocol, scheduledFor, data, now) : null;
}

export function updateDose(dose: DoseLog): void {
  store.updateDose(dose);
}

/** Undo: deletes the given logs (queued even if they never left the phone). */
export function undoLog(ids: string | string[]): void {
  store.deleteDoses(Array.isArray(ids) ? ids : [ids]);
}

export function skipDose(draft: store.SkipDraft): SkipLog {
  return store.logSkip(draft);
}

export function undoSkip(id: string): void {
  store.deleteSkip(id);
}

/** Save a vial. Making one the vial in use (new and active, or `unopened` cleared) finishes the protocol's other one. */
export function saveVial(draft: store.VialDraft) {
  return store.saveVial(draft);
}

export function deleteVial(id: string): void {
  store.deleteVial(id);
}

/** One check-in per day: saving a day that has one updates it. */
export function saveCheckIn(draft: store.CheckInDraft): CheckIn {
  return store.saveCheckIn(draft);
}

export function deleteCheckIn(id: string): void {
  store.deleteCheckIn(id);
}

export function updateSettings(patch: Partial<TrackerSettings>): void {
  store.saveSettings(patch);
}

/** Delete every protocol, log, vial and check-in (settings stay). */
export function resetTracker(): void {
  store.resetTracker();
}

/** Dismisses "N changes couldn't sync". */
export function clearSyncRejections(): void {
  store.clearSyncRejections();
}

/** Pull-to-refresh: push what's waiting and pull what's new. Never throws. */
export function syncNow(): Promise<void> {
  return syncTracker();
}
