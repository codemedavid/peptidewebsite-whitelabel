/**
 * Pure derivation of a plan's FUNCTIONAL SCOPE from the catalog source of truth
 * (./catalog). No DB, no Next runtime — safe to import on the server (the
 * /admin/plans "Functional scope" panel) and to unit-test directly
 * (scripts/test-plan-scope.ts).
 *
 * The plan card's free-text `feats` are marketing copy; THIS module is what the
 * package actually grants. `getPlanScope` powers the read-only scope panel and
 * `bulletsFromScope` powers the "Generate bullets" button so the two never drift.
 */
import {
  FEATURES,
  FEATURE_GROUPS,
  FEATURE_META,
  OPERATOR_GRANTABLE,
  PLAN_FEATURES,
  planFeatureSet,
  type FeatureGroup,
  type FeatureKey,
} from "./catalog";

/**
 * - `included`             — in the plan ceiling and active once the tenant is on the plan.
 * - `included-needs-addon` — in the ceiling but inert until a master add-on switch is
 *                            granted (Sales Analytics slices → STORE_SALES_ANALYTICS;
 *                            Group Buy sub-capabilities → GB_MODULE).
 * - `addon`                — operator-grantable, OFF by default on every plan.
 */
export type FeatureState = "included" | "included-needs-addon" | "addon";

export interface ScopeFeature {
  key: FeatureKey;
  label: string;
  description: string;
  state: FeatureState;
  /** For `included-needs-addon`: the master switch this depends on. */
  dependsOn?: FeatureKey;
}

export interface ScopeGroup {
  group: FeatureGroup;
  features: ScopeFeature[];
}

export interface PlanScope {
  planKey: string;
  groups: ScopeGroup[];
  /** Features in the plan ceiling (`included` + `included-needs-addon`). */
  includedCount: number;
  /** Operator-grantable add-ons shown on the card (`addon`). */
  addonCount: number;
}

/** Lower tier per plan — drives the "Everything in X" lead bullet and the delta. */
const LOWER_TIER: Record<string, { key: string; label: string }> = {
  pro: { key: "starter", label: "Starter" },
  enterprise: { key: "pro", label: "Business" },
};

/** Catalog declaration order — stable, deterministic feature ordering. */
const FEATURE_ORDER = Object.values(FEATURES) as FeatureKey[];
const STATE_RANK: Record<FeatureState, number> = {
  included: 0,
  "included-needs-addon": 1,
  addon: 2,
};

/**
 * The master add-on switch a ceiling feature is gated behind, or null if it is
 * active as soon as the tenant is on the plan. Mirrors resolveGroupBuyCaps /
 * the Sales Analytics module gating documented in catalog.ts.
 */
function masterSwitchFor(key: FeatureKey): FeatureKey | null {
  if (key.startsWith("storefront.sales_analytics.")) return FEATURES.STORE_SALES_ANALYTICS;
  if (key.startsWith("groupbuy.") && key !== FEATURES.GB_MODULE && key !== FEATURES.GB_RULES) {
    return FEATURES.GB_MODULE;
  }
  return null;
}

function stateFor(key: FeatureKey, ceiling: ReadonlySet<FeatureKey>): { state: FeatureState; dependsOn?: FeatureKey } {
  // A feature in the plan ceiling IS granted by the plan — even if it is also
  // operator-grantable (e.g. Staff Accounts: in the Business/Automated ceiling,
  // but grantable on Starter). `addon` only applies when it is outside the ceiling.
  if (!ceiling.has(key) && OPERATOR_GRANTABLE.has(key)) return { state: "addon" };
  const master = masterSwitchFor(key);
  if (master) return { state: "included-needs-addon", dependsOn: master };
  return { state: "included" };
}

/**
 * The functional scope of a plan: every feature it grants (plus the
 * operator-grantable add-ons available on any plan), grouped and state-tagged.
 *
 * Pass `ceilingOverride` (the operator-edited set from plan-feature-config) to
 * reflect the live package contents instead of the hardcoded catalog default —
 * so the /admin/plans scope panel stays honest after an edit. Omit it and the
 * catalog default is used (handles aliases + unknown → starter).
 */
export function getPlanScope(planKey: string, ceilingOverride?: ReadonlySet<FeatureKey>): PlanScope {
  const ceiling = ceilingOverride ?? planFeatureSet(planKey);
  const display = new Set<FeatureKey>([...ceiling, ...OPERATOR_GRANTABLE]);

  const scoped: ScopeFeature[] = FEATURE_ORDER.filter((key) => display.has(key)).map((key) => {
    const meta = FEATURE_META[key];
    const { state, dependsOn } = stateFor(key, ceiling);
    return { key, label: meta.label, description: meta.description, state, dependsOn };
  });

  const groups: ScopeGroup[] = FEATURE_GROUPS.map((group) => ({
    group,
    features: scoped
      .filter((f) => FEATURE_META[f.key].group === group)
      .sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]),
  })).filter((g) => g.features.length > 0);

  const includedCount = scoped.filter((f) => f.state !== "addon").length;
  const addonCount = scoped.filter((f) => f.state === "addon").length;

  return { planKey, groups, includedCount, addonCount };
}

/** Cut to `max` chars, appending an ellipsis when truncated (result stays <= max). */
function clamp(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

const MAX_BULLET_LEN = 160; // matches normalizePlanConfig
const MAX_BULLETS = 12; // matches normalizePlanConfig

/**
 * Delta-aware marketing bullets derived from the plan's real ceiling:
 * "Everything in <lower tier>" + one concise "<Group>: a, b, c" bullet per group
 * the plan adds over the tier below.
 *
 * Honest by construction: only features that are ACTIVE by default on the plan
 * (state `included`) are advertised. Features gated behind an operator add-on
 * that is OFF by default (`included-needs-addon` such as Group Buy / Sales
 * Analytics, and `addon`) are deliberately excluded so a card never claims a
 * capability the tenant must be granted first. Respects the plan-config limits.
 */
export function bulletsFromScope(planKey: string): string[] {
  const lower = LOWER_TIER[planKey];
  const lowerCeiling = lower && PLAN_FEATURES[lower.key] ? planFeatureSet(lower.key) : new Set<FeatureKey>();
  const activeByKey = new Map(
    getPlanScope(planKey).groups.flatMap((g) => g.features.map((f) => [f.key, f.state] as const)),
  );

  const bullets: string[] = [];
  if (lower) bullets.push(`Everything in ${lower.label}`);

  for (const group of FEATURE_GROUPS) {
    const labels = FEATURE_ORDER.filter(
      (key) =>
        activeByKey.get(key) === "included" &&
        !lowerCeiling.has(key) &&
        FEATURE_META[key].group === group,
    ).map((key) => FEATURE_META[key].label);
    if (labels.length === 0) continue;
    bullets.push(clamp(`${group}: ${labels.join(", ")}`, MAX_BULLET_LEN));
    if (bullets.length >= MAX_BULLETS) break;
  }

  return bullets.slice(0, MAX_BULLETS);
}
