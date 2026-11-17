/**
 * Phone-only glue between the reminder plan (lib/reminders.ts) and
 * expo-notifications, ported from MamaMicaGlow services/tracker/reminders.ts.
 * Reminders stay LOCAL: no server push ever carries tracker data.
 *
 * Re-planning cancels only the tracker's own scheduled notifications (payload
 * `type: "tracker"`), then schedules the next 14 days (≤ 48) on exact dates.
 * Dose reminders carry "Taken" and "Snooze 1 h" buttons (category
 * TRACKER_CATEGORY, distinct from every other category in the app). A snooze
 * survives a re-plan unless its dose was logged or skipped meanwhile.
 *
 * Every payload carries a short hash of the account scope, so a reminder (or a
 * Taken tap) from another account on this phone is never acted on, and a
 * re-plan for a new account cancels the old account's.
 *
 * Permission is never asked here on launch: the onboarding screen calls
 * ensureTrackerNotificationPermission(). Does nothing on web.
 */
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { dayKey } from "./lib/ids";
import { quickDose } from "./lib/quick-log";
import { fromStore, planReminders } from "./lib/reminders";
import { trackerTarget, type TrackerTarget } from "./lib/target";
import { matchSlots } from "./lib/today";
import type { DoseLog } from "./lib/types";
import { currentTrackerScope, ensureTrackerLoaded, logDose, trackerStore } from "./store";

export const REMINDERS_SUPPORTED = Platform.OS !== "web";
/** Distinct from every other notification category in the app. */
export const TRACKER_CATEGORY = "pepworld_tracker_dose";
/** Android channel for tracker reminders (users can silence it on its own). */
export const TRACKER_CHANNEL = "tracker_reminders";
export const ACTION_TAKEN = "tracker_taken";
export const ACTION_SNOOZE = "tracker_snooze";
const SNOOZE_SECONDS = 3600;
const REPLAN_DELAY_MS = 800;

let setupDone = false;
let enabled = false;
let chain: Promise<void> = Promise.resolve();
let replanTimer: ReturnType<typeof setTimeout> | null = null;

/** A short, stable, non-reversible tag for the account scope (the scope itself holds an email). */
export function scopeTag(scope: string): string {
  let h = 5381;
  for (let i = 0; i < scope.length; i += 1) h = ((h << 5) + h + scope.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

type TrackerData = Record<string, unknown> & { type: "tracker" };

function trackerData(data: unknown): TrackerData | null {
  return data && typeof data === "object" && (data as { type?: unknown }).type === "tracker" ? (data as TrackerData) : null;
}

let storeName: string | null = null;

/** The signed-in store's name: every reminder's title ("VR Jonina"). Re-plans when it changes. */
export function setTrackerReminderStore(name: string | null): void {
  if (name === storeName) return;
  storeName = name;
  scheduleReplan();
}

/** The runtime switches reminders off while the tracker isn't granted (and re-plans, which cancels them). */
export function setTrackerRemindersEnabled(on: boolean): void {
  enabled = on;
}

async function ensureSetup(): Promise<void> {
  if (setupDone) return;
  await Notifications.setNotificationCategoryAsync(TRACKER_CATEGORY, [
    { identifier: ACTION_TAKEN, buttonTitle: "Taken", options: { opensAppToForeground: true } },
    { identifier: ACTION_SNOOZE, buttonTitle: "Snooze 1 h", options: { opensAppToForeground: false } },
  ]);
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(TRACKER_CHANNEL, {
      name: "Tracker reminders",
      importance: Notifications.AndroidImportance.HIGH,
      // PRIVATE only hides the text on a SECURE lock screen, and only where the
      // phone's own settings ask for it (iOS has no per-channel equivalent). So
      // this is a backstop, not the protection: titles carry no compound names
      // or amounts unless the user switched showNamesInNotifications on (off by
      // default; lib/reminders.ts GENERIC_TITLE).
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
  setupDone = true;
}

/** The scheduled dose of `protocolId` at `slotIso`, with what happened to it. */
function slotOf(protocolId: string, slotIso: string, now: Date) {
  const { data } = trackerStore.getSnapshot();
  const protocol = data.protocols.find((p) => p.id === protocolId && !p.deletedAt);
  const at = new Date(slotIso);
  if (!protocol || !Number.isFinite(at.getTime())) return null;
  const day = dayKey(at);
  return matchSlots([protocol], data.doses, data.skips, day, day, now).slots.find((s) => s.at.getTime() === at.getTime()) ?? null;
}

/** A tracker snooze worth keeping: this account's, still to come, its dose still open. */
function keepSnooze(d: TrackerData, tag: string | null, now: Date): boolean {
  if (d.snoozed !== "1" || !tag || d.scope !== tag) return false;
  if (typeof d.firesAt !== "string" || Date.parse(d.firesAt) <= now.getTime()) return false;
  const slot = typeof d.protocolId === "string" && typeof d.slot === "string" ? slotOf(d.protocolId, d.slot, now) : null;
  return !!slot && !slot.dose && !slot.skip;
}

async function cancelTracker(keep: (d: TrackerData) => boolean): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(
    scheduled
      .filter((n) => {
        const d = trackerData(n.content.data);
        return d !== null && !keep(d);
      })
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => undefined)),
  );
}

async function replan(): Promise<void> {
  const scope = currentTrackerScope();
  const now = new Date();
  if (!scope || !enabled) {
    await cancelTracker(() => false);
    return;
  }
  await ensureTrackerLoaded();
  if (currentTrackerScope() !== scope) return;
  const tag = scopeTag(scope);
  await cancelTracker((d) => keepSnooze(d, tag, now));

  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await ensureSetup().catch(() => undefined);

  const { data } = trackerStore.getSnapshot();
  for (const r of planReminders({ ...data, now }).map((x) => fromStore(x, storeName))) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: r.title,
          body: r.body,
          data: { ...r.data, scope: tag },
          sound: true,
          ...(r.kind === "dose" ? { categoryIdentifier: TRACKER_CATEGORY } : {}),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at, channelId: TRACKER_CHANNEL },
      });
    } catch {
      // One bad trigger (e.g. a time that just passed) shouldn't drop the rest.
    }
  }
}

