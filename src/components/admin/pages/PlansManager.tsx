"use client";

// Super Admin editor for plan pricing + feature bullets, rendered on the
// Plans & Billing page. Edits are local until "Save changes"; saving persists
// via savePlanConfigAction (demo file / platform_settings row) — which also
// reconciles the DB plan→feature ceiling to the catalog — and flows to the
// marketing pricing section, the get-started wizard, the create-tenant drawer,
// and the one-time revenue totals. Plan names stay fixed — they're identity keys.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ic } from "@/components/admin/shell/primitives";
import { useAdminUI } from "@/components/admin/shell/AdminShell";
import { savePlanConfigAction } from "@/actions/admin-plan-config";
import { defaultPlanConfig, type PlanConfig } from "@/lib/platform/plan-config";
import { formatPesos, formatPesosCompact } from "@/lib/admin/plans";
import type { PlanRow } from "@/lib/admin/data";
import { getPlanScope, bulletsFromScope } from "@/lib/features/plan-scope";
import { PlanScopePanel } from "@/components/admin/pages/PlanScopePanel";
import { resolvePlanCeiling, type PlanFeatureConfig } from "@/lib/platform/plan-feature-config";

const money = formatPesosCompact;
const MAX_FEATS = 12;

let nextId = 0;
type FeatRow = { id: number; text: string };
type PlanDraft = {
  key: string;
  name: string;
  priceText: string; // pesos, free-form while typing
  discountText: string; // optional promo price in pesos ("" = none)
  blurb: string;
  tag: string;
  feats: FeatRow[];
};

function toDrafts(config: PlanConfig): PlanDraft[] {
  return config.plans.map((p) => ({
    key: p.key,
    name: p.name,
    priceText: String(p.priceCents / 100),
    discountText: p.discountPriceCents ? String(p.discountPriceCents / 100) : "",
    blurb: p.blurb,
    tag: p.tag,
    feats: p.feats.map((text) => ({ id: ++nextId, text })),
  }));
}

function draftPriceCents(d: PlanDraft): number {
  const pesos = Number(d.priceText);
  return Number.isFinite(pesos) ? Math.round(pesos * 100) : 0;
}

// 0 = no discount (empty/invalid field).
function draftDiscountCents(d: PlanDraft): number {
  if (d.discountText.trim() === "") return 0;
  const pesos = Number(d.discountText);
  return Number.isFinite(pesos) && pesos > 0 ? Math.round(pesos * 100) : 0;
}

