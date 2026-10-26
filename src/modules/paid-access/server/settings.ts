import "server-only";

// Reading and saving one round's Paid Access settings. Every save is validated by
// the core schema, bumps the flow's version, is written to the audit log with
// who made it and what changed, and busts the storefront's cached policies.
// Members already in the flow keep their snapshot — nothing here touches them,
// except promoting waitlisters into slots a bigger limit just opened.

import { revalidateTag } from "next/cache";
import { withTenant } from "@/lib/db/tenant-client";
import { UNCONFIGURED_SETTINGS, detectPreset, type PaidAccessPresetId } from "../core/presets";
import { validateSettings } from "../core/settings";
import type { PaidAccessSettings } from "../core/types";
import { asAdmin, fail, later, loadRound, type Fail } from "./context";
import { notifyMember } from "./notify";
import { onlineProvider } from "./payments";
import { findFlow, logEvents, saveFlow } from "./repo";
import { settleSlots } from "./slots";

/** Cache tag for a store's storefront gate policies (access.ts). */
export const paidAccessTag = (tenantId: string) => `tenant:${tenantId}:paid-access`;

/** Can people join under these settings right now? Saved settings were valid
 *  when saved, but e.g. a disconnected online provider can invalidate them —
 *  then joining pauses (fail closed) instead of running a broken flow. */
export function flowReady(settings: PaidAccessSettings): boolean {
  return validateSettings(settings, { onlinePaymentsAvailable: !!onlineProvider() }).ok;
}

export type SettingsView = {
  ok: true;
  enabled: boolean;
  /** false = no settings saved yet: members only, joining paused. */
  exists: boolean;
  settings: PaidAccessSettings;
  /** What the panel should start from (the default preset for a new flow). */
  suggested: PaidAccessSettings;
  preset: PaidAccessPresetId | "custom";
  version: number;
  slotsTaken: number;
  onlinePaymentsAvailable: boolean;
};

export async function getSettings(input: { tenantId: string; groupBuyId: unknown }): Promise<SettingsView | Fail> {
  const ctx = await loadRound(input.tenantId, input.groupBuyId);
  if ("ok" in ctx) return ctx;
  const flow = await withTenant(input.tenantId, (db) => findFlow(db, ctx.round.id));
  const settings = flow?.settings ?? UNCONFIGURED_SETTINGS;
  return {
    ok: true,
    enabled: ctx.enabled,
    exists: !!flow,
    settings,
    suggested: settings,
    preset: detectPreset(settings),
    version: flow?.version ?? 0,
    slotsTaken: flow?.slotsTaken ?? 0,
    onlinePaymentsAvailable: !!onlineProvider(),
  };
}

/** Top-level sections that changed, for the audit log. */
function changedSections(before: PaidAccessSettings | null, after: PaidAccessSettings): string[] {
  const keys = Object.keys(after) as (keyof PaidAccessSettings)[];
  if (!before) return keys;
  return keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

export async function updateSettings(input: {
  tenantId: string;
  groupBuyId: unknown;
  admin: unknown;
  input: unknown;
  now?: Date;
}): Promise<SettingsView | Fail> {
  const admin = asAdmin(input.admin);
  if (!admin) return fail("forbidden", "Only a store admin can change these settings.");
  const ctx = await loadRound(input.tenantId, input.groupBuyId);
  if ("ok" in ctx) return ctx;
  if (!ctx.enabled) return fail("unavailable", "Join settings aren't enabled for this store.");
  const parsed = validateSettings(input.input, { onlinePaymentsAvailable: !!onlineProvider() });
  if (!parsed.ok) return fail("invalid_input", parsed.errors[0]?.message ?? "Check the settings.", parsed.errors);

  const now = input.now ?? new Date();
  const groupBuyId = ctx.round.id;
  const promoted = await withTenant(input.tenantId, async (db) => {
    const before = await findFlow(db, groupBuyId);
    const changed = changedSections(before?.settings ?? null, parsed.settings);
    if (before && changed.length === 0) return [];
    const flow = await saveFlow(db, { tenantId: input.tenantId, groupBuyId, settings: parsed.settings });
    await logEvents(db, input.tenantId, [
      {
        groupBuyId,
        kind: "settings",
        actorKind: "admin",
        actorId: admin.id,
        data: { version: flow.version, changed, before: before?.settings ?? null, after: parsed.settings },
      },
    ]);
    // A bigger (or removed) slot limit, or the waitlist switched off: settle the line.
    return (await settleSlots(db, input.tenantId, groupBuyId, flow.id, now)).promoted;
  });
  revalidateTag(paidAccessTag(input.tenantId));
  for (const id of promoted) later(() => notifyMember(input.tenantId, id, "promoted"));
  return getSettings({ tenantId: input.tenantId, groupBuyId });
}
