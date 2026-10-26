"use client";

// The editable sections of the Paid Access settings panel. Each is presentational:
// it gets the draft and hands back a NEW draft (never mutates), and shows the
// schema's message for its own fields.

import { useState } from "react";

import { PAID_ACCESS_STEPS, parseAmountCents, type PaidAccessQuestion, type PaidAccessSettings, type PaidAccessStep } from "../client";

export type FieldsProps = {
  draft: PaidAccessSettings;
  onChange: (next: PaidAccessSettings) => void;
  /** The first error at `path` or inside it. */
  errorFor: (path: string) => string | undefined;
  /** The error at exactly `path`. */
  errorAt: (path: string) => string | undefined;
  currency: string;
  money: (cents: number) => string;
  onlineAvailable: boolean;
};

const STEP_NAME: Record<PaidAccessStep, string> = { form: "Application form", payment: "Payment", approval: "Admin approval" };
const WINDOWS: { value: number | null; label: string }[] = [
  { value: null, label: "No limit" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 180, label: "3 hours" },
  { value: 1440, label: "24 hours" },
];

function FieldError({ message }: { message?: string }) {
  return message ? <span className="bnn-error" role="alert">{message}</span> : null;
}

function Fieldset({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="bnn-fieldset">
      <legend className="bnn-fieldset__title">{title}</legend>
      {hint && <p className="admin-field__hint">{hint}</p>}
      {children}
    </fieldset>
  );
}

