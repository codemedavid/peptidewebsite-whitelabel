/**
 * Where a tapped tracker reminder goes. The payload (lib/reminders.ts
 * PlannedReminder.data) is only a pointer; the screen reads the phone's store.
 * Pure, shared by the notification routing (community lib/pushTarget.ts) and
 * features/tracker/reminders.ts.
 */

export type TrackerTarget =
  | { kind: "dose"; protocolId: string; slot: string }
  | { kind: "refill"; protocolId: string | null }
  | { kind: "checkin"; date: string | null }
  /** The Tracker tab itself. */
  | { kind: "home" };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A tracker reminder's payload as a target, or null when it isn't one. Malformed fields fall back to the tab. */
export function trackerTarget(data: unknown): TrackerTarget | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { type?: unknown; kind?: unknown; protocolId?: unknown; slot?: unknown; date?: unknown };
  if (d.type !== "tracker") return null;
  const id = typeof d.protocolId === "string" && ID_RE.test(d.protocolId) ? d.protocolId : null;
  if (d.kind === "dose") {
    const slot = typeof d.slot === "string" && Number.isFinite(Date.parse(d.slot)) ? d.slot : null;
    return id && slot ? { kind: "dose", protocolId: id, slot } : { kind: "home" };
  }
  if (d.kind === "refill") return { kind: "refill", protocolId: id };
  if (d.kind === "checkin") return { kind: "checkin", date: typeof d.date === "string" && DAY_RE.test(d.date) ? d.date : null };
  return { kind: "home" };
}

/** The app path for a target: a dose opens the log sheet for that slot. */
export function trackerHref(target: TrackerTarget): string {
  switch (target.kind) {
    case "dose":
      return `/tracker/log?protocolId=${encodeURIComponent(target.protocolId)}&slot=${encodeURIComponent(target.slot)}`;
    case "checkin":
      return target.date ? `/tracker/checkin?date=${target.date}` : "/tracker/checkin";
    case "refill":
      return "/tracker/vials";
    case "home":
      return "/tracker";
  }
}
