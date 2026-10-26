"use client";

// Store-admin editor (OWNER-ONLY) for the storefront Timeline — owner-written
// steps with the current one highlighted, shown on the Track Order page, in the
// hero, or both. Only reachable while the operator grant FEATURES.STORE_TIMELINE
// is on (visibility.ts hides the view otherwise).
//
// Saves through saveTimelineAction (read-modify-write into
// branding.config.timeline, sanitized server-side) and mirrors into the live
// brand via setTweak. The preview renders the REAL <TimelineCard> in each place
// the owner picked, so what they preview is what ships.

import { useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { saveTimelineAction } from "@/actions/storefront-admin";
import {
  DEFAULT_TIMELINE,
  TIMELINE_EXAMPLE,
  TIMELINE_LIMITS,
  TIMELINE_PLACEMENTS,
  normalizeTimeline,
  type TimelineConfig,
  type TimelinePlacement,
  type TimelineStep,
} from "@/lib/storefront/timeline";
import { TimelineCard } from "../components/TimelineCard";

// Editor rows carry a local id so reordering keeps React keys — and the
// "current step" pick, which follows the step, not its position — stable.
type DraftStep = TimelineStep & { id: number };

let nextId = 1;
const toDraft = (steps: TimelineStep[]): DraftStep[] => steps.map((s) => ({ ...s, id: nextId++ }));

type AdminTimelineProps = { brand: Brand; onBack: () => void };

export function AdminTimeline({ brand, onBack }: AdminTimelineProps) {
  const { setTweak, toast } = useStore();
  const initial = brand.timeline ?? DEFAULT_TIMELINE;
  const [initialSteps] = useState(() => toDraft(initial.steps));

  const [enabled, setEnabled] = useState(initial.enabled);
  const [title, setTitle] = useState(initial.title);
  const [placement, setPlacement] = useState<TimelinePlacement>(initial.placement);
  const [steps, setSteps] = useState<DraftStep[]>(initialSteps);
  const [currentId, setCurrentId] = useState<number | null>(initialSteps[initial.currentStep]?.id ?? null);
  const [saving, setSaving] = useState(false);

  const payload = {
    enabled,
    title,
    placement,
    steps: steps.map(({ title: t, date, note }) => ({ title: t, date, note })),
    currentStep: steps.findIndex((s) => s.id === currentId),
  };
  // What will persist (blank-title steps dropped, current index clamped).
  const draft: TimelineConfig = normalizeTimeline(payload);

  const updateStep = (id: number, patch: Partial<TimelineStep>) =>
    setSteps((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeStep = (id: number) => {
    setSteps((list) => list.filter((s) => s.id !== id));
    if (currentId === id) setCurrentId(null);
  };
  const moveStep = (index: number, delta: -1 | 1) =>
    setSteps((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const addStep = () => setSteps((list) => [...list, { id: nextId++, title: "", date: "", note: "" }]);

  const loadExample = () => {
    const example = toDraft(TIMELINE_EXAMPLE.steps);
    setTitle(TIMELINE_EXAMPLE.title);
    setPlacement(TIMELINE_EXAMPLE.placement);
    setSteps(example);
    setCurrentId(example[TIMELINE_EXAMPLE.currentStep]?.id ?? null);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await saveTimelineAction(payload);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setTweak({ timeline: draft });
      toast(enabled ? "Timeline saved and showing" : "Timeline saved (hidden)");
    } catch {
      toast("Couldn't save — please sign in again and retry.");
    } finally {
      setSaving(false);
    }
  };

  const showsOnTrack = placement !== "hero";
  const showsOnHero = placement !== "track";
  const atLimit = steps.length >= TIMELINE_LIMITS.steps;

  return (
    <div className="admin">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Dashboard
        </button>
        <h1 className="admin-form__title">Timeline</h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      <div className="admin-form__body">
        <div className="sf-notice-editor">
          {/* ── Editor column ─────────────────────────────────────────────── */}
          <div className="admin-form__card">
            <h2 className="admin-form__section">Timeline</h2>
            <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 14 }}>
              A list of steps with the current one highlighted, e.g. your
              group-buy schedule. Update the current step as the round moves along.
            </div>

            <div className="admin-field" style={{ marginBottom: 18 }}>
              <button type="button" className="admin-btn admin-btn--ghost" onClick={loadExample}>
                Load group-buy example
              </button>
            </div>

            <div className="admin-field" style={{ marginBottom: 18 }}>
              <label className="admin-check">
                <input type="checkbox" checked={enabled}
                       onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEnabled(e.target.checked)} />
                <span>Show the timeline on my store</span>
              </label>
              <div className="admin-field__hint">Turn it off to hide it without losing your steps.</div>
            </div>

            <fieldset className="admin-field" style={{ border: 0, padding: 0, margin: "0 0 18px" }}>
              <legend className="admin-field__label">Where should it show?</legend>
              {TIMELINE_PLACEMENTS.map((p) => (
                <label key={p.value} className="admin-check">
                  <input type="radio" name="timeline-placement" value={p.value}
                         checked={placement === p.value} onChange={() => setPlacement(p.value)} />
                  <span>{p.label}</span>
                </label>
              ))}
            </fieldset>

            <div className="admin-field">
              <label className="admin-field__label" htmlFor="timeline-title">Heading</label>
              <input id="timeline-title" className="admin-input" value={title}
                     maxLength={TIMELINE_LIMITS.title} placeholder="Group buy schedule"
                     onChange={(e) => setTitle(e.target.value)} />
              <div className="admin-field__hint">Leave blank to hide it.</div>
            </div>

            <div className="admin-field">
              <span className="admin-field__label">Steps</span>
              <label className="admin-check">
                <input type="radio" name="timeline-current" checked={currentId === null}
                       onChange={() => setCurrentId(null)} />
                <span>Not started yet (no step highlighted)</span>
              </label>
            </div>

            {steps.map((step, i) => (
              <div key={step.id} className="editor-item">
                <div className="editor-item__body">
                  <label className="admin-check">
                    <input type="radio" name="timeline-current" checked={currentId === step.id}
                           onChange={() => setCurrentId(step.id)} />
                    <span>Step {i + 1} — this is the current step</span>
                  </label>
                  <div>
                    <div className="small">Title</div>
                    <input value={step.title} maxLength={TIMELINE_LIMITS.stepTitle}
                           placeholder="Orders close"
                           onChange={(e) => updateStep(step.id, { title: e.target.value })} />
                  </div>
                  <div>
                    <div className="small">Date (optional)</div>
                    <input value={step.date} maxLength={TIMELINE_LIMITS.date}
                           placeholder="Nov 1 or ~Nov 12"
                           onChange={(e) => updateStep(step.id, { date: e.target.value })} />
                  </div>
                  <div>
                    <div className="small">Note (optional, Track page only)</div>
                    <textarea value={step.note} maxLength={TIMELINE_LIMITS.note}
                              placeholder="Last day to join this round."
                              onChange={(e) => updateStep(step.id, { note: e.target.value })} />
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignSelf: "flex-start" }}>
                  <button type="button" className="admin-icon-btn" title="Move up" aria-label={`Move step ${i + 1} up`}
                          disabled={i === 0} onClick={() => moveStep(i, -1)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                         strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
                  </button>
                  <button type="button" className="admin-icon-btn" title="Move down" aria-label={`Move step ${i + 1} down`}
                          disabled={i === steps.length - 1} onClick={() => moveStep(i, 1)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                         strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  <button type="button" className="admin-icon-btn admin-icon-btn--danger" title="Remove step"
                          aria-label={`Remove step ${i + 1}`} onClick={() => removeStep(step.id)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                         strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}

            <div className="admin-field" style={{ marginTop: 12 }}>
              <button type="button" className="admin-btn admin-btn--ghost" onClick={addStep} disabled={atLimit}>
                + Add step
              </button>
              <div className="admin-field__hint">
                Up to {TIMELINE_LIMITS.steps} steps. Steps without a title aren&apos;t saved.
              </div>
            </div>
          </div>

          {/* ── Live preview column ───────────────────────────────────────── */}
          <div className="sf-notice-editor__preview">
            <div className="admin-field__hint" style={{ marginBottom: 10 }}>
              Live preview: your storefront theme{enabled ? "" : " (currently hidden from customers)"}
            </div>
            <div className="sf-root">
              {draft.steps.length === 0 && (
                <div className="admin-field__hint">Add a step to see the preview.</div>
              )}
              {draft.steps.length > 0 && showsOnTrack && (
                <>
                  <div className="admin-field__hint" style={{ marginBottom: 6 }}>Track Order page</div>
                  <TimelineCard config={draft} />
                </>
              )}
              {draft.steps.length > 0 && showsOnHero && (
                <>
                  <div className="admin-field__hint" style={{ marginBottom: 6 }}>Hero section</div>
                  <TimelineCard config={draft} variant="hero" />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
