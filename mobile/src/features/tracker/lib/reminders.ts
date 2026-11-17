/**
 * Planning phone reminders on exact dates (spec §5.12): the next 14 days of
 * doses, soonest first, at most 48 (iOS allows 64 pending in total), plus a
 * refill alert for low vials and an optional daily check-in nudge. Pure; the
 * expo-notifications glue is features/tracker/reminders.ts.
 */
import { addDays, atTime, dayKey, parseDayKey } from "./ids";
import { formatDose } from "./dose-math";
import { matchSlots } from "./today";
import { activeVial, vialStatus } from "./vials";
import { isLive, type CheckIn, type DoseLog, type Protocol, type SkipLog, type TrackerSettings, type Vial } from "./types";

export const HORIZON_DAYS = 14;
export const MAX_REMINDERS = 48;
const REFILL_HOUR = "09:00";

export type ReminderKind = "dose" | "refill" | "checkin";

export interface PlannedReminder {
  kind: ReminderKind;
  at: Date;
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PlanInput {
  protocols: readonly Protocol[];
  doses: readonly DoseLog[];
  skips: readonly SkipLog[];
  vials: readonly Vial[];
  checkins: readonly CheckIn[];
  settings: TrackerSettings;
  now: Date;
}

/**
 * Lock-screen wording. Names and amounts only when the user switched
 * `showNamesInNotifications` on (default off: anyone near the phone can read
 * them). Never a syringe-unit or mL figure (App Store 1.4.2) — just the dose
 * exactly as the user entered it.
 */
export const GENERIC_TITLE = {
  dose: "Time for your scheduled dose",
  refill: "A vial is running low",
  checkin: "Daily check-in",
} as const satisfies Record<ReminderKind, string>;

/**
 * Who it's from: the store's name becomes the title ("VR Jonina") and the
 * reminder's own words move into the body — every store's app reads as that
 * store, like its order and chat pushes do. The phone still shows the app's
 * name in the small header line; that part can't be set per notification.
 */
export function fromStore(r: PlannedReminder, storeName: string | null | undefined): PlannedReminder {
  const store = storeName?.trim();
  if (!store) return r;
  const lead = /[.!?]$/.test(r.title) ? r.title : `${r.title}.`;
  return { ...r, title: store, body: `${lead} ${r.body}` };
}

/** "BPC-157 · 250 mcg" — or the generic title with names hidden. */
export function doseTitle(p: Pick<Protocol, "name" | "dose">, showNames: boolean): string {
  return showNames ? `${p.name} · ${formatDose(p.dose)}` : GENERIC_TITLE.dose;
}

function doseReminders({ protocols, doses, skips, settings, now }: PlanInput): PlannedReminder[] {
  if (!settings.doseReminders) return [];
  const wanted = protocols.filter((p) => isLive(p) && p.status === "active" && p.reminders && p.schedule.kind !== "asNeeded");
  const today = dayKey(now);
  const { slots } = matchSlots(wanted, doses, skips, today, addDays(today, HORIZON_DAYS - 1), now);
  const byId = new Map(wanted.map((p) => [p.id, p] as const));
  return slots
    .filter((s) => s.state === "open" && s.at.getTime() > now.getTime())
    .map((s) => {
      const p = byId.get(s.protocolId) as Protocol;
      return {
        kind: "dose" as const,
        at: s.at,
        title: doseTitle(p, settings.showNamesInNotifications),
        body: "Tap Taken when it's done.",
        data: { type: "tracker", kind: "dose", protocolId: p.id, slot: s.at.toISOString() },
      };
    });
}

function refillReminders({ protocols, doses, vials, settings, now }: PlanInput): PlannedReminder[] {
  if (!settings.refillReminders) return [];
  const at = atTime(addDays(dayKey(now), 1), REFILL_HOUR);
  const out: PlannedReminder[] = [];
  for (const p of protocols) {
    if (!isLive(p) || p.status !== "active") continue;
    const vial = activeVial(vials, p.id);
    if (!vial) continue;
    const status = vialStatus(vial, doses, p, now);
    if (!status.isLow) continue;
    const left = status.dosesLeft !== null ? `about ${status.dosesLeft} dose${status.dosesLeft === 1 ? "" : "s"} left` : `${status.pct}% left`;
    out.push({
      kind: "refill",
      at,
      title: settings.showNamesInNotifications ? `${p.name} vial: ${left}.` : GENERIC_TITLE.refill,
      body: "Open the tracker to start a new vial when you mix one.",
      data: { type: "tracker", kind: "refill", protocolId: p.id },
    });
  }
  return out;
}

function checkinReminders({ checkins, settings, now }: PlanInput): PlannedReminder[] {
  if (!settings.checkinReminder) return [];
  const done = new Set(checkins.filter(isLive).map((c) => c.date));
  const today = dayKey(now);
  const out: PlannedReminder[] = [];
  for (let i = 0; i < HORIZON_DAYS; i += 1) {
    const day = addDays(today, i);
    const at = atTime(day, settings.checkinTime);
    if (at <= now || done.has(day)) continue;
    out.push({ kind: "checkin", at, title: GENERIC_TITLE.checkin, body: "How are you today? It takes 10 seconds.", data: { type: "tracker", kind: "checkin", date: day } });
  }
  return out;
}

/** Every reminder to schedule now, soonest first, capped at MAX_REMINDERS. */
export function planReminders(input: PlanInput): PlannedReminder[] {
  const horizonEnd = parseDayKey(addDays(dayKey(input.now), HORIZON_DAYS)).getTime();
  return [...doseReminders(input), ...refillReminders(input), ...checkinReminders(input)]
    .filter((r) => r.at.getTime() > input.now.getTime() && r.at.getTime() < horizonEnd)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_REMINDERS);
}
