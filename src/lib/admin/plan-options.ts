/**
 * Option lists + validators for the Super Admin "Plan & status" editor (the
 * per-tenant control that reassigns a tenant's package plan and status).
 *
 * Single source of truth for what the <select>s offer and what the server
 * action will accept. Plan labels are derived from PLAN_META (lib/admin/plans)
 * so they never drift. Two status sets are intentional: STATUS_OPTIONS is what
 * an operator can *pick*, while KNOWN_TENANT_STATUSES is the full set the action
 * *accepts* — broader so a plan-only edit round-trips a system-managed status
 * (e.g. pending_setup for an unpublished store) instead of being rejected.
 * Client-safe: pure, no fs/prisma imports.
 */

import { PLAN_META, planMeta } from "@/lib/admin/plans";

/** Canonical plan keys, in tier order. These are exactly the keys the
 *  <select> emits and the only ones the action persists to Tenant.planId. */
const CANONICAL_PLAN_KEYS = ["starter", "pro", "enterprise"] as const;
export type PlanKey = (typeof CANONICAL_PLAN_KEYS)[number];

export type PlanOption = { key: string; label: string };

/** Plan choices for the editor — Starter / Business / Automated, in tier order.
 *  Labels come straight from PLAN_META so the editor matches every other surface. */
export const PLAN_OPTIONS: PlanOption[] = CANONICAL_PLAN_KEYS.map((key) => ({
  key,
  label: PLAN_META[key].label,
}));

/** Statuses an operator can actively pick in the editor dropdown. */
export const TENANT_STATUSES = ["active", "trial", "suspended"] as const;

/** Every Tenant.status value the app legitimately stores. Mirrors the
 *  TenantStatus union in lib/admin/data.ts, plus the DB-only `pending_setup`
 *  used for self-onboarded stores before they're published. The action
 *  validates against this (not just the pickable set) so a plan-only edit can
 *  round-trip a system status instead of erroring "Unknown status." */
export const KNOWN_TENANT_STATUSES = [
  "active",
  "trial",
  "suspended",
  "past_due",
  "pending",
  "canceled",
  "pending_setup",
] as const;

export type StatusOption = { value: string; label: string };

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trial: "Trial",
  suspended: "Suspended",
  past_due: "Past due",
  pending: "Pending",
  canceled: "Canceled",
  pending_setup: "Pending setup",
};

/** Operator-pickable status choices for the editor — Active / Trial / Suspended. */
export const STATUS_OPTIONS: StatusOption[] = TENANT_STATUSES.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));

/** Humanized label for any stored status; falls back to the raw value so the
 *  editor can always represent a tenant's current status, even an odd one. */
export function statusLabel(value: string): string {
  return STATUS_LABELS[value] ?? value;
}

/** True only for a canonical plan key. Aliases and display labels are rejected:
 *  the action must persist exactly what the <select> emits, never a guessed value. */
export function isValidPlanKey(key: string): key is PlanKey {
  return (CANONICAL_PLAN_KEYS as readonly string[]).includes(key);
}

/** True for any Tenant.status value the app legitimately stores — the server
 *  action's guard. Broader than the dropdown so a plan-only edit can round-trip
 *  a system-managed status (e.g. pending_setup) without being rejected. */
export function isValidStatus(status: string): boolean {
  return (KNOWN_TENANT_STATUSES as readonly string[]).includes(status);
}

/** Normalize any stored plan key (incl. legacy aliases like "business" /
 *  "growth") to its canonical key, so a tenant's current plan selects the right
 *  <option>. Falls back to "starter" for unknown input — never throws. */
export function canonicalPlanKey(key: string): PlanKey {
  return planMeta(key).key as PlanKey;
}
