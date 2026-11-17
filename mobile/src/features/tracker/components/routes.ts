/**
 * Every tracker path in one place. Expo Router's typed routes only learn new
 * files when the dev server regenerates `.expo/types`, so tracker links are
 * built here and cast once (like useNotificationRouting does for "/tracker").
 *
 * Route map (src/app/(app)):
 *   /tracker                        (customer)/tracker.tsx — the customer tab (?view=today|calendar|progress&date=)
 *   /tracker/home                   tracker/home.tsx       — the same home for the store team (More → Peptide Tracker)
 *   /tracker/log                    tracker/log.tsx        — ?protocolId=&slot=ISO | ?doseId= | ?date=YYYY-MM-DD
 *   /tracker/protocol/edit          tracker/protocol/edit  — ?id= (edit) | ?guide=<name> | ?orderKey=<key>
 *   /tracker/protocol/<id>          tracker/protocol/[id]
 *   /tracker/onboarding             tracker/onboarding.tsx
 *   /tracker/disclaimer             tracker/disclaimer.tsx
 *   /tracker/vials                  tracker/vials.tsx      — In use / Unopened / Finished, + "Add from my orders"
 *   /tracker/vial                   tracker/vial.tsx       — ?id= (edit) | ?orderKey=<key> | ?protocolId=
 *   /tracker/checkin                tracker/checkin.tsx    — ?date=YYYY-MM-DD (default today)
 *   /tracker/settings               tracker/settings.tsx
 */
import type { Href } from "expo-router";

export type TrackerView = "today" | "calendar" | "progress";

/** The store team's tracker home (there's no customer tab bar in admin mode). */
export const TEAM_TRACKER_HOME = "/tracker/home";
let homePath = "/tracker";

/**
 * Where "back to the tracker" goes for the signed-in account: the customer's
 * Tracker tab, or the team's own page. Set by the (app) layout on every render.
 */
export function setTrackerHomeFor(isTeam: boolean): void {
  homePath = isTeam ? TEAM_TRACKER_HOME : "/tracker";
}

/** The tracker home path right now (see setTrackerHomeFor). */
export function trackerHomePath(): string {
  return homePath;
}

function withQuery(path: string, params: Record<string, string | null | undefined>): Href {
  const query = Object.entries(params)
    .filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return (query ? `${path}?${query}` : path) as Href;
}

export const trackerHref = {
  home: (view?: TrackerView, date?: string): Href => withQuery(homePath, { view, date }),
  log: (p: { protocolId?: string; slot?: string; doseId?: string; date?: string } = {}): Href => withQuery("/tracker/log", p),
  protocolEdit: (p: { id?: string; guide?: string; orderKey?: string } = {}): Href => withQuery("/tracker/protocol/edit", p),
  protocol: (id: string): Href => `/tracker/protocol/${encodeURIComponent(id)}` as Href,
  onboarding: (): Href => "/tracker/onboarding" as Href,
  disclaimer: (): Href => "/tracker/disclaimer" as Href,
  settings: (): Href => "/tracker/settings" as Href,
  checkin: (date?: string): Href => withQuery("/tracker/checkin", { date }),
  vials: (): Href => "/tracker/vials" as Href,
  vial: (p: { id?: string; orderKey?: string; protocolId?: string } = {}): Href => withQuery("/tracker/vial", p),
  /** The in-app shop's product page (customer stack). */
  product: (id: string): Href => `/product/${encodeURIComponent(id)}` as Href,
  createAccount: (): Href => "/create-account" as Href,
  signIn: (): Href => "/sign-in" as Href,
};
