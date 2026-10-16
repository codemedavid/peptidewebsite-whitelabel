"use client";

// Store-admin "Assessments": the storefront quiz's submissions (follow up,
// mark contacted, archive) and its settings (on/off, copy, and the goal →
// product keyword map). The settings tab previews which live products each goal
// matches, using the SAME recommendProducts the storefront runs.
// Submissions hold self-reported medical history — staff need the
// "assessments" permission and the server re-checks it on every call.

import { useEffect, useMemo, useState } from "react";
import "../content-pages.css";
import type { Brand } from "../types";
import { useStore } from "../store";
import {
  deleteAssessmentResponseAction,
  listAssessmentResponsesAction,
  saveAssessmentConfigAction,
  updateAssessmentStatusAction,
  type AssessmentResponseRow,
  type AssessmentStatus,
} from "@/actions/assessment";
import {
  EXPERIENCE_LEVELS,
  NONE_OF_THE_ABOVE,
  normalizeAssessmentConfig,
  recommendProducts,
  type AssessmentConfig,
} from "@/lib/storefront/assessment";

type Filter = AssessmentStatus | "all";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "archived", label: "Archived" },
  { id: "all", label: "All" },
];
const PREVIEW_MATCHES = 6;

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const experienceLabel = (id: string) => EXPERIENCE_LEVELS.find((l) => l.id === id)?.label ?? id;

