"use client";

// Per-tenant package-plan + lifecycle-status editor, shown as a card on the
// tenant Settings page (the "Change plan" links across the admin land here).
// A self-contained card with its own save flow, mirroring DomainManager:
// two selects (plan, status) → setTenantPlanAction → router.refresh() so the
// tenant header badge, MRR tile, and plan distribution reflect the change.
//
// Changing the plan re-gates the tenant's features (storefront entitlements are
// derived from the plan's feature set); changing status to Suspended takes the
// storefront offline — same kill-switch as the Suspend button.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ic, StatusBadge } from "@/components/admin/shell/primitives";
import { setTenantPlanAction } from "@/actions/admin";
import { PLAN_OPTIONS, STATUS_OPTIONS, canonicalPlanKey, statusLabel } from "@/lib/admin/plan-options";

type Props = {
  slug: string;
  /** Current stored plan key (canonical for DB + demo tenants). */
  planKey: string;
  /** Current Tenant.status (active | trial | suspended). */
  status: string;
};

export function PlanStatusManager({ slug, planKey, status }: Props) {
  const router = useRouter();
  const initialPlan = canonicalPlanKey(planKey);
  const [plan, setPlan] = useState<string>(initialPlan);
  const [stat, setStat] = useState<string>(status);
  const [baseline, setBaseline] = useState<{ plan: string; status: string }>({
    plan: initialPlan,
    status,
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = plan !== baseline.plan || stat !== baseline.status;
  const planLabel = PLAN_OPTIONS.find((o) => o.key === plan)?.label ?? plan;
  const statLabel = statusLabel(stat);
  // Operator-pickable statuses, plus the tenant's current status if it isn't one
  // of them (e.g. pending_setup) — so the select reflects reality and a plan-only
  // save round-trips the real status instead of clobbering it to "active".
  const statusChoices = STATUS_OPTIONS.some((o) => o.value === status)
    ? STATUS_OPTIONS
    : [{ value: status, label: statusLabel(status) }, ...STATUS_OPTIONS];

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await setTenantPlanAction(slug, plan, stat);
        if ("error" in res) {
          setError(res.error);
          return;
        }
        setBaseline({ plan, status: stat });
        setSaved(true);
        router.refresh();
      } catch {
        setError("Something went wrong saving. Please try again.");
      }
    });
  }

  function reset() {
    setPlan(baseline.plan);
    setStat(baseline.status);
    setError(null);
  }

  return (
    <section className="set-card" data-section="plan">
      <div className="set-card-head">
        <div>
          <span className="set-eyebrow">Plan</span>
          <h2>Plan &amp; status</h2>
          <p className="set-desc">
            The tenant&apos;s package and lifecycle status. Changing the plan re-gates which features the
            storefront can use and updates billing; setting status to <b>Suspended</b> takes the storefront
            offline immediately.
          </p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="badge badge-neutral">{planLabel}</span>
          <StatusBadge status={stat} />
        </div>
      </div>

      <div className="set-card-body">
        <div className="set-row">
          <div>
            <div className="set-row-label">Package plan</div>
            <div className="set-row-help">
              Determines pricing and the feature ceiling. Switching down locks features above the new tier.
            </div>
          </div>
          <div className="set-row-control">
            <label className="set-field">
              <span className="set-sublabel">Plan</span>
              <div className="set-select-wrap">
                <select
                  className="set-select"
                  value={plan}
                  aria-label="Package plan"
                  onChange={(e) => {
                    setPlan(e.target.value);
                    setSaved(false);
                    setError(null);
                  }}
                >
                  {PLAN_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          </div>
        </div>

        <div className="set-row">
          <div>
            <div className="set-row-label">Status</div>
            <div className="set-row-help">
              <b>Active</b> is live and billed. <b>Trial</b> is live but shown as a trial. <b>Suspended</b>{" "}
              bounces the storefront to the unknown-tenant page.
            </div>
          </div>
          <div className="set-row-control">
            <label className="set-field">
              <span className="set-sublabel">Lifecycle status</span>
              <div className="set-select-wrap">
                <select
                  className="set-select"
                  value={stat}
                  aria-label="Lifecycle status"
                  onChange={(e) => {
                    setStat(e.target.value);
                    setSaved(false);
                    setError(null);
                  }}
                >
                  {statusChoices.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          </div>
        </div>
      </div>

      <div className="set-foot">
        <span className="hint">
          <Ic.AlertCircle />
          This tenant will be on the <b>{planLabel}</b> plan · {statLabel}.
        </span>
        <div className="set-foot-actions">
          {error && (
            <span role="alert" className="set-err" style={{ alignSelf: "center" }}>
              {error}
            </span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={reset} disabled={!dirty || pending}>
            Reset
          </button>
          <button className="btn btn-accent btn-sm" onClick={save} disabled={!dirty || pending}>
            {pending ? "Saving…" : saved && !dirty ? (
              <>
                <Ic.Check /> Saved
              </>
            ) : (
              "Save plan"
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
