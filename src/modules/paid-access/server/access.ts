import "server-only";

// Access — the one question every GB page, checkout and the app ask Paid Access:
// may this customer into this round? Decided from the DB on the server; the
// UI only ever renders the answer. getAccess reads live (it DECIDES); the
// storefront's hot path first asks the cached gatePolicies whether the round
// is gated at all, so an Open round costs no extra query.

import { unstable_cache } from "next/cache";
import { withTenant } from "@/lib/db/tenant-client";
import { UNCONFIGURED_SETTINGS } from "../core/presets";
import { requiresJoin } from "../core/settings";
import { hasAccess } from "../core/machine";
import { stepperView, type StepperAction } from "../core/view";
import type { PaidAccessCopy, PaidAccessStatus, PaidAccessStep, PaidAccessVisibility } from "../core/types";
import { paidAccessEnabled, ID_RE } from "./context";
import { findFlow, latestMembership, listFlows, readSettings } from "./repo";
import { paidAccessTag, flowReady } from "./settings";
import { effectiveStatus } from "./state";

export type AccessResult = {
  /** Does the round need a join at all? false = Open. */
  gated: boolean;
  status: PaidAccessStatus | null;
  canAccess: boolean;
  /** The action that moves the customer forward (null when none is theirs to take). */
  nextStep: StepperAction | null;
  /** What a not-yet-active viewer may see of the round. */
  visibility: PaidAccessVisibility;
  /** The member's stepper headline ("Step 2 of 2: Waiting for admin approval"). */
  headline: string;
  /** The store's reason (rejected / revoked); "" otherwise. */
  reason: string;
};

const OPEN: AccessResult = { gated: false, status: null, canAccess: true, nextStep: null, visibility: "summary", headline: "", reason: "" };
const TERMINAL = new Set<PaidAccessStatus>(["expired", "cancelled", "rejected", "revoked"]);

/**
 * May `customerId` (null = anonymous) into `groupBuyId`? THROWS on a database
 * error: callers must treat a throw as "no access" (fail closed).
 */
export async function getAccess(input: { tenantId: string; groupBuyId: string; customerId: string | null; now?: Date }): Promise<AccessResult> {
  const now = input.now ?? new Date();
  if (!ID_RE.test(input.groupBuyId)) return { ...OPEN, gated: true, canAccess: false };
  const { enabled } = await paidAccessEnabled(input.tenantId);
  if (!enabled) return OPEN;
  return withTenant(input.tenantId, async (db): Promise<AccessResult> => {
    const flow = await findFlow(db, input.groupBuyId);
    // No saved settings = members only until the store sets the round up.
    const current = flow?.settings ?? UNCONFIGURED_SETTINGS;
    if (!requiresJoin(current)) return { ...OPEN, visibility: current.pendingVisibility };
    if (!input.customerId) {
      const view = stepperView(current, null, { amountLabel: "" });
      return { gated: true, status: null, canAccess: false, nextStep: view.action, visibility: current.pendingVisibility, headline: view.headline, reason: "" };
    }
    const m = await latestMembership(db, input.groupBuyId, input.customerId);
    const status = effectiveStatus(m, now);
    const rules = m && status && !TERMINAL.has(status) ? readSettings(m.settingsSnapshot) : current;
    const view = stepperView(rules, status, { amountLabel: "", reason: m?.reviewReason, canRejoin: status === "expired" || status === "cancelled" });
    return {
      gated: true,
      status,
      canAccess: hasAccess(status),
      nextStep: view.action,
      visibility: rules.pendingVisibility,
      headline: view.headline,
      reason: m?.reviewReason ?? "",
    };
  });
}

export type GatePolicy = {
  groupBuyId: string;
  gated: boolean;
  /** Can people join right now? false = not set up yet (or no longer valid). */
  ready: boolean;
  visibility: PaidAccessVisibility;
  steps: PaidAccessStep[];
  amountCents: number;
  maxSlots: number | null;
  slotsTaken: number;
  /** The join page's wording ("" fields = built-in). */
  copy: PaidAccessCopy;
};

/** Outer bound only: every settings save busts paidAccessTag. */
const POLICY_REVALIDATE_SECONDS = 3600;

async function readPolicies(tenantId: string): Promise<GatePolicy[]> {
  const flows = await withTenant(tenantId, (db) => listFlows(db));
  return flows.map((f) => ({
    groupBuyId: f.groupBuyId,
    gated: requiresJoin(f.settings),
    ready: flowReady(f.settings),
    visibility: f.settings.pendingVisibility,
    steps: f.settings.steps,
    amountCents: f.settings.payment.amountCents,
    maxSlots: f.maxSlots,
    slotsTaken: f.slotsTaken,
    copy: f.settings.copy,
  }));
}

/**
 * The store's saved round policies, for DISPLAY (cached). null = Paid Access is off
 * for the store (every round Open). Read one round with policyFor — a round
 * with no saved policy is gated. Anything that decides access calls getAccess.
 */
export async function gatePolicies(tenantId: string): Promise<GatePolicy[] | null> {
  const { enabled } = await paidAccessEnabled(tenantId);
  if (!enabled) return null;
  return unstable_cache(() => readPolicies(tenantId), ["paid-access-gate-policies", tenantId], {
    tags: [`tenant:${tenantId}`, paidAccessTag(tenantId)],
    revalidate: POLICY_REVALIDATE_SECONDS,
  })();
}

/** Live (uncached) twin of gatePolicies, for decisions like checkout. */
export async function gatePoliciesLive(tenantId: string): Promise<GatePolicy[] | null> {
  const { enabled } = await paidAccessEnabled(tenantId);
  return enabled ? readPolicies(tenantId) : null;
}

/**
 * One round's policy. null = Paid Access is off (Open). A round nobody has set up
 * gets the fail-closed default: gated, not ready, the default preset's steps.
 */
export function policyFor(policies: GatePolicy[] | null, groupBuyId: string): GatePolicy | null {
  if (!policies) return null;
  return (
    policies.find((p) => p.groupBuyId === groupBuyId) ?? {
      groupBuyId,
      gated: true,
      ready: false,
      visibility: UNCONFIGURED_SETTINGS.pendingVisibility,
      steps: UNCONFIGURED_SETTINGS.steps,
      amountCents: 0,
      maxSlots: null,
      slotsTaken: 0,
      copy: UNCONFIGURED_SETTINGS.copy,
    }
  );
}
