// Tenant feature toggles — the pure core behind the MCP connector's
// list_whitelabel_features / set_whitelabel_features tools.
//
// The admin Features editor (admin → tenants → features) has always been the
// only way to move a tenant's entitlements. This module is the same decision,
// extracted so a remote caller can make it without a browser — and so the rules
// that keep it safe are testable in isolation (npm run test:mcp-features).
//
// Entitlements are the single most dangerous thing the connector touches, so
// four rules carry the design:
//
//   IT NEVER GRANTS BEYOND THE PACKAGE. `lockedByPlan` here is character-for-
//   character the admin editor's rule — outside the plan ceiling AND not
//   operator-grantable. Without it the connector would be a way to talk a
//   Starter tenant into Automated features.
//
//   IT IS ALL-OR-NOTHING. One bad name refuses the whole batch. The agent
//   cannot see the store, so a half-applied entitlement change reported as
//   success is worse than an error.
//
//   IT RESOLVES HUMAN NAMES, BUT REFUSES AMBIGUOUS ONES. Operators say "group
//   buy system", not "groupbuy.module". Two features are both labelled "Excel
//   export" (Sales Analytics and Group Buy); guessing between them silently
//   toggles the wrong module, so an ambiguous name is an error that names every
//   candidate.
//
//   IT REPORTS WHAT IT ACTUALLY DID. Already-on is "unchanged", never a fake
//   change. A toggle back to the plan default is flagged so the writer DELETES
//   the override row instead of persisting a redundant one — exactly what
//   setTenantFeatureAction does.
//
// Pure (no Prisma, no React, no Next) so the route, the server action, a script
// and the test all share one contract.

import {
  ALL_FEATURES,
  FEATURES,
  FEATURE_GROUPS,
  FEATURE_META,
  OPERATOR_GRANTABLE,
  planFeatureSet,
  type FeatureGroup,
  type FeatureKey,
} from "@/lib/features/catalog";
import { masterSwitchFor } from "@/lib/features/plan-scope";
import { planMeta } from "@/lib/admin/plans";

/** Tier order, lowest first — drives "which plan would include this?". */
const PLAN_TIERS = ["starter", "pro", "enterprise"] as const;

/** A batch bigger than the catalog is a malformed call, not a big request. */
const MAX_BATCH = ALL_FEATURES.length;

export type FeatureResolution =
  | { ok: true; key: FeatureKey }
  | { ok: false; reason: "unknown" | "ambiguous"; candidates: FeatureKey[] };

export type FeatureChange = {
  key: FeatureKey;
  label: string;
  enabled: boolean;
  /**
   * true ⇒ the requested state IS the plan default, so the writer must DELETE
   * any override row rather than store one. false ⇒ upsert an override.
   */
  matchesPlanDefault: boolean;
};

export type FeatureState = { key: FeatureKey; label: string; enabled: boolean };

export type FeatureTogglePlan = {
  changes: FeatureChange[];
  /** Requested but already in that state — no write, and never a fake change. */
  unchanged: FeatureState[];
  /** Non-empty ⇒ refuse the whole batch. */
  errors: string[];
  /** Advisory only (inert combinations). Never blocks. */
  warnings: string[];
};

export type FeatureInventoryItem = {
  key: FeatureKey;
  label: string;
  description: string;
  group: FeatureGroup;
  enabled: boolean;
  /** The admin editor's rule: outside the ceiling and not operator-grantable. */
  lockedByPlan: boolean;
  requiredPlanLabel: string | null;
  /** Master switch this feature is inert without, if any. */
  dependsOn: FeatureKey | null;
};

export type FeatureInventory = {
  planKey: string;
  planLabel: string;
  groups: { group: FeatureGroup; features: FeatureInventoryItem[] }[];
  enabledCount: number;
  total: number;
};

/** Fold a spoken name, a constant name and a catalog key onto one token. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Every way an operator might name a feature → the keys it could mean.
 * Exact catalog keys are indexed separately so they always win: a label
 * collision must never shadow a key the caller spelled out in full.
 */
const EXACT_KEYS = new Map<string, FeatureKey>(
  ALL_FEATURES.map((key) => [normalize(key), key as FeatureKey]),
);