export function PlansManager({
  initial,
  rows,
  revenueCents,
  activeCount,
  featureConfig,
}: {
  initial: PlanConfig;
  rows: PlanRow[];
  revenueCents: number;
  activeCount: number;
  /** Operator-edited plan ceiling — makes the read-only scope panel honest. */
  featureConfig?: PlanFeatureConfig;
}) {
  const router = useRouter();
  const { showToast } = useAdminUI();
  const [pending, startTransition] = useTransition();
  const [plans, setPlans] = useState<PlanDraft[]>(() => toDrafts(initial));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalTenants = rows.reduce((s, r) => s + r.count, 0);

  function patchPlan(key: string, patch: Partial<PlanDraft>) {
    setPlans((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
    setDirty(true);
  }

  function patchFeat(key: string, id: number, text: string) {
    setPlans((ps) =>
      ps.map((p) =>
        p.key === key ? { ...p, feats: p.feats.map((f) => (f.id === id ? { ...f, text } : f)) } : p,
      ),
    );
    setDirty(true);
  }

  function moveFeat(key: string, id: number, dir: -1 | 1) {
    setPlans((ps) =>
      ps.map((p) => {
        if (p.key !== key) return p;
        const i = p.feats.findIndex((f) => f.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= p.feats.length) return p;
        const feats = [...p.feats];
        [feats[i], feats[j]] = [feats[j], feats[i]];
        return { ...p, feats };
      }),
    );
    setDirty(true);
  }

  function removeFeat(key: string, id: number) {
    setPlans((ps) => ps.map((p) => (p.key === key ? { ...p, feats: p.feats.filter((f) => f.id !== id) } : p)));
    setDirty(true);
  }

  function addFeat(key: string) {
    setPlans((ps) =>
      ps.map((p) =>
        p.key === key && p.feats.length < MAX_FEATS
          ? { ...p, feats: [...p.feats, { id: ++nextId, text: "" }] }
          : p,
      ),
    );
    setDirty(true);
  }

  // Fill the marketing bullets from the plan's real functional scope (honest by
  // construction — only default-active features). One-way helper: nothing saves
  // until the operator clicks "Save changes".
  function generateBullets(key: string) {
    const plan = plans.find((p) => p.key === key);
    const hasCopy = plan?.feats.some((f) => f.text.trim());
    if (hasCopy && !window.confirm("Replace this plan's feature bullets with ones generated from its functional scope?")) {
      return;
    }
    const bullets = bulletsFromScope(key).map((text) => ({ id: ++nextId, text }));
    setPlans((ps) => ps.map((p) => (p.key === key ? { ...p, feats: bullets } : p)));
    setDirty(true);
  }

  function reset() {
    setPlans(toDrafts(defaultPlanConfig()));
    setDirty(true);
    setError(null);
  }

  function save() {
    setError(null);
    for (const p of plans) {
      if (draftPriceCents(p) <= 0) {
        const msg = `${p.name} needs a monthly price above ₱0.`;
        setError(msg);
        showToast(msg);
        return;
      }
      const discount = draftDiscountCents(p);
      if (discount > 0 && discount >= draftPriceCents(p)) {
        const msg = `${p.name}'s discount price must be below its monthly price.`;
        setError(msg);
        showToast(msg);
        return;
      }
      if (!p.feats.some((f) => f.text.trim())) {
        const msg = `${p.name} needs at least one feature bullet.`;
        setError(msg);
        showToast(msg);
        return;
      }
    }
    startTransition(async () => {
      const res = await savePlanConfigAction({
        // Not edited here (yet) — carried through so saving plans never resets
        // an operator-set trial price back to the default.
        trialPriceCents: initial.trialPriceCents,
        plans: plans.map((p) => {
          const discount = draftDiscountCents(p);
          return {
            key: p.key,
            name: p.name,
            priceCents: draftPriceCents(p),
            ...(discount > 0 ? { discountPriceCents: discount } : {}),
            blurb: p.blurb,
            tag: p.tag,
            feats: p.feats.map((f) => f.text.trim()).filter(Boolean),
          };
        }),
      });
      if ("error" in res) {
        setError(res.error);
        showToast(res.error);
      } else {
        setDirty(false);
        showToast("Plans saved & feature scope synced.");
        router.refresh(); // re-pull revenue + distribution with the new prices
      }
    });
  }

  const kpis = [
    { label: "Total revenue", value: money(revenueCents), icon: Ic.DollarSign },
    { label: "Active sites", value: activeCount.toLocaleString(), icon: Ic.Card },
  ];

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Plans &amp; Billing</h1>
          <p className="page-sub">
            Plan mix and one-time revenue across {totalTenants} tenants. Prices and
            features here drive the marketing pricing, the get-started wizard, and new-tenant billing.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {dirty && <span className="badge badge-warn">Unsaved changes</span>}
          <button className="btn" onClick={reset} disabled={pending}>
            Reset to defaults
          </button>
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

      <div className="grid-2-eq mb-4">
        {kpis.map((k) => (
          <div key={k.label} className="kpi">
            <div className="kpi-label">
              <k.icon /> {k.label}
            </div>
            <div className="kpi-value">{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }} className="grid-3">
        {plans.map((p) => {
          const row = rows.find((r) => r.key === p.key);
          const share = totalTenants && row ? Math.round((row.count / totalTenants) * 100) : 0;
          const cents = draftPriceCents(p);
          const discountCents = draftDiscountCents(p);
          const showDiscount = discountCents > 0 && discountCents < cents;
          return (
            <div key={p.key} className="card">
              <div className="card-body">
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <div className="plan-name" style={{ fontSize: 15 }}>
                    {p.name}
                  </div>
                  <input
                    className="input"
                    style={{ width: 130, fontSize: 12 }}
                    value={p.tag}
                    maxLength={40}
                    placeholder="Badge — e.g. Popular"
                    onChange={(e) => patchPlan(p.key, { tag: e.target.value })}
                  />
                </div>
                <div className="plan-price" style={{ fontSize: 24 }}>
                  {showDiscount ? (
                    <>
                      {formatPesos(discountCents)}
                      <s style={{ marginLeft: 8, fontSize: 16, opacity: 0.55, fontWeight: 400 }}>
                        {formatPesos(cents)}
                      </s>
                    </>
                  ) : (
                    cents > 0 ? formatPesos(cents) : "₱—"
                  )}
                  <small>one-time</small>
                </div>

                <div style={{ marginTop: 10 }}>
                  <label className="field-label">Price (₱)</label>
                  <input
                    className="input"
                    style={{ width: "100%", marginTop: 4 }}
                    type="number"
                    min={1}
                    step={1}
                    value={p.priceText}
                    onChange={(e) => patchPlan(p.key, { priceText: e.target.value })}
                  />
                </div>
                <div style={{ marginTop: 10 }}>
                  <label className="field-label">Discount price (₱) — optional</label>
                  <input
                    className="input"
                    style={{ width: "100%", marginTop: 4 }}
                    type="number"
                    min={1}
                    step={1}
                    placeholder="Leave blank for no discount"
                    value={p.discountText}
                    onChange={(e) => patchPlan(p.key, { discountText: e.target.value })}
                  />
                </div>
                <div style={{ marginTop: 10 }}>
                  <label className="field-label">Description</label>
                  <textarea
                    className="input"
                    rows={2}
                    style={{ width: "100%", marginTop: 4, resize: "vertical", lineHeight: 1.4 }}
                    value={p.blurb}
                    maxLength={300}
                    onChange={(e) => patchPlan(p.key, { blurb: e.target.value })}
                  />
                </div>

                <div className="divider" />
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {row?.count ?? 0} tenants · {money(row?.revenueCents ?? 0)} collected
                  </span>
                  <span className="tnum muted" style={{ fontSize: 12.5 }}>
                    {share}%
                  </span>
                </div>
                <div className="bar mb-3">
                  <span style={{ width: share + "%" }} />
                </div>

                <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                  <label className="field-label">Features</label>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      className="btn btn-sm"
                      onClick={() => generateBullets(p.key)}
                      title="Fill bullets from this plan's functional scope"
                    >
                      <Ic.Wand /> Generate
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => addFeat(p.key)}
                      disabled={p.feats.length >= MAX_FEATS}
                    >
                      <Ic.Plus /> Add
                    </button>
                  </div>
                </div>
                <div className="col" style={{ gap: 6 }}>
                  {p.feats.map((f, i) => (
                    <div key={f.id} className="row" style={{ gap: 6 }}>
                      <input
                        className="input"
                        style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}
                        value={f.text}
                        maxLength={160}
                        placeholder="Feature bullet"
                        onChange={(e) => patchFeat(p.key, f.id, e.target.value)}
                      />
                      <button
                        className="btn btn-sm"
                        onClick={() => moveFeat(p.key, f.id, -1)}
                        disabled={i === 0}
                        aria-label="Move feature up"
                      >
                        <Ic.ArrowUp />
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => moveFeat(p.key, f.id, 1)}
                        disabled={i === p.feats.length - 1}
                        aria-label="Move feature down"
                      >
                        <Ic.ArrowDown />
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => removeFeat(p.key, f.id)}
                        aria-label="Remove feature"
                      >
                        <Ic.Trash />
                      </button>
                    </div>
                  ))}
                </div>

                <PlanScopePanel
                  scope={getPlanScope(
                    p.key,
                    featureConfig ? resolvePlanCeiling(featureConfig, p.key) : undefined,
                  )}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