const move = (steps: PaidAccessStep[], i: number, by: -1 | 1): PaidAccessStep[] => {
  const next = [...steps];
  const j = i + by;
  if (j < 0 || j >= next.length) return next;
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

export function StepsEditor({ draft, onChange, errorFor }: FieldsProps) {
  const missing = PAID_ACCESS_STEPS.filter((s) => !draft.steps.includes(s));
  const setSteps = (steps: PaidAccessStep[]) => onChange({ ...draft, steps });
  return (
    <Fieldset title="Steps, in order" hint="Change the order or add and remove steps. No steps means anyone gets in instantly.">
      {draft.steps.length === 0 ? (
        <div className="admin-empty-set">No steps — the round is open to everyone.</div>
      ) : (
        <ol className="bnn-steps">
          {draft.steps.map((s, i) => (
            <li key={s} className="bnn-steps__row">
              <span className="bnn-steps__n">{i + 1}</span>
              <span className="bnn-steps__name">{STEP_NAME[s]}</span>
              <button type="button" className="bnn-icon" aria-label={`Move ${STEP_NAME[s]} up`} disabled={i === 0} onClick={() => setSteps(move(draft.steps, i, -1))}>↑</button>
              <button type="button" className="bnn-icon" aria-label={`Move ${STEP_NAME[s]} down`} disabled={i === draft.steps.length - 1} onClick={() => setSteps(move(draft.steps, i, 1))}>↓</button>
              <button type="button" className="bnn-icon" aria-label={`Remove ${STEP_NAME[s]}`} onClick={() => setSteps(draft.steps.filter((x) => x !== s))}>✕</button>
            </li>
          ))}
        </ol>
      )}
      {missing.length > 0 && (
        <div className="bnn-row">
          {missing.map((s) => (
            <button key={s} type="button" className="admin-btn admin-btn--ghost" onClick={() => setSteps(s === "form" ? ["form", ...draft.steps] : [...draft.steps, s])}>
              + {STEP_NAME[s]}
            </button>
          ))}
        </div>
      )}
      <FieldError message={errorFor("steps")} />
    </Fieldset>
  );
}

export function PaymentFields({ draft, onChange, errorFor, currency, money, onlineAvailable }: FieldsProps) {
  const p = draft.payment;
  const [amountText, setAmountText] = useState(p.amountCents > 0 ? String(p.amountCents / 100) : "");
  const [amountError, setAmountError] = useState("");
  const set = (patch: Partial<PaidAccessSettings["payment"]>) => onChange({ ...draft, payment: { ...p, ...patch } });
  const typeAmount = (text: string) => {
    setAmountText(text);
    const r = parseAmountCents(text);
    setAmountError(r.ok || !text.trim() ? "" : r.error);
    set({ amountCents: r.ok ? r.value : 0 });
  };
  return (
    <Fieldset title="Payment" hint="Payments are only counted once the store checks the proof (or a verified online payment arrives).">
      <div className="bnn-grid">
        <label className="bnn-field">
          <span className="admin-field__label">Amount ({currency})</span>
          <input className="admin-input" inputMode="decimal" placeholder="500" value={amountText} onChange={(e) => typeAmount(e.target.value)} aria-invalid={!!(amountError || errorFor("payment.amountCents"))} />
          <FieldError message={amountError || errorFor("payment.amountCents")} />
        </label>
        <div className="bnn-field" role="radiogroup" aria-label="Full payment or deposit">
          <span className="admin-field__label">This is a…</span>
          {(["full", "deposit"] as const).map((m) => (
            <label key={m} className="bnn-choice">
              <input type="radio" checked={p.amountMode === m} onChange={() => set({ amountMode: m })} />
              {m === "full" ? "Fixed price per slot" : "Deposit (credited to their group-buy order)"}
            </label>
          ))}
        </div>
        <label className="bnn-field">
          <span className="admin-field__label">How members pay</span>
          <select className="admin-input" value={p.method} onChange={(e) => set({ method: e.target.value as PaidAccessSettings["payment"]["method"] })} aria-invalid={!!errorFor("payment.method")}>
            <option value="manual">Proof upload (GCash, bank)</option>
            <option value="online" disabled={!onlineAvailable}>Online payment{onlineAvailable ? "" : " — not connected yet"}</option>
            <option value="either" disabled={!onlineAvailable}>Either{onlineAvailable ? "" : " — not connected yet"}</option>
          </select>
          <FieldError message={errorFor("payment.method")} />
        </label>
        <label className="bnn-field">
          <span className="admin-field__label">Release an unpaid slot after</span>
          <select
            className="admin-input"
            value={p.windowMinutes === null ? "" : String(p.windowMinutes)}
            onChange={(e) => set({ windowMinutes: e.target.value ? Number(e.target.value) : null })}
          >
            {WINDOWS.map((w) => (
              <option key={w.label} value={w.value === null ? "" : String(w.value)}>
                {w.label}
              </option>
            ))}
            {p.windowMinutes !== null && !WINDOWS.some((w) => w.value === p.windowMinutes) && <option value={String(p.windowMinutes)}>{p.windowMinutes} minutes</option>}
          </select>
          <FieldError message={errorFor("payment.windowMinutes")} />
        </label>
      </div>
      {p.amountCents > 0 && <p className="admin-field__hint">Members pay {money(p.amountCents)}.</p>}
    </Fieldset>
  );
}

const newQuestion = (n: number): PaidAccessQuestion => ({ id: `q${Date.now().toString(36)}${n}`, label: "", kind: "short", required: true, options: [] });

export function FormFields({ draft, onChange, errorFor, errorAt }: FieldsProps) {
  const qs = draft.form.questions;
  const setQs = (questions: PaidAccessQuestion[]) => onChange({ ...draft, form: { questions } });
  const update = (i: number, patch: Partial<PaidAccessQuestion>) => setQs(qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  return (
    <Fieldset title="Application form" hint="Members answer these before anything else. Mark a question optional if it isn't needed.">
      <div className="bnn-questions">
        {qs.map((q, i) => (
          <div key={q.id} className="bnn-question">
            <input className="admin-input" placeholder="Question" value={q.label} onChange={(e) => update(i, { label: e.target.value })} aria-label={`Question ${i + 1}`} aria-invalid={!!errorFor(`form.questions.${i}`)} />
            <div className="bnn-row">
              <select className="admin-input bnn-auto" value={q.kind} onChange={(e) => update(i, { kind: e.target.value as PaidAccessQuestion["kind"] })} aria-label="Answer type">
                <option value="short">Short answer</option>
                <option value="long">Long answer</option>
                <option value="choice">Pick one</option>
              </select>
              <label className="bnn-choice">
                <input type="checkbox" checked={q.required} onChange={(e) => update(i, { required: e.target.checked })} />
                Required
              </label>
              <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setQs(qs.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
            {q.kind === "choice" && (
              <input
                className="admin-input"
                placeholder="Options, separated by commas"
                defaultValue={q.options.join(", ")}
                onBlur={(e) => update(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })}
                aria-label="Options"
              />
            )}
            <FieldError message={errorFor(`form.questions.${i}`)} />
          </div>
        ))}
      </div>
      <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setQs([...qs, newQuestion(qs.length)])}>
        + Add question
      </button>
      <FieldError message={errorAt("form.questions")} />
    </Fieldset>
  );
}

export function CapacityFields({ draft, onChange, errorFor }: FieldsProps) {
  const c = draft.capacity;
  const set = (patch: Partial<PaidAccessSettings["capacity"]>) => onChange({ ...draft, capacity: { ...c, ...patch } });
  return (
    <Fieldset title="Slots" hint="Slots are held from the moment someone starts joining. A released or rejected slot goes to the waitlist first.">
      <div className="bnn-row">
        <label className="bnn-choice">
          <input type="checkbox" checked={c.maxSlots !== null} onChange={(e) => set(e.target.checked ? { maxSlots: 30 } : { maxSlots: null, waitlist: false })} />
          Limit the number of members
        </label>
        {c.maxSlots !== null && (
          <input
            className="admin-input bnn-num"
            type="number"
            min={1}
            value={c.maxSlots}
            onChange={(e) => set({ maxSlots: e.target.value === "" ? 1 : Math.floor(Number(e.target.value)) })}
            aria-label="Maximum slots"
            aria-invalid={!!errorFor("capacity.maxSlots")}
          />
        )}
      </div>
      <label className="bnn-choice">
        <input type="checkbox" checked={c.waitlist} disabled={c.maxSlots === null} onChange={(e) => set({ waitlist: e.target.checked })} />
        When full, put new people on a waitlist (otherwise they&apos;re told it&apos;s full)
      </label>
      <FieldError message={errorFor("capacity.maxSlots") ?? errorFor("capacity.waitlist")} />
    </Fieldset>
  );
}

const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export function ScheduleFields({ draft, onChange, errorFor }: FieldsProps) {
  const s = draft.schedule;
  const set = (patch: Partial<PaidAccessSettings["schedule"]>) => onChange({ ...draft, schedule: { ...s, ...patch } });
  return (
    <Fieldset title="Joining window" hint="Leave blank to follow the round's own dates. Payments are refused once joining closes.">
      <div className="bnn-grid">
        <label className="bnn-field">
          <span className="admin-field__label">Opens</span>
          <input className="admin-input" type="datetime-local" value={toLocal(s.opensAt)} onChange={(e) => set({ opensAt: fromLocal(e.target.value) })} />
        </label>
        <label className="bnn-field">
          <span className="admin-field__label">Closes</span>
          <input className="admin-input" type="datetime-local" value={toLocal(s.closesAt)} onChange={(e) => set({ closesAt: fromLocal(e.target.value) })} aria-invalid={!!errorFor("schedule.closesAt")} />
          <FieldError message={errorFor("schedule.closesAt")} />
        </label>
      </div>
    </Fieldset>
  );
}

const NOTIFY: { key: keyof PaidAccessSettings["notify"]; label: string }[] = [
  { key: "paid", label: "Member: payment confirmed" },
  { key: "approved", label: "Member: approved / off the waitlist" },
  { key: "rejected", label: "Member: rejected, refunded or removed" },
  { key: "newPending", label: "Store team: something is waiting for review" },
];

export function RulesFields({ draft, onChange, errorFor, onlineAvailable }: FieldsProps) {
  const paid = draft.steps.includes("payment");
  return (
    <>
      {paid && (
        <Fieldset title="If you reject someone who paid">
          {(["manual", "auto", "none"] as const).map((r) => (
            <label key={r} className="bnn-choice">
              <input type="radio" checked={draft.refundOnReject === r} disabled={r === "auto" && !onlineAvailable} onChange={() => onChange({ ...draft, refundOnReject: r })} />
              {r === "manual" ? "I refund them myself, then mark it refunded" : r === "auto" ? `Refund automatically (online payments)${onlineAvailable ? "" : " — not connected yet"}` : "No refund"}
            </label>
          ))}
          <FieldError message={errorFor("refundOnReject")} />
        </Fieldset>
      )}
      <Fieldset title="While someone is waiting, they can see">
        {(["summary", "nothing"] as const).map((v) => (
          <label key={v} className="bnn-choice">
            <input type="radio" checked={draft.pendingVisibility === v} onChange={() => onChange({ ...draft, pendingVisibility: v })} />
            {v === "summary" ? "A summary — name, dates, description, how many products (never prices)" : "Nothing but their own progress"}
          </label>
        ))}
      </Fieldset>
      <Fieldset title="Notifications">
        {NOTIFY.map((n) => (
          <label key={n.key} className="bnn-choice">
            <input type="checkbox" checked={draft.notify[n.key]} onChange={(e) => onChange({ ...draft, notify: { ...draft.notify, [n.key]: e.target.checked } })} />
            {n.label}
          </label>
        ))}
      </Fieldset>
    </>
  );
}