const ALIASES: Map<string, FeatureKey[]> = (() => {
  const index = new Map<string, FeatureKey[]>();
  const add = (token: string, key: FeatureKey) => {
    const slot = index.get(token);
    if (!slot) index.set(token, [key]);
    else if (!slot.includes(key)) slot.push(key);
  };
  for (const [constant, key] of Object.entries(FEATURES) as [string, FeatureKey][]) {
    add(normalize(constant), key);
    add(normalize(FEATURE_META[key].label), key);
  }
  return index;
})();

/**
 * Resolve one operator-supplied name to a catalog key. Exact key → constant
 * name (GB_MODULE) → human label ("Group buy system"). Anything matching more
 * than one feature is refused rather than guessed.
 */
export function resolveFeatureKey(value: unknown): FeatureResolution {
  const token = normalize(typeof value === "string" ? value : "");
  if (!token) return { ok: false, reason: "unknown", candidates: [] };

  const exact = EXACT_KEYS.get(token);
  if (exact) return { ok: true, key: exact };

  const candidates = ALIASES.get(token) ?? [];
  if (candidates.length === 1) return { ok: true, key: candidates[0] };
  if (candidates.length > 1) return { ok: false, reason: "ambiguous", candidates };
  return { ok: false, reason: "unknown", candidates: [] };
}

/** The lowest tier whose ceiling includes `key`, or null if no plan has it. */
export function requiredPlanFor(key: FeatureKey): string | null {
  return PLAN_TIERS.find((tier) => planFeatureSet(tier).has(key)) ?? null;
}

function labelOf(key: FeatureKey): string {
  return FEATURE_META[key].label;
}

/** Parse one enable/disable list, collecting a precise error per bad entry. */
function readList(
  value: unknown,
  field: "enable" | "disable",
  errors: string[],
): FeatureKey[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push(`${field} must be a list of feature names, e.g. ["groupbuy.module"].`);
    return [];
  }
  if (value.length > MAX_BATCH) {
    errors.push(`${field} has ${value.length} entries; the catalog only has ${MAX_BATCH}.`);
    return [];
  }

  const keys: FeatureKey[] = [];
  value.forEach((entry, i) => {
    const at = `${field}[${i}]`;
    if (typeof entry !== "string" || !entry.trim()) {
      errors.push(`${at}: expected a feature name, got ${JSON.stringify(entry)}.`);
      return;
    }
    const resolved = resolveFeatureKey(entry);
    if (resolved.ok) {
      keys.push(resolved.key);
      return;
    }
    if (resolved.reason === "ambiguous") {
      errors.push(
        `${at}: "${entry.trim()}" matches more than one feature (${resolved.candidates.join(", ")}) — send the exact key.`,
      );
      return;
    }
    errors.push(
      `${at}: unknown feature "${entry.trim()}". Call list_whitelabel_features to see the exact keys, e.g. ${FEATURES.GB_MODULE}.`,
    );
  });
  return keys;
}

export type FeatureTogglePlanInput = {
  planKey: string;
  /** The tenant's RESOLVED entitlements (plan ∪ grants − revocations). */
  current: ReadonlySet<string>;
  enable?: unknown;
  disable?: unknown;
  /** Operator-edited plan ceiling; defaults to the catalog's. */
  ceiling?: ReadonlySet<FeatureKey>;
};

/**
 * Turn an operator's request into the exact set of writes, or into errors.
 * `changes` is empty whenever `errors` is non-empty — callers must never
 * partially apply a refused batch.
 */
