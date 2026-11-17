/**
 * Wires the tracker store to its side effects, once per signed-in session:
 * binds the store to the account (scope), syncs on bind (sign-in), after
 * every change (debounced) and on foreground, and re-plans reminders on each
 * change and on foreground. Unbinding (sign-out, revoked grant) empties memory
 * and cancels this phone's tracker reminders.
 *
 * Mounted from useNotificationRouting (the signed-in layout), so it runs even
 * when the Tracker tab is never opened.
 */
import { useEffect } from "react";
import { useSignedIn } from "@/auth/SessionProvider";
import { AppState } from "react-native";
import { cancelTrackerReminders, replanReminders, scheduleReplan, setTrackerReminderStore, setTrackerRemindersEnabled } from "./reminders";
import { onTrackerScopeChange, onTrackerWrite, setTrackerScope } from "./store";
import { resetTrackerSync, reviveTrackerSync, scheduleFlush, setTrackerSessionScope, setTrackerSyncEnabled, syncTracker } from "./sync";

let wired = false;

function wireOnce(): void {
  if (wired) return;
  wired = true;
  onTrackerWrite(() => {
    scheduleFlush();
    scheduleReplan();
  });
  onTrackerScopeChange((scope) => {
    resetTrackerSync();
    if (!scope) {
      void cancelTrackerReminders();
      return;
    }
    // Sign-in / account switch: pull this account's tracker, then plan its reminders.
    void syncTracker().then(replanReminders);
  });
  AppState.addEventListener("change", (next) => {
    if (next !== "active") return;
    void syncTracker().then(replanReminders);
  });
}

/**
 * Binds the tracker to the signed-in account while `enabled` (customer with
 * the tracker granted). `scope` = useSignedIn().scope.
 */
export function useTrackerRuntime(scope: string, enabled: boolean): void {
  const { me } = useSignedIn();
  // Reported at render, before the effect re-binds the store: an account
  // switch stops the old account's push before the API client sends it on the
  // new session's token (sync drops any round whose scopes disagree).
  setTrackerSessionScope(enabled ? scope : null);
  useEffect(() => {
    wireOnce();
    setTrackerSessionScope(enabled ? scope : null);
    setTrackerSyncEnabled(enabled);
    setTrackerRemindersEnabled(enabled);
    setTrackerScope(enabled ? scope : null);
    // Revoked while bound to nothing: still clear any reminders left from before.
    if (!enabled) void cancelTrackerReminders();
    return () => {
      setTrackerSessionScope(null);
      setTrackerSyncEnabled(false);
      setTrackerRemindersEnabled(false);
      setTrackerScope(null);
    };
  }, [scope, enabled]);

  // Reminders are titled with the store's name ("VR Jonina"), not the app's.
  useEffect(() => {
    setTrackerReminderStore(enabled ? me.store.name : null);
  }, [enabled, me.store.name]);

  // A fresh /me (foreground, reload) that still grants the tracker lifts a
  // 404/403 stop the server gave earlier (e.g. the grant was off for a while).
  useEffect(() => {
    if (enabled) reviveTrackerSync();
  }, [me, enabled]);
}
