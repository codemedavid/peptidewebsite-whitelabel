"use client";

// Super Admin "Package contents" editor on the Plans & Billing page — the
// operator picks which catalog functionalities each package (Starter / Business
// / Automated) includes. Edits are local until "Save changes"; saving persists
// via savePlanFeaturesConfigAction, which reconciles the DB plan→feature ceiling
// so entitlements resolve to the new contents for every tenant on that plan
// (their per-tenant overrides still win). Each package is edited independently —
// removing a feature from Business does not cascade to Automated.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ic } from "@/components/admin/shell/primitives";
import { useAdminUI } from "@/components/admin/shell/AdminShell";
import {
  FEATURE_GROUPS,
  FEATURE_META,
  OPERATOR_GRANTABLE,
  type FeatureGroup,
  type FeatureKey,
} from "@/lib/features/catalog";
import { planMeta } from "@/lib/admin/plans";
import { savePlanFeaturesConfigAction } from "@/actions/admin-plan-features";
import {
  CONFIG_PLAN_KEYS,
  defaultPlanFeatureConfig,
  type ConfigPlanKey,
  type PlanFeatureConfig,
} from "@/lib/platform/plan-feature-config";

type Selection = Record<ConfigPlanKey, Set<string>>;

function toSelection(config: PlanFeatureConfig): Selection {
  return {
    starter: new Set(config.plans.starter),
    pro: new Set(config.plans.pro),
    enterprise: new Set(config.plans.enterprise),
  };
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={`ftr-tgl${on ? " on" : ""}`}
    />
  );
}

const GROUPED_FEATURES: ReadonlyArray<readonly [FeatureGroup, FeatureKey[]]> = FEATURE_GROUPS.map(
  (group) => [
    group,
    (Object.keys(FEATURE_META) as FeatureKey[]).filter((k) => FEATURE_META[k].group === group),
  ] as const,
).filter(([, keys]) => keys.length > 0);

