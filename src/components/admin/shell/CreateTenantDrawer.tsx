"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createTenantAction } from "@/actions/onboarding";
import type { CreateTenantState } from "@/actions/demo";
import {
  FEATURE_GROUPS,
  FEATURE_META,
  ALL_FEATURES,
  planFeatureSet,
  type FeatureKey,
  type FeatureGroup,
} from "@/lib/features/catalog";
import { PLAN_CARDS, planMeta, formatPesos } from "@/lib/admin/plans";
import { Ic, Toggle } from "./primitives";

const STEPS = [
  { id: 1, label: "Business" },
  { id: 2, label: "Plan" },
  { id: 3, label: "Features" },
  { id: 4, label: "Review" },
];

const GROUP_ICON: Record<FeatureGroup, string> = {
  Site: "Globe",
  Catalog: "ShoppingBag",
  Ecommerce: "Card",
  Notifications: "Mail",
  "Growth & Automation": "Wand",
  Integrations: "Zap",
};

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "peptide.app").replace(/:\d+$/, "");

function autoSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20);
}
function derivePrefix(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, "").toUpperCase();
  return (letters.slice(0, 3) || "ORD").padEnd(2, "X");
}

export function CreateTenantDrawer({
  open,
  onClose,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<CreateTenantState, FormData>(createTenantAction, {});
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [owner, setOwner] = useState("");
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState("pro");
  const [notify, setNotify] = useState(true);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [openCats, setOpenCats] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(FEATURE_GROUPS.map((g) => [g, true])),
  );

  const ceiling = useMemo(() => planFeatureSet(plan), [plan]);

  // reset on open; seed feature toggles from the selected plan ceiling
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setName("");
    setSlug("");
    setSlugTouched(false);
    setOwner("");
    setEmail("");
    setPlan("pro");
    setNotify(true);
  }, [open]);

  // reseed feature defaults whenever the plan changes
  useEffect(() => {
    const def: Record<string, boolean> = {};
    for (const key of ALL_FEATURES) def[key] = ceiling.has(key);
    setFeatures(def);
  }, [ceiling]);

  // auto-derive subdomain from name until the operator edits it directly
  useEffect(() => {
    if (!slugTouched) setSlug(autoSlug(name));
  }, [name, slugTouched]);

  // close + toast + navigate on success
  useEffect(() => {
    if (state.createdSlug) {
      onToast(`${name || "Tenant"} created · trial active`);
      const created = state.createdSlug;
      onClose();
      router.push(`/tenants/${created}`);
      router.refresh();
    }
  }, [state.createdSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const step1Valid = name.length >= 2 && slug.length >= 2 && owner.length > 0 && email.includes("@");
  const enabledCount = Object.values(features).filter(Boolean).length;
  const setFeature = (key: string, on: boolean) => setFeatures((f) => ({ ...f, [key]: on }));
  const next = () => setStep((s) => Math.min(4, s + 1));
  const prev = () => setStep((s) => Math.max(1, s - 1));

  const Check = Ic.Check;
  const ChevronLeft = Ic.ChevronLeft;
  const ChevronRight = Ic.ChevronRight;

  // group features for the toggle step
  const grouped = FEATURE_GROUPS.map((group) => ({
    group,
    items: ALL_FEATURES.filter((k) => FEATURE_META[k].group === group),
  }));

  return (
    <>
      <div className="sa-drawer-backdrop" onClick={onClose} />
      <form action={formAction} className="sa-drawer" role="dialog" aria-modal="true">
        {/* hidden inputs carry the collected values to the server action */}
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="plan" value={plan} />
        <input type="hidden" name="themeId" value="clinical-white" />
        <input type="hidden" name="orderPrefix" value={derivePrefix(name)} />
        <input type="hidden" name="orderSeparator" value="-" />
        <input type="hidden" name="orderScheme" value="sequential" />
        <input type="hidden" name="orderDigits" value="4" />

        <div className="drawer-head">
          <button type="button" className="drawer-close" onClick={onClose}>
            <Ic.X />
          </button>
          <h2 className="drawer-title">Create tenant</h2>
          <p className="drawer-sub">
            Spin up a new white-label site. Goes live instantly at{" "}
            <span className="mono" style={{ color: "var(--ink-700)" }}>
              {slug || "slug"}.{ROOT}
            </span>
          </p>
          <div className="stepper" style={{ marginTop: 14 }}>
            {STEPS.map((s, i) => (
              <span key={s.id} style={{ display: "contents" }}>
                <div className={"step" + (step === s.id ? " active" : step > s.id ? " done" : "")} style={{ flex: "0 0 auto", gap: 6 }}>
                  <div className="step-dot">{step > s.id ? <Check /> : s.id}</div>
                  <div className="step-label">{s.label}</div>
                </div>
                {i < STEPS.length - 1 && <div className={"step-line" + (step > s.id ? " filled" : "")} style={{ flex: 1 }} />}
              </span>
            ))}
          </div>
        </div>

        <div className="drawer-body">
          {state.error && (
            <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 8, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 12.5 }}>
              {state.error}
            </div>
          )}

          {step === 1 && (
            <div className="col" style={{ gap: 18 }}>
              <SectionTitle title="Business" subtitle="Owner identity and storefront address." />
              <div>
                <label className="field-label">Business name</label>
                <input className="input" placeholder="e.g. Nordic Peptides" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="field-label">Subdomain</label>
                <div className="input-affix">
                  <input
                    className="input"
                    placeholder="nordic"
                    value={slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                    }}
                  />
                  <div className="affix">.{ROOT}</div>
                </div>
                <div className="field-hint">Lowercase, numbers and dashes. Can be changed later.</div>
              </div>
              <div className="divider" />
              <SectionTitle title="Owner" subtitle="Who logs in first?" />
              <div className="grid-2-eq">
                <div>
                  <label className="field-label">Owner name</label>
                  <input className="input" placeholder="Linnea Aalto" value={owner} onChange={(e) => setOwner(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">Owner email</label>
                  <input className="input" type="email" placeholder="owner@nordicpep.co" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </div>
              <label className="row" style={{ gap: 8, cursor: "pointer", marginTop: 4 }}>
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                <span style={{ fontSize: 13 }}>Email the owner their welcome credentials</span>
              </label>
            </div>
          )}

          {step === 2 && (
            <div>
              <SectionTitle title="Subscription plan" subtitle="Sets defaults for features, limits and billing." />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
                {PLAN_CARDS.map((p) => (
                  <div key={p.key} className={"plan-card" + (plan === p.key ? " selected" : "")} onClick={() => setPlan(p.key)}>
                    {"tag" in p && p.tag && <span className="plan-tag">{p.tag}</span>}
                    <div className="plan-name">{p.name}</div>
                    <div className="plan-price">
                      {formatPesos(p.priceCents)}
                      <small>/mo</small>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 6, lineHeight: 1.4 }}>{p.blurb}</div>
                    <div className="plan-feats">
                      {p.feats.map((f, i) => (
                        <div key={i} className="plan-feat">
                          <Check /> {f}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, padding: 12, background: "var(--accent-softer)", border: "1px solid var(--accent-soft)", borderRadius: 10, display: "flex", gap: 10 }}>
                <Ic.Sparkles style={{ width: 16, height: 16, color: "var(--accent)", flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12.5, color: "var(--ink-700)", lineHeight: 1.5 }}>
                  Tenants on <strong>{planMeta(plan).label}</strong> get a 14-day free trial. You can fine-tune individual feature toggles on the next step.
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <SectionTitle title="Feature toggles" subtitle="Enable modules for this tenant. Locked modules require a higher plan." />
              <div style={{ marginTop: 12 }}>
                {grouped.map(({ group, items }) => {
                  const IconCmp = Ic[GROUP_ICON[group]] ?? Ic.Layers;
                  const isOpen = openCats[group];
                  const enabledOf = items.filter((k) => features[k]).length;
                  return (
                    <div key={group} className={"fcat" + (isOpen ? " open" : "")}>
                      <div className="fcat-head" onClick={() => setOpenCats((o) => ({ ...o, [group]: !o[group] }))}>
                        <div className="fcat-icon">
                          <IconCmp />
                        </div>
                        <div className="fcat-name">{group}</div>
                        <div className="fcat-count tnum">
                          {enabledOf} of {items.length}
                        </div>
                        <div className="fcat-chev">
                          <ChevronRight />
                        </div>
                      </div>
                      <div className="fcat-body">
                        {items.map((key) => {
                          const meta = FEATURE_META[key];
                          const locked = !ceiling.has(key);
                          return (
                            <div key={key} className={"feat-row" + (locked ? " locked" : "")}>
                              <div className="feat-info">
                                <div className="feat-name">
                                  {meta.label}
                                  {locked && (
                                    <span className="lock">
                                      <Ic.Lock /> Upgrade
                                    </span>
                                  )}
                                </div>
                                <div className="feat-desc">{meta.description}</div>
                              </div>
                              <Toggle on={!!features[key] && !locked} disabled={locked} onChange={(v) => setFeature(key, v)} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="col" style={{ gap: 16 }}>
              <SectionTitle title="Review & launch" subtitle="Confirm everything looks right. You can edit later." />
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="card-head">
                  <h3 className="card-title">Business</h3>
                </div>
                <div className="card-body" style={{ padding: "12px 18px" }}>
                  <ReviewRow k="Business name" v={name || "—"} />
                  <ReviewRow k="Storefront URL" v={<span className="mono">{slug || "slug"}.{ROOT}</span>} />
                  <ReviewRow k="Owner" v={`${owner || "—"} · ${email || "—"}`} />
                  <ReviewRow k="Welcome email" v={notify ? "Will be sent" : "Skipped"} />
                </div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="card-head">
                  <h3 className="card-title">Plan &amp; billing</h3>
                </div>
                <div className="card-body" style={{ padding: "12px 18px" }}>
                  <ReviewRow
                    k="Plan"
                    v={
                      <span className="row" style={{ gap: 6 }}>
                        <span className="badge badge-accent">{planMeta(plan).label}</span>
                        <span className="muted">{formatPesos(planMeta(plan).priceCents)}/mo</span>
                      </span>
                    }
                  />
                  <ReviewRow k="Trial" v="14 days, no card required" />
                </div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="card-head">
                  <h3 className="card-title">
                    Features <span className="tab-count tnum">{enabledCount}</span>
                  </h3>
                </div>
                <div className="card-body" style={{ padding: "12px 18px", display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {enabledCount === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No features enabled.</div>}
                  {ALL_FEATURES.filter((k) => features[k]).map((k) => (
                    <span key={k} className="tag" style={{ background: "var(--accent-softer)", borderColor: "var(--accent-soft)", color: "var(--accent-ink)" }}>
                      <Ic.Check style={{ width: 11, height: 11 }} /> {FEATURE_META[k].label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="drawer-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <div className="row">
            {step > 1 && (
              <button type="button" className="btn" onClick={prev}>
                <ChevronLeft /> Back
              </button>
            )}
            {step < 4 && (
              <button type="button" className="btn btn-accent" onClick={next} disabled={step === 1 && !step1Valid}>
                Continue <ChevronRight />
              </button>
            )}
            {step === 4 && (
              <button type="submit" className="btn btn-accent" disabled={pending}>
                <Check /> {pending ? "Creating…" : "Create tenant"}
              </button>
            )}
          </div>
        </div>
      </form>
    </>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-900)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12.5, color: "var(--ink-400)", marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

function ReviewRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", padding: "8px 0", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
      <div style={{ color: "var(--ink-400)" }}>{k}</div>
      <div style={{ color: "var(--ink-900)" }}>{v}</div>
    </div>
  );
}
