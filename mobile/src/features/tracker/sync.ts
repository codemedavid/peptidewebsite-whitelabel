/**
 * Tracker sync (replaces MamaMicaGlow services/tracker/cloud.ts): wires the
 * pure loop in lib/sync-engine.ts (rules + tests live there) to the phone
 * store and POST /tracker/sync. Every local write enqueues and schedules a
 * flush (debounced ~2 s); the app also syncs on foreground and on sign-in
 * (scope bind). The cursor is kept per account in the store's meta.
 *
 * The signed-in session's scope is reported by the runtime (useTrackerRuntime)
 * so a push never goes out — and an answer is never applied — once the
 * session and the bound store disagree.
 */
import type { TrackerSyncRequest } from "@contract";
import { trackerApi } from "@/api/endpoints";
import { createTrackerSync } from "./lib/sync-engine";
import { applySyncResult, ensureTrackerLoaded, trackerGeneration, trackerStore } from "./store";

export { SYNC_BATCH } from "./lib/sync-engine";

/** The signed-in session's scope as the runtime last saw it (null = signed out / tracker off). */
let sessionScope: string | null = null;

const engine = createTrackerSync({
  snapshot: () => trackerStore.getSnapshot(),
  generation: trackerGeneration,
  ensureLoaded: ensureTrackerLoaded,
  apply: applySyncResult,
  send: (req) => trackerApi.sync(req as TrackerSyncRequest),
  sessionScope: () => sessionScope,
});

/** The runtime reports the signed-in account (render time, so an account switch is seen before the store re-binds). */
export function setTrackerSessionScope(scope: string | null): void {
  sessionScope = scope;
}

/** The runtime turns sync off while /me says the tracker isn't granted; on again clears a 404/403 stop. */
export function setTrackerSyncEnabled(on: boolean): void {
  engine.setEnabled(on);
}

/** Called on every scope change: a new account starts with a clean slate. */
export function resetTrackerSync(): void {
  engine.reset();
}

/** Whether the server switched sync off for the bound account (feature revoked). */
export function isTrackerSyncDisabled(): boolean {
  return engine.isDisabled();
}

/** /me reports the tracker active again: lift a 404/403 stop for the bound account and sync. */
export function reviveTrackerSync(): void {
  engine.revive();
}

/**
 * Pushes the outbox and pulls what's new, now (one run at a time; a call while
 * one runs queues exactly one more). Never throws: failures retry later.
 */
export function syncTracker(): Promise<void> {
  return engine.sync();
}

/** Syncs shortly after a change (several quick changes go together). */
export function scheduleFlush(): void {
  engine.scheduleFlush();
}
