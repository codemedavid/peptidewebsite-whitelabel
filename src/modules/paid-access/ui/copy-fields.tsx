"use client";

// "Join page text": the store's own words for the members-only panel and the
// join page. Every field is optional — the placeholder IS the built-in wording,
// so a blank field visibly means "keep the default". Text only: no rule here.

import { AMOUNT_TOKEN, COPY_LIMITS, DEFAULT_ACCESS_LABEL, type PaidAccessCopy, type PaidAccessStep } from "../client";
import type { FieldsProps } from "./settings-fields";

type TextKey = "intro" | "button" | "note";

const TEXTS: { key: TextKey; label: string; placeholder: string; max: number; long?: boolean }[] = [
  {
    key: "intro",
    label: "Description",
    placeholder: "8 products are waiting in this group buy. Members see the prices and can order.",
    max: COPY_LIMITS.intro,
    long: true,
  },
  { key: "button", label: "Button", placeholder: "Get access", max: COPY_LIMITS.button },
  { key: "note", label: "Note under the button", placeholder: "Already approved? Verify your email on the next screen — no account needed.", max: COPY_LIMITS.note },
];

const STEP_PLACEHOLDER: Record<PaidAccessStep, string> = { form: "Application form", payment: `Pay ${AMOUNT_TOKEN}`, approval: "Admin approval" };

export function CopyFields({ draft, onChange, errorFor }: FieldsProps) {
  const copy = draft.copy;
  const set = (patch: Partial<PaidAccessCopy>) => onChange({ ...draft, copy: { ...copy, ...patch } });
  const setStep = (key: keyof PaidAccessCopy["steps"], value: string) => set({ steps: { ...copy.steps, [key]: value } });

  return (
    <fieldset className="bnn-fieldset">
      <legend className="bnn-fieldset__title">Join page text</legend>
      <p className="admin-field__hint">Optional. Leave a field blank to keep the wording shown in grey.</p>
      {TEXTS.map((f) => (
        <label key={f.key} className="bnn-field">
          <span className="admin-field__label">{f.label}</span>
          {f.long ? (
            <textarea className="admin-input" rows={3} maxLength={f.max} placeholder={f.placeholder} value={copy[f.key]} onChange={(e) => set({ [f.key]: e.target.value })} aria-invalid={!!errorFor(`copy.${f.key}`)} />
          ) : (
            <input className="admin-input" maxLength={f.max} placeholder={f.placeholder} value={copy[f.key]} onChange={(e) => set({ [f.key]: e.target.value })} aria-invalid={!!errorFor(`copy.${f.key}`)} />
          )}
          {errorFor(`copy.${f.key}`) && <span className="bnn-error" role="alert">{errorFor(`copy.${f.key}`)}</span>}
        </label>
      ))}

      {draft.steps.length > 0 && (
        <div className="bnn-row">
          {draft.steps.map((s) => (
            <label key={s} className="bnn-field">
              <span className="admin-field__label">Step name: {STEP_PLACEHOLDER[s].replace(` ${AMOUNT_TOKEN}`, "")}</span>
              <input className="admin-input" maxLength={COPY_LIMITS.step} placeholder={STEP_PLACEHOLDER[s]} value={copy.steps[s]} onChange={(e) => setStep(s, e.target.value)} />
            </label>
          ))}
          <label className="bnn-field">
            <span className="admin-field__label">Last step</span>
            <input className="admin-input" maxLength={COPY_LIMITS.step} placeholder={DEFAULT_ACCESS_LABEL} value={copy.steps.access} onChange={(e) => setStep("access", e.target.value)} />
          </label>
        </div>
      )}
      {draft.steps.includes("payment") && (
        <p className="admin-field__hint">Type {AMOUNT_TOKEN} in a step name to show the price.</p>
      )}
      {errorFor("copy.steps") && <span className="bnn-error" role="alert">{errorFor("copy.steps")}</span>}
    </fieldset>
  );
}