function Submissions() {
  const { toast } = useStore();
  const [rows, setRows] = useState<AssessmentResponseRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>("new");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAssessmentResponsesAction()
      .then((res) => {
        if (cancelled) return;
        if ("error" in res) {
          toast(res.error);
          setRows([]);
        } else setRows(res.responses);
      })
      .catch(() => {
        if (!cancelled) {
          toast("Couldn't load submissions.");
          setRows([]);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { new: 0, contacted: 0, archived: 0, all: rows?.length ?? 0 };
    for (const r of rows ?? []) c[r.status]++;
    return c;
  }, [rows]);
  const shown = (rows ?? []).filter((r) => filter === "all" || r.status === filter);

  const setStatus = async (r: AssessmentResponseRow, status: AssessmentStatus) => {
    setBusy(r.id);
    try {
      const res = await updateAssessmentStatusAction(r.id, status);
      if ("error" in res) return toast(res.error);
      setRows((prev) => (prev ?? []).map((x) => (x.id === r.id ? { ...x, status } : x)));
    } catch {
      toast("Couldn't update the submission.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: AssessmentResponseRow) => {
    if (!window.confirm(`Delete ${r.fullName}'s submission? This can't be undone.`)) return;
    setBusy(r.id);
    try {
      const res = await deleteAssessmentResponseAction(r.id);
      if ("error" in res) return toast(res.error);
      setRows((prev) => (prev ?? []).filter((x) => x.id !== r.id));
    } catch {
      toast("Couldn't delete the submission.");
    } finally {
      setBusy(null);
    }
  };

  if (rows === null) return <div className="admin-field__hint">Loading submissions…</div>;

  return (
    <>
      <div className="asm-admin__filters" role="tablist" aria-label="Filter submissions">
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id}
            className={`admin-btn ${filter === f.id ? "" : "admin-btn--ghost"}`} onClick={() => setFilter(f.id)}>
            {f.label} ({counts[f.id]})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="staff-empty">
          <p className="staff-empty__title">{rows.length ? "Nothing here" : "No submissions yet"}</p>
          <p className="admin-field__hint">
            {rows.length ? "Try another filter." : "When a customer completes your assessment, their answers appear here."}
          </p>
        </div>
      ) : (
        <div className="staff-list">
          {shown.map((r) => {
            const flagged = r.conditions.filter((c) => c !== NONE_OF_THE_ABOVE);
            return (
              <div key={r.id} className={`staff-row ${r.status === "archived" ? "is-suspended" : ""}`} style={{ display: "block" }}>
                <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "flex-start" }}>
                  <button type="button" className="staff-row__main" aria-expanded={open === r.id}
                    onClick={() => setOpen(open === r.id ? null : r.id)}
                    style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer", font: "inherit" }}>
                    <div className="staff-row__name">{r.fullName}</div>
                    <div className="staff-row__meta">{r.email} · {when(r.createdAt)}</div>
                    <div className="asm-admin__chips">
                      {r.goals.map((g) => <span key={g} className="asm-admin__chip">{g}</span>)}
                      {flagged.length > 0 && <span className="asm-admin__chip asm-admin__chip--warn">⚠ {flagged.length} health flag{flagged.length > 1 ? "s" : ""}</span>}
                    </div>
                  </button>
                  <div className="staff-row__actions">
                    <a className="admin-btn admin-btn--ghost" href={`mailto:${r.email}`}>Email</a>
                    {r.status !== "contacted" && (
                      <button className="admin-btn admin-btn--ghost" disabled={busy === r.id} onClick={() => void setStatus(r, "contacted")}>
                        Mark contacted
                      </button>
                    )}
                    {r.status !== "archived" ? (
                      <button className="admin-btn admin-btn--ghost" disabled={busy === r.id} onClick={() => void setStatus(r, "archived")}>Archive</button>
                    ) : (
                      <button className="admin-btn admin-btn--ghost" disabled={busy === r.id} onClick={() => void setStatus(r, "new")}>Restore</button>
                    )}
                  </div>
                </div>
                {open === r.id && (
                  <dl className="asm-admin__detail">
                    <dt>Age range</dt><dd>{r.ageRange}</dd>
                    <dt>Location</dt><dd>{r.location || "—"}</dd>
                    <dt>Medical history</dt><dd>{r.conditions.join(", ") || "—"}</dd>
                    <dt>Experience</dt><dd>{experienceLabel(r.experience)}</dd>
                    <dt>Frequency</dt><dd>{r.frequency || "—"}</dd>
                    <dt />
                    <dd>
                      <button className="admin-btn admin-btn--danger" disabled={busy === r.id} onClick={() => void remove(r)}>
                        Delete submission
                      </button>
                    </dd>
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

type GoalDraft = { label: string; keywords: string };

function Settings({ brand }: { brand: Brand }) {
  const { toast, products } = useStore();
  const initial = useMemo(() => normalizeAssessmentConfig(brand.assessment), [brand.assessment]);
  const [cfg, setCfg] = useState<AssessmentConfig>(initial);
  const [goals, setGoals] = useState<GoalDraft[]>(
    initial.goals.map((g) => ({ label: g.label, keywords: g.keywords.join(", ") })),
  );
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<AssessmentConfig>) => setCfg((prev) => ({ ...prev, ...patch }));

  const draft = useMemo(
    () =>
      normalizeAssessmentConfig({
        ...cfg,
        goals: goals.map((g) => ({ label: g.label, keywords: g.keywords.split(",") })),
      }),
    [cfg, goals],
  );

  const save = async () => {
    setSaving(true);
    try {
      const res = await saveAssessmentConfigAction(draft);
      if ("error" in res) return toast(res.error);
      toast("Assessment settings saved");
    } catch {
      toast("Couldn't save the settings.");
    } finally {
      setSaving(false);
    }
  };

  const patchGoal = (i: number, patch: Partial<GoalDraft>) =>
    setGoals((prev) => prev.map((g, j) => (j === i ? { ...g, ...patch } : g)));

  return (
    <>
      <div className="admin-field" style={{ marginBottom: 18 }}>
        <label className="admin-check">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span>Show the assessment on my store</span>
        </label>
        <div className="admin-field__hint">Off hides the page and its links; past submissions stay here.</div>
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor="asm-title">Title</label>
        <input id="asm-title" className="admin-input" value={cfg.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor="asm-intro">Intro</label>
        <textarea id="asm-intro" className="admin-textarea" rows={3} value={cfg.intro} maxLength={600} onChange={(e) => set({ intro: e.target.value })} />
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor="asm-consent">Terms customers must accept</label>
        <textarea id="asm-consent" className="admin-textarea" rows={3} value={cfg.consentText} maxLength={1000} onChange={(e) => set({ consentText: e.target.value })} />
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor="asm-disc">Note under the results</label>
        <textarea id="asm-disc" className="admin-textarea" rows={3} value={cfg.disclaimer} maxLength={1000} onChange={(e) => set({ disclaimer: e.target.value })} />
      </div>

      <h2 className="admin-form__section" style={{ marginTop: 24 }}>Goals &amp; matching products</h2>
      <div className="admin-field__hint" style={{ marginBottom: 12 }}>
        Each goal recommends products whose <strong>name</strong> (or description) contains one of its keywords.
        Separate keywords with commas. The first goal a customer picks fills their &ldquo;Core picks&rdquo;.
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {goals.map((g, i) => {
          const goal = draft.goals.find((x) => x.label === g.label.trim());
          const matches = goal ? recommendProducts(products, [goal.label], draft).primary : [];
          return (
            <div key={i} className="asm-admin__goal">
              <div className="asm-admin__goal-head">
                <input className="admin-input" aria-label="Goal" value={g.label} maxLength={60}
                  onChange={(e) => patchGoal(i, { label: e.target.value })} placeholder="Goal, e.g. Weight Loss" />
                <button type="button" className="admin-btn admin-btn--ghost" aria-label={`Remove ${g.label || "goal"}`}
                  onClick={() => setGoals((prev) => prev.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
              <input className="admin-input" aria-label="Keywords" value={g.keywords}
                onChange={(e) => patchGoal(i, { keywords: e.target.value })} placeholder="Tirzepatide, Retatrutide, AOD" />
              <div className="asm-admin__matches">
                {matches.length
                  ? `Recommends: ${matches.slice(0, PREVIEW_MATCHES).map((p) => p.name).join(" · ")}`
                  : "No products match these keywords yet."}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setGoals((prev) => [...prev, { label: "", keywords: "" }])}>
          + Add goal
        </button>
        <button type="button" className="admin-form__save" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </>
  );
}

export function AdminAssessments({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const [tab, setTab] = useState<"submissions" | "settings">("submissions");
  return (
    <div className="admin">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h1 className="admin-form__title">Assessments</h1>
        <div className="admin-form__bar-spacer" />
      </header>

      <div className="admin-form__body">
        <div className="admin__tip" style={{ marginTop: 0, textAlign: "left" }}>
          Customers who took your quiz, with the goals they chose. Answers include self-reported medical history —
          treat them as private and follow up personally.
        </div>
        <div className="asm-admin__tabs" role="tablist" aria-label="Assessments">
          <button className="asm-admin__tab" role="tab" aria-selected={tab === "submissions"} onClick={() => setTab("submissions")}>
            Submissions
          </button>
          <button className="asm-admin__tab" role="tab" aria-selected={tab === "settings"} onClick={() => setTab("settings")}>
            Quiz settings
          </button>
        </div>
        <div className="admin-form__card">{tab === "submissions" ? <Submissions /> : <Settings brand={brand} />}</div>
      </div>
    </div>
  );
}
