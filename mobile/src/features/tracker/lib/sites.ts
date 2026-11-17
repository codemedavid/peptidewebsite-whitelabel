/**
 * Injection-site rotation (spec §5.4): ten zones, each recent (< 72 h),
 * healing (3–6 days) or rested (7+ days or never). The suggestion is the
 * rested zone used longest ago; ties continue the fixed rotation order from
 * the zone used last.
 */
import { dayKey, formatDay } from "./ids";
import { isLive, SITE_IDS, type DoseLog, type SiteId } from "./types";

const HOUR_MS = 3_600_000;
const RECENT_HOURS = 72;
const RESTED_DAYS = 7;

export interface SiteInfo {
  id: SiteId;
  label: string;
  view: "front" | "back";
}

export const SITES: SiteInfo[] = [
  { id: "belly_ll", label: "Left lower belly", view: "front" },
  { id: "belly_lr", label: "Right lower belly", view: "front" },
  { id: "belly_ul", label: "Left upper belly", view: "front" },
  { id: "belly_ur", label: "Right upper belly", view: "front" },
  { id: "thigh_l", label: "Left thigh", view: "front" },
  { id: "thigh_r", label: "Right thigh", view: "front" },
  { id: "glute_l", label: "Left glute", view: "back" },
  { id: "glute_r", label: "Right glute", view: "back" },
  { id: "arm_l", label: "Back of left arm", view: "back" },
  { id: "arm_r", label: "Back of right arm", view: "back" },
];

const LABELS = new Map(SITES.map((s) => [s.id, s.label] as const));

export function siteLabel(id: SiteId | null | undefined): string {
  return (id && LABELS.get(id)) || "No site";
}

export function isSiteId(value: unknown): value is SiteId {
  return typeof value === "string" && (SITE_IDS as readonly string[]).includes(value);
}

export type SiteState = "recent" | "healing" | "rested";

export interface SiteStatus {
  id: SiteId;
  state: SiteState;
  lastUsed: Date | null;
}

function lastUses(doses: readonly DoseLog[]): Map<SiteId, Date> {
  const out = new Map<SiteId, Date>();
  for (const d of doses) {
    if (!isLive(d) || !d.site) continue;
    const at = new Date(d.takenAt);
    const prev = out.get(d.site);
    if (!prev || at > prev) out.set(d.site, at);
  }
  return out;
}

export function siteStates(doses: readonly DoseLog[], now: Date): Record<SiteId, SiteStatus> {
  const last = lastUses(doses);
  const entries = SITE_IDS.map((id) => {
    const used = last.get(id) ?? null;
    const hours = used ? (now.getTime() - used.getTime()) / HOUR_MS : Infinity;
    const state: SiteState = hours < RECENT_HOURS ? "recent" : hours < RESTED_DAYS * 24 ? "healing" : "rested";
    return [id, { id, state, lastUsed: used }] as const;
  });
  return Object.fromEntries(entries) as Record<SiteId, SiteStatus>;
}

/** The next zone to use. Never-used zones count as used longest ago. */
export function suggestSite(doses: readonly DoseLog[], now: Date): SiteId {
  const states = siteStates(doses, now);
  const last = lastUses(doses);
  let newest: SiteId | null = null;
  for (const [id, at] of last) if (!newest || at > (last.get(newest) as Date)) newest = id;
  const start = newest ? SITE_IDS.indexOf(newest) + 1 : 0;
  const rotation = SITE_IDS.map((_, i) => SITE_IDS[(start + i) % SITE_IDS.length]);

  const rested = rotation.filter((id) => states[id].state === "rested");
  const pool = rested.length > 0 ? rested : rotation;
  let best = pool[0];
  for (const id of pool) {
    const a = last.get(id)?.getTime() ?? -Infinity;
    const b = last.get(best)?.getTime() ?? -Infinity;
    if (a < b) best = id;
  }
  return best;
}

/** "Left lower belly, rested, last used Sep 30" (screen readers). */
export function siteA11yLabel(status: SiteStatus): string {
  const used = status.lastUsed ? `last used ${formatDay(dayKey(status.lastUsed))}` : "not used yet";
  return `${siteLabel(status.id)}, ${status.state}, ${used}`;
}
