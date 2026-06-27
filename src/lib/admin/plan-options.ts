/**
 * Option lists + validators for the Super Admin "Plan & status" editor (the
 * per-tenant control that reassigns a tenant's package plan and status).
 *
 * Single source of truth for what the <select>s offer and what the server
 * action will accept. Plan labels are derived from PLAN_META (lib/admin/plans)
 * so they never drift; statuses mirror the Tenant.status values used across the
 * app (active | trial | suspended). Client-safe: pure, no fs/prisma imports.
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

/** Tenant lifecycle statuses, mirroring Tenant.status across the app. */
export const TENANT_STATUSES = ["active", "trial", "suspended"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export type StatusOption = { value: string; label: string };

const STATUS_LABELS: Record<TenantStatus, string> = {
  active: "Active",
  trial: "Trial",
  suspended: "Suspended",
};

/** Status choices for the editor — Active / Trial / Suspended. */
export const STATUS_OPTIONS: StatusOption[] = TENANT_STATUSES.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));

/** True only for a canonical plan key. Aliases and display labels are rejected:
 *  the action must persist exactly what the <select> emits, never a guessed value. */
export function isValidPlanKey(key: string): key is PlanKey {
  return (CANONICAL_PLAN_KEYS as readonly string[]).includes(key);
}

/** True only for a known Tenant.status value. */
export function isValidStatus(status: string): status is TenantStatus {
  return (TENANT_STATUSES as readonly string[]).includes(status);
}

/** Normalize any stored plan key (incl. legacy aliases like "business" /
 *  "growth") to its canonical key, so a tenant's current plan selects the right
 *  <option>. Falls back to "starter" for unknown input — never throws. */
export function canonicalPlanKey(key: string): PlanKey {
  return planMeta(key).key as PlanKey;
}
