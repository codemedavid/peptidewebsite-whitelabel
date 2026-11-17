// Who gets the tracker, from /me (server: src/lib/mobile/tracker-access.ts).
// Every signed-in account keeps its OWN tracker: customers in their Tracker tab,
// the store owner and staff from More → Peptide Tracker. Nobody sees anyone else's.
import type { MeResponse, TrackerMe } from "@contract";

export type TrackerAccess = {
  /** The store granted the tracker (and its customer app is open). */
  enabled: boolean;
  /** Offer "Start from the store's guide" in protocol setup (never for guests). */
  guideImport: boolean;
  /** Show the Tracker tab: customer mode only (guests see a sign-up lock). */
  tab: boolean;
  /** The store team's own tracker (More → Peptide Tracker): admin mode. */
  team: boolean;
  /** An app guest: no account to own tracker data. */
  guest: boolean;
  /** May use the tracker: store, sync, reminders, API calls. Tab or team, minus guests. */
  active: boolean;
};

type AccessInput = Partial<Pick<MeResponse, "mode">> & {
  actor?: { kind: string; guest?: boolean } | null;
  tracker?: TrackerMe | null;
};

/** Older servers leave `tracker` out of /me: the tab stays hidden. */
export function trackerAccess(me: AccessInput): TrackerAccess {
  const enabled = me.tracker?.enabled === true;
  const tab = me.mode === "customer" && enabled;
  const team = me.mode === "admin" && enabled;
  const guest = me.actor?.kind === "customer" && me.actor.guest === true;
  const active = (tab || team) && !guest;
  return { enabled, guideImport: active && me.tracker?.guideImport === true, tab, team, guest, active };
}