export function buildFeatureTogglePlan(input: FeatureTogglePlanInput): FeatureTogglePlan {
  const ceiling = input.ceiling ?? planFeatureSet(input.planKey);
  const planLabel = planMeta(input.planKey).label;
  const errors: string[] = [];

  const enable = readList(input.enable, "enable", errors);
  const disable = readList(input.disable, "disable", errors);

  if (!errors.length && !enable.length && !disable.length) {
    errors.push(
      "Nothing to change — send at least one feature name in enable or disable.",
    );
  }

  // Contradictions: the same feature asked on AND off in one call. Applying
  // either side would be a coin flip the operator never asked for.
  const disableSet = new Set<FeatureKey>(disable);
  for (const key of new Set(enable)) {
    if (disableSet.has(key)) {
      errors.push(`"${key}" (${labelOf(key)}) is in both enable and disable — pick one.`);
    }
  }

  // The package ceiling. Identical rule to the admin Features editor, so what
  // the connector refuses is exactly what the editor renders locked.
  for (const key of new Set([...enable, ...disable])) {
    if (ceiling.has(key) || OPERATOR_GRANTABLE.has(key)) continue;
    const required = requiredPlanFor(key);
    errors.push(
      required
        ? `"${key}" (${labelOf(key)}) is not part of the ${planLabel} package — it needs the ${planMeta(required).label} plan. Change the tenant's plan first.`
        : `"${key}" (${labelOf(key)}) is not available on any plan.`,
    );
  }

  if (errors.length) return { changes: [], unchanged: [], errors, warnings: [] };

  const desired = new Map<FeatureKey, boolean>();
  for (const key of enable) desired.set(key, true);
  for (const key of disable) desired.set(key, false);

  const changes: FeatureChange[] = [];
  const unchanged: FeatureState[] = [];
  for (const [key, enabled] of desired) {
    if (input.current.has(key) === enabled) {
      unchanged.push({ key, label: labelOf(key), enabled });
      continue;
    }
    changes.push({
      key,
      label: labelOf(key),
      enabled,
      matchesPlanDefault: ceiling.has(key) === enabled,
    });
  }

  return { changes, unchanged, errors, warnings: warningsFor(changes, input.current) };
}

/**
 * Inert combinations. Neither blocks the write — the operator may be granting a
 * module in two calls — but an agent that cannot see the store would otherwise
 * report "Excel export is on" for a switch that renders nothing.
 */
function warningsFor(changes: FeatureChange[], current: ReadonlySet<string>): string[] {
  const next = new Set<string>(current);
  for (const change of changes) {
    if (change.enabled) next.add(change.key);
    else next.delete(change.key);
  }

  const warnings: string[] = [];
  for (const change of changes) {
    if (!change.enabled) continue;
    const master = masterSwitchFor(change.key);
    if (master && !next.has(master)) {
      warnings.push(
        `"${change.key}" (${change.label}) stays inert until "${master}" (${labelOf(master)}) is also on.`,
      );
    }
  }

  for (const change of changes) {
    if (change.enabled) continue;
    const stranded = ALL_FEATURES.filter(
      (key) => masterSwitchFor(key as FeatureKey) === change.key && next.has(key),
    );
    if (stranded.length) {
      warnings.push(
        `Turning "${change.key}" (${change.label}) off leaves ${stranded.length} enabled capabilit${stranded.length === 1 ? "y" : "ies"} inert: ${stranded.join(", ")}.`,
      );
    }
  }

  return warnings;
}

/**
 * The tenant's whole feature sheet, grouped the way admin → Features groups it,
 * so an operator can ask "what's on for k-glow?" and get an answer that matches
 * the screen they'd otherwise open.
 */
export function buildFeatureInventory(input: {
  planKey: string;
  current: ReadonlySet<string>;
  ceiling?: ReadonlySet<FeatureKey>;
}): FeatureInventory {
  const ceiling = input.ceiling ?? planFeatureSet(input.planKey);

  const items: FeatureInventoryItem[] = ALL_FEATURES.map((k) => {
    const key = k as FeatureKey;
    const lockedByPlan = !ceiling.has(key) && !OPERATOR_GRANTABLE.has(key);
    const required = lockedByPlan ? requiredPlanFor(key) : null;
    return {
      key,
      label: FEATURE_META[key].label,
      description: FEATURE_META[key].description,
      group: FEATURE_META[key].group,
      enabled: input.current.has(key),
      lockedByPlan,
      requiredPlanLabel: required ? planMeta(required).label : null,
      dependsOn: masterSwitchFor(key),
    };
  });

  const groups = FEATURE_GROUPS.map((group) => ({
    group,
    features: items.filter((f) => f.group === group),
  })).filter((g) => g.features.length > 0);

  return {
    planKey: input.planKey,
    planLabel: planMeta(input.planKey).label,
    groups,
    enabledCount: items.filter((f) => f.enabled).length,
    total: items.length,
  };
}
