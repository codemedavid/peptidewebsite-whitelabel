/**
 * The defaults one tap on "Taken" logs (spec §5.1): now, the protocol's dose
 * exactly as entered, the suggested site (when rotation is on) and the vial in
 * use. Shared by the Today card and the notification button.
 *
 * v1 never computes a syringe-unit or mL draw (App Store 1.4.2; the converter
 * is a later feature behind `mobile.tracker.converter`). A log's `volumeMl` /
 * `units` hold only what the user typed (a dose entered in mL or units); the
 * vial still counts down via lib/vials (mass units convert mcg↔mg there).
 */
import { suggestSite } from "./sites";
import { activeVial } from "./vials";
import type { DoseLog, Protocol, SiteId, TrackerData } from "./types";

export type DoseDraft = Omit<DoseLog, "id" | "createdAt" | "updatedAt" | "deletedAt">;

export function siteFor(protocol: Protocol, data: Pick<TrackerData, "doses" | "settings">, now: Date): SiteId | null {
  const injected = protocol.route === "injection" || protocol.route === "pen";
  if (!injected || !protocol.rotateSites || !data.settings.suggestSites) return null;
  return suggestSite(data.doses, now);
}

/** The mL / units the user typed as the dose itself (never computed from a mix). */
export function typedAmounts(dose: Protocol["dose"]): { volumeMl: number | null; units: number | null } {
  return { volumeMl: dose.unit === "ml" ? dose.value : null, units: dose.unit === "units" ? dose.value : null };
}

export function quickDose(protocol: Protocol, scheduledFor: Date | null, data: Pick<TrackerData, "doses" | "vials" | "settings">, now: Date): DoseDraft {
  const vial = activeVial(data.vials, protocol.id);
  return {
    protocolId: protocol.id,
    name: protocol.name,
    takenAt: now.toISOString(),
    scheduledFor: scheduledFor ? scheduledFor.toISOString() : null,
    dose: protocol.dose,
    ...typedAmounts(protocol.dose),
    route: protocol.route,
    site: siteFor(protocol, data, now),
    vialId: vial?.id ?? null,
    note: null,
  };
}
