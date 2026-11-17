/**
 * Settings helpers that reach past the hooks API (kept out of the screen).
 *
 * resetThisPhone: clears this phone's copy of the tracker and pulls it again
 * from the account. Unlike resetTracker() (which DELETES everywhere), nothing
 * in the account changes. It refuses — and touches nothing — unless a sync has
 * just succeeded with no local changes left, so no unsynced log is ever lost.
 *
 * removeTrackerFromPhone: takes the tracker OFF this phone (the account keeps
 * it): this account's copy plus fully-synced copies other accounts left here.
 * It refuses while any change of this account hasn't reached the server; the
 * caller then signs out, so nothing downloads again until the next sign-in.
 */
import { setTrackerScope, trackerStore, wipeSyncedOtherCopies, wipeTrackerScope } from "../store";
import { isTrackerSyncDisabled, syncTracker } from "../sync";

export type ResetOutcome = "done" | "pending" | "offline" | "unavailable";

export async function resetThisPhone(scope: string): Promise<ResetOutcome> {
  if (isTrackerSyncDisabled()) return "unavailable";
  const before = trackerStore.getSnapshot().meta.lastPullAt;
  await syncTracker();
  const snap = trackerStore.getSnapshot();
  if (snap.scope !== scope) return "unavailable";
  if (snap.outbox.length > 0) return "pending";
  // syncTracker never throws: an unchanged pull time means it didn't reach the server.
  if (snap.meta.lastPullAt === before || !snap.meta.lastPullAt) return "offline";
  await wipeTrackerScope(scope);
  // Re-binding loads an empty store; the runtime's scope hook then pulls everything (cursor reset).
  setTrackerScope(scope);
  await syncTracker();
  return "done";
}

export type RemoveOutcome = { outcome: "done"; keptOthers: number } | { outcome: "pending" | "unavailable" };

export async function removeTrackerFromPhone(scope: string): Promise<RemoveOutcome> {
  // Push whatever is waiting first; an empty outbox means the account has every change.
  await syncTracker();
  const snap = trackerStore.getSnapshot();
  if (snap.scope !== scope || !snap.isLoaded) return { outcome: "unavailable" };
  if (snap.outbox.length > 0) return { outcome: "pending" };
  await wipeTrackerScope(scope);
  const others = await wipeSyncedOtherCopies(scope).catch(() => ({ removed: 0, kept: 0 }));
  return { outcome: "done", keptOthers: others.kept };
}

const MINUTE_MS = 60_000;

/** "just now" / "5 min ago" / "3 h ago" / "2 days ago" / "not yet". */
export function timeAgo(iso: string | null, now: Date): string {
  if (!iso) return "not yet";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "not yet";
  const min = Math.round((now.getTime() - t) / MINUTE_MS);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