/** Re-plans now (one run at a time, so two quick calls never double-schedule). */
export function replanReminders(): Promise<void> {
  if (!REMINDERS_SUPPORTED) return Promise.resolve();
  chain = chain.catch(() => undefined).then(replan);
  return chain.catch(() => undefined);
}

/** Re-plans shortly after a change (a burst of edits re-plans once). */
export function scheduleReplan(): void {
  if (!REMINDERS_SUPPORTED) return;
  if (replanTimer) clearTimeout(replanTimer);
  replanTimer = setTimeout(() => void replanReminders(), REPLAN_DELAY_MS);
}

/** Cancels every tracker reminder on this phone (sign-out, revoked grant). */
export function cancelTrackerReminders(): Promise<void> {
  if (!REMINDERS_SUPPORTED) return Promise.resolve();
  chain = chain.catch(() => undefined).then(() => cancelTracker(() => false));
  return chain.catch(() => undefined);
}

/**
 * Asks for notification permission (call from the tracker onboarding, never on
 * launch), then plans reminders. True when granted.
 */
export async function ensureTrackerNotificationPermission(): Promise<boolean> {
  if (!REMINDERS_SUPPORTED) return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (granted) {
      await ensureSetup().catch(() => undefined);
      void replanReminders();
    }
    return granted;
  } catch {
    return false;
  }
}

export type ReminderOutcome = { kind: "logged"; dose: DoseLog } | { kind: "snoozed" } | { kind: "open"; target: TrackerTarget } | null;

/**
 * Logs the reminded dose with its defaults — the open vial included, so it
 * comes off that vial. Null when there's nothing new to log (already logged or
 * skipped, or the protocol is gone).
 */
async function logFromReminder(protocolId: string, slotIso: string): Promise<DoseLog | null> {
  await ensureTrackerLoaded();
  const now = new Date();
  const slot = slotOf(protocolId, slotIso, now);
  if (slot?.dose || slot?.skip) return null;
  const { data } = trackerStore.getSnapshot();
  const protocol = data.protocols.find((p) => p.id === protocolId && !p.deletedAt);
  const at = new Date(slotIso);
  if (!protocol || !Number.isFinite(at.getTime())) return null;
  return logDose(quickDose(protocol, at, data, now));
}

/**
 * Handles a tracker notification response for the BOUND account. Taken logs
 * the dose; Snooze re-schedules it in an hour; a plain tap opens its target.
 * Null when it isn't a tracker notification. A response from another
 * account's reminder only opens the tracker (never logs).
 */
export async function handleTrackerResponse(response: Notifications.NotificationResponse): Promise<ReminderOutcome> {
  const content = response.notification.request.content;
  const data = trackerData(content.data);
  const target = trackerTarget(content.data);
  if (!data || !target) return null;
  const scope = currentTrackerScope();
  const ours = !!scope && data.scope === scopeTag(scope);

  if (response.actionIdentifier === ACTION_SNOOZE && target.kind === "dose") {
    if (!REMINDERS_SUPPORTED || !ours) return { kind: "snoozed" };
    try {
      const firesAt = new Date(Date.now() + SNOOZE_SECONDS * 1000).toISOString();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: content.title ?? "Dose reminder",
          body: content.body ?? "",
          data: { ...data, snoozed: "1", firesAt },
          sound: true,
          categoryIdentifier: TRACKER_CATEGORY,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: SNOOZE_SECONDS, channelId: TRACKER_CHANNEL },
      });
    } catch {
      // Nothing else to do: the dose still shows as due in the app.
    }
    return { kind: "snoozed" };
  }
  if (response.actionIdentifier === ACTION_TAKEN && target.kind === "dose" && ours) {
    const dose = await logFromReminder(target.protocolId, target.slot);
    return dose ? { kind: "logged", dose } : { kind: "open", target: { kind: "home" } };
  }
  return { kind: "open", target };
}