export function PlanFeaturesEditor({
  initial,
  newFeatures = [],
}: {
  initial: PlanFeatureConfig;
  /** Feature keys currently flagged "New" (auto-detected additions + kept flags). */
  newFeatures?: string[];
}) {
  const router = useRouter();
  const { showToast } = useAdminUI();
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<Selection>(() => toSelection(initial));
  const [active, setActive] = useState<ConfigPlanKey>("starter");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "New" tags the operator is keeping. Dismissing one drops it here and, on save,
  // stops store owners seeing the tag. Starts from the server's effective-new set.
  const [newSet, setNewSet] = useState<Set<string>>(() => new Set(newFeatures));

  function dismissNew(key: string) {
    setNewSet((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });
    setDirty(true);
  }

  const activeSet = sel[active];

  function mutate(planKey: ConfigPlanKey, fn: (next: Set<string>) => void) {
    setSel((s) => {
      const next = new Set(s[planKey]);
      fn(next);
      return { ...s, [planKey]: next };
    });
    setDirty(true);
    setError(null);
  }

  function toggle(planKey: ConfigPlanKey, key: FeatureKey) {
    mutate(planKey, (next) => (next.has(key) ? next.delete(key) : next.add(key)));
  }

  function setGroup(planKey: ConfigPlanKey, keys: FeatureKey[], value: boolean) {
    mutate(planKey, (next) => keys.forEach((k) => (value ? next.add(k) : next.delete(k))));
  }

  function resetPlan(planKey: ConfigPlanKey) {
    setSel((s) => ({ ...s, [planKey]: new Set(defaultPlanFeatureConfig().plans[planKey]) }));
    setDirty(true);
    setError(null);
  }

  function save() {
    setError(null);
    const empty = CONFIG_PLAN_KEYS.find((k) => sel[k].size === 0);
    if (empty) {
      const msg = `The ${planMeta(empty).label} package needs at least one included feature.`;
      setError(msg);
      showToast(msg);
      setActive(empty);
      return;
    }
    startTransition(async () => {
      const res = await savePlanFeaturesConfigAction(
        {
          plans: {
            starter: [...sel.starter] as FeatureKey[],
            pro: [...sel.pro] as FeatureKey[],
            enterprise: [...sel.enterprise] as FeatureKey[],
          },
        },
        [...newSet],
      );
      if ("error" in res) {
        setError(res.error);
        showToast(res.error);
      } else {
        setDirty(false);
        showToast("Package contents saved & entitlements synced.");
        router.refresh();
      }
    });
  }

  const totalFeatures = useMemo(() => Object.keys(FEATURE_META).length, []);

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Package contents</h1>
          <p className="page-sub">
            Choose which functionalities each package includes. Saving updates every tenant on that
            plan — individual per-tenant overrides still win. Each package is edited independently.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {newSet.size > 0 && (
            <span className="badge badge-accent" title="Newly-added functionalities awaiting review">
              {newSet.size} New
            </span>
          )}
          {dirty && <span className="badge badge-warn">Unsaved changes</span>}
          <button className="btn btn-accent" onClick={save} disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--danger)" }}>
          <div className="card-body" style={{ padding: 14, fontSize: 13, color: "var(--danger)" }}>
            <Ic.AlertCircle style={{ width: 14, height: 14, verticalAlign: "-2px", marginRight: 6 }} />
            {error}
          </div>
        </div>
      )}

      <div className="ftr-seg" role="tablist" aria-label="Package" style={{ marginBottom: 16 }}>
        {CONFIG_PLAN_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={active === k}
            className={active === k ? "on" : undefined}
            onClick={() => setActive(k)}
          >
            {planMeta(k).label}
            <span className="tnum muted" style={{ marginLeft: 6, fontSize: 11.5 }}>
              {sel[k].size}
            </span>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <h3 className="card-title">{planMeta(active).label} package</h3>
          <div className="row" style={{ gap: 10 }}>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {activeSet.size} of {totalFeatures} features included
            </span>
            <button className="btn btn-sm" onClick={() => resetPlan(active)} disabled={pending}>
              <Ic.Refresh /> Reset to default
            </button>
          </div>
        </div>

        <div>
          {GROUPED_FEATURES.map(([group, keys]) => {
            const onCount = keys.filter((k) => activeSet.has(k)).length;
            const allOn = onCount === keys.length;
            return (
              <div key={group} style={{ borderTop: "1px solid var(--border-soft)" }}>
                <div
                  className="row"
                  style={{ justifyContent: "space-between", padding: "10px 18px", background: "var(--surface-2, transparent)" }}
                >
                  <span
                    className="muted"
                    style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}
                  >
                    {group}
                    <span className="tnum" style={{ marginLeft: 8, opacity: 0.7 }}>
                      {onCount}/{keys.length}
                    </span>
                  </span>
                  <button
                    className="btn btn-sm"
                    onClick={() => setGroup(active, keys, !allOn)}
                    style={{ fontSize: 11.5 }}
                  >
                    {allOn ? "Disable all" : "Enable all"}
                  </button>
                </div>
                {keys.map((k) => {
                  const meta = FEATURE_META[k];
                  const on = activeSet.has(k);
                  const isAddon = OPERATOR_GRANTABLE.has(k);
                  return (
                    <div
                      key={k}
                      className="row"
                      style={{ gap: 12, alignItems: "center", padding: "10px 18px", borderTop: "1px solid var(--border-soft)" }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row" style={{ gap: 8 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink-900)" }}>
                            {meta.label}
                          </span>
                          {newSet.has(k) && (
                            <span
                              className="badge badge-accent"
                              style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: 4 }}
                              title="New functionality — store owners see a 'New' tag while this is on. Assign it to packages, then dismiss when ready."
                            >
                              New
                              <button
                                type="button"
                                onClick={() => dismissNew(k)}
                                aria-label={`Dismiss New tag for ${meta.label}`}
                                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, color: "inherit", display: "inline-flex" }}
                              >
                                <Ic.X style={{ width: 10, height: 10 }} />
                              </button>
                            </span>
                          )}
                          {isAddon && (
                            <span
                              className="badge"
                              style={{ fontSize: 10 }}
                              title="Normally an operator-granted add-on (off by default). Including it here makes it default-on for this package."
                            >
                              Add-on
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 2 }}>{meta.description}</div>
                      </div>
                      <code className="mono" style={{ fontSize: 10.5, color: "var(--ink-400)" }}>
                        {k}
                      </code>
                      <Toggle on={on} label={`Include ${meta.label} in ${planMeta(active).label}`} onChange={() => toggle(active, k)} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
