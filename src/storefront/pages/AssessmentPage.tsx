"use client";

// Storefront Assessment quiz (#assessment): intro → five steps (consent, about
// you, medical history, goals, experience & preferences) → a recommendation
// built from THIS store's catalog. The answers are saved for the owner's
// follow-up; the recommendation is computed here, so a failed save never costs
// the shopper their result. Each recommended product opens its own quick-view
// (#p/<slug>), which owns variations, stock and add-to-cart.

import { useMemo, useState } from "react";
import "../content-pages.css";
import type { Brand, Product } from "../types";
import { useStore } from "../store";
import { BackLink } from "../components/BackLink";
import { imageUrl } from "@/lib/media/image-url";
import { productHash } from "@/lib/storefront/product-link";
import { effectiveBasePrice } from "@/lib/storefront/sale";
import { submitAssessmentAction } from "@/actions/assessment";
import {
  EXPERIENCE_LEVELS,
  NONE_OF_THE_ABOVE,
  NO_PREFERENCE,
  normalizeAssessmentConfig,
  recommendProducts,
  type AssessmentConfig,
} from "@/lib/storefront/assessment";

const STEPS = ["Consent", "About you", "History", "Goals", "Preferences"] as const;
const LAST_STEP = STEPS.length - 1;
/** Long enough to read as "working on it", short enough not to stall. */
const ANALYZE_MS = 1100;
const REC_IMAGE_WIDTH = 480;

type Answers = {
  consent: boolean;
  fullName: string;
  email: string;
  ageRange: string;
  location: string;
  conditions: string[];
  goals: string[];
  experience: string;
  frequency: string;
};

const EMPTY: Answers = {
  consent: false,
  fullName: "",
  email: "",
  ageRange: "",
  location: "",
  conditions: [],
  goals: [],
  experience: "",
  frequency: NO_PREFERENCE,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The blocking problem on a step, or "" when the shopper may continue. */
function stepError(step: number, a: Answers): string {
  if (step === 0 && !a.consent) return "Please accept the terms to continue.";
  if (step === 1) {
    if (!a.fullName.trim()) return "Please enter your name.";
    if (!EMAIL_RE.test(a.email.trim())) return "Please enter a valid email address.";
    if (!a.ageRange) return "Please choose your age range.";
  }
  if (step === 2 && a.conditions.length === 0) return `Pick any that apply, or "${NONE_OF_THE_ABOVE}".`;
  if (step === 3 && a.goals.length === 0) return "Choose at least one goal.";
  if (step === 4 && !a.experience) return "Choose your experience level.";
  return "";
}

function Tick() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Option({
  type,
  name,
  checked,
  onChange,
  label,
  hint,
}: {
  type: "checkbox" | "radio";
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className={`asm-option ${type === "radio" ? "asm-option--radio" : ""} ${checked ? "is-on" : ""}`}>
      <input type={type} name={name} checked={checked} onChange={onChange} />
      <span className="asm-option__tick">{checked && <Tick />}</span>
      <span className="asm-option__label">
        {label}
        {hint && <span className="asm-option__hint">{hint}</span>}
      </span>
    </label>
  );
}

const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

function StepBody({
  step,
  a,
  set,
  config,
}: {
  step: number;
  a: Answers;
  set: (patch: Partial<Answers>) => void;
  config: AssessmentConfig;
}) {
  if (step === 0) {
    return (
      <>
        <h2 className="asm-step__title">Before we start</h2>
        <p className="asm-step__hint">Please review and accept our terms.</p>
        <div className="asm-consent">{config.consentText}</div>
        <Option
          type="checkbox"
          name="consent"
          checked={a.consent}
          onChange={() => set({ consent: !a.consent })}
          label="I accept the terms and understand this is not medical advice"
        />
      </>
    );
  }
  if (step === 1) {
    return (
      <>
        <h2 className="asm-step__title">Tell us about yourself</h2>
        <p className="asm-step__hint">So we can follow up with your recommendation.</p>
        <div className="asm-fields">
          <div className="asm-field">
            <label htmlFor="asm-name">Full name *</label>
            <input id="asm-name" className="asm-input" autoComplete="name" value={a.fullName} maxLength={120}
              onChange={(e) => set({ fullName: e.target.value })} placeholder="Jane Doe" />
          </div>
          <div className="asm-field">
            <label htmlFor="asm-email">Email address *</label>
            <input id="asm-email" className="asm-input" type="email" autoComplete="email" inputMode="email"
              value={a.email} maxLength={160} onChange={(e) => set({ email: e.target.value })} placeholder="jane@example.com" />
          </div>
          <div className="asm-field">
            <label htmlFor="asm-age">Age range *</label>
            <select id="asm-age" className="asm-input" value={a.ageRange} onChange={(e) => set({ ageRange: e.target.value })}>
              <option value="">Select age range</option>
              {config.ageRanges.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="asm-field">
            <label htmlFor="asm-loc">City / Province</label>
            <input id="asm-loc" className="asm-input" autoComplete="address-level2" value={a.location} maxLength={120}
              onChange={(e) => set({ location: e.target.value })} placeholder="e.g. Makati, Metro Manila" />
          </div>
        </div>
      </>
    );
  }
  if (step === 2) {
    const pickNone = () => set({ conditions: a.conditions.includes(NONE_OF_THE_ABOVE) ? [] : [NONE_OF_THE_ABOVE] });
    const pick = (c: string) => set({ conditions: toggle(a.conditions.filter((x) => x !== NONE_OF_THE_ABOVE), c) });
    return (
      <>
        <h2 className="asm-step__title">Medical history</h2>
        <p className="asm-step__hint">Have you been diagnosed with any of the following? This helps us keep you safe.</p>
        <div className="asm-options">
          {config.conditions.map((c) => (
            <Option key={c} type="checkbox" name="conditions" checked={a.conditions.includes(c)} onChange={() => pick(c)} label={c} />
          ))}
          <Option type="checkbox" name="conditions" checked={a.conditions.includes(NONE_OF_THE_ABOVE)} onChange={pickNone} label={NONE_OF_THE_ABOVE} />
        </div>
      </>
    );
  }
  if (step === 3) {
    return (
      <>
        <h2 className="asm-step__title">What are your goals?</h2>
        <p className="asm-step__hint">Select all that apply — your first pick is treated as your main goal.</p>
        <div className="asm-options">
          {config.goals.map((g) => (
            <Option key={g.id} type="checkbox" name="goals" checked={a.goals.includes(g.label)}
              onChange={() => set({ goals: toggle(a.goals, g.label) })} label={g.label} />
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      <h2 className="asm-step__title">Experience &amp; preferences</h2>
      <p className="asm-step__hint">Where are you starting from?</p>
      <div className="asm-options asm-options--stack" role="radiogroup" aria-label="Experience level">
        {EXPERIENCE_LEVELS.map((l) => (
          <Option key={l.id} type="radio" name="experience" checked={a.experience === l.id}
            onChange={() => set({ experience: l.id })} label={l.label} hint={l.hint} />
        ))}
      </div>
      <div className="asm-field" style={{ marginTop: 22 }}>
        <label htmlFor="asm-freq">Preferred frequency</label>
        <select id="asm-freq" className="asm-input" value={a.frequency} onChange={(e) => set({ frequency: e.target.value })}>
          <option value={NO_PREFERENCE}>{NO_PREFERENCE}</option>
          {config.frequencies.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>
    </>
  );
}

function priceLabel(p: Product): string {
  const prices = p.variations?.length ? p.variations.map((v) => v.price) : [effectiveBasePrice(p)];
  const low = Math.min(...prices);
  const from = p.variations && new Set(prices).size > 1 ? "from " : "";
  return `${from}${p.currency}${low.toLocaleString()}`;
}

function RecCard({ product, top }: { product: Product; top?: boolean }) {
  return (
    <a className={`asm-rec ${top ? "asm-rec--top" : ""}`} href={productHash(product)}>
      <div className="asm-rec__media">
        {product.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl(product.image, { width: REC_IMAGE_WIDTH })} alt="" loading="lazy" decoding="async" />
        )}
      </div>
      {top && <span className="asm-rec__flag">Top match</span>}
      <div className="asm-rec__body">
        <span className="asm-rec__name">{product.name}</span>
        {product.description && <span className="asm-rec__desc">{product.description}</span>}
        <div className="asm-rec__foot">
          <span className="asm-rec__price">{priceLabel(product)}</span>
          <span className="btn btn-secondary" style={{ padding: "6px 12px", fontSize: 13 }}>View</span>
        </div>
      </div>
    </a>
  );
}

function Results({
  answers,
  config,
  products,
  saveNote,
  onRetake,
}: {
  answers: Answers;
  config: AssessmentConfig;
  products: Product[];
  saveNote: string;
  onRetake: () => void;
}) {
  const { primary, secondary } = useMemo(
    () => recommendProducts(products, answers.goals, config),
    [products, answers.goals, config],
  );
  const level = EXPERIENCE_LEVELS.find((l) => l.id === answers.experience)?.label ?? "";

  return (
    <div>
      <header className="asm-results__head">
        <span className="asm-badge">
          <Tick /> Assessment complete
        </span>
        <h1 className="cp-title">Your custom protocol</h1>
        <p className="cp-lede">
          Based on your goal{answers.goals.length > 1 ? "s" : ""} of <strong>{answers.goals.join(", ")}</strong>
          {level && <> and your experience (<strong>{level}</strong>)</>}.
        </p>
        {saveNote && <p className="asm-step__hint" style={{ marginTop: 10 }}>{saveNote}</p>}
      </header>

      <section className="asm-section" aria-labelledby="asm-core">
        <div className="asm-section__head">
          <span className="asm-section__num">1</span>
          <div>
            <h2 className="asm-section__title" id="asm-core">Core picks</h2>
            <p className="asm-section__hint">For your main goal: {answers.goals[0]}.</p>
          </div>
        </div>
        {primary.length ? (
          <div className="asm-recs">
            {primary.map((p, i) => <RecCard key={p.id} product={p} top={i === 0} />)}
          </div>
        ) : (
          <div className="cp-empty">No direct match in our shop yet — message us and we&apos;ll help you choose.</div>
        )}
      </section>

      {secondary.length > 0 && (
        <section className="asm-section" aria-labelledby="asm-support">
          <div className="asm-section__head">
            <span className="asm-section__num">2</span>
            <div>
              <h2 className="asm-section__title" id="asm-support">Supportive picks</h2>
              <p className="asm-section__hint">For your other goals.</p>
            </div>
          </div>
          <div className="asm-recs">
            {secondary.map((p) => <RecCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      <div className="asm-disclaimer">
        <h3>Please note</h3>
        <p>{config.disclaimer}</p>
        <div className="asm-actions">
          <a className="btn btn-primary" href="#catalog">Browse all products</a>
          <button type="button" className="btn btn-secondary" onClick={onRetake}>Retake assessment</button>
        </div>
      </div>
    </div>
  );
}

export function AssessmentPage({ brand, onBack }: { brand: Brand; onBack: () => void; onCheckout?: () => void }) {
  const { products } = useStore();
  const config = useMemo(() => normalizeAssessmentConfig(brand.assessment), [brand.assessment]);
  const [phase, setPhase] = useState<"intro" | "steps" | "analyzing" | "results">("intro");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [error, setError] = useState("");
  const [saveNote, setSaveNote] = useState("");

  const set = (patch: Partial<Answers>) => {
    setAnswers((prev) => ({ ...prev, ...patch }));
    setError("");
  };
  // Window top, not the container: scrollIntoView parks the container under the
  // sticky header, hiding the first line of each step and the results badge.
  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const next = () => {
    const problem = stepError(step, answers);
    if (problem) return setError(problem);
    if (step < LAST_STEP) {
      setStep(step + 1);
      scrollTop();
      return;
    }
    void submit();
  };

  const submit = async () => {
    setPhase("analyzing");
    scrollTop();
    const started = Date.now();
    let note = "";
    try {
      const res = await submitAssessmentAction({ ...answers });
      if ("error" in res) note = res.error;
    } catch {
      note = "We couldn't save your answers, but your recommendation is below.";
    }
    const wait = Math.max(0, ANALYZE_MS - (Date.now() - started));
    window.setTimeout(() => {
      setSaveNote(note);
      setPhase("results");
    }, wait);
  };

  const retake = () => {
    setAnswers(EMPTY);
    setStep(0);
    setSaveNote("");
    setPhase("intro");
    scrollTop();
  };

  return (
    <section className="page" id="assessment">
      <div className="page__container">
        <BackLink onClick={onBack} label="Back to Shop" />

        {phase === "results" ? (
          <Results answers={answers} config={config} products={products} saveNote={saveNote} onRetake={retake} />
        ) : (
          <div className="asm-shell">
            {phase === "intro" && (
              <div className="asm-intro">
                <div className="asm-intro__glyph" aria-hidden>
                  <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 3h6M10 3v6.5L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9.5V3" />
                    <path d="M7.5 14h9" />
                  </svg>
                </div>
                <h1 className="cp-title">{config.title}</h1>
                <p className="cp-lede">{config.intro}</p>
                <ul className="asm-perks">
                  <li><Tick /> About 2 minutes</li>
                  <li><Tick /> Matched to our catalog</li>
                  <li><Tick /> Answers stay with {brand.name}</li>
                </ul>
                <button type="button" className="btn btn-primary" onClick={() => setPhase("steps")}>
                  Start assessment
                </button>
              </div>
            )}

            {phase === "steps" && (
              <>
                <div className="asm-progress">
                  <div className="asm-progress__bar" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label="Assessment progress">
                    <div className="asm-progress__fill" style={{ transform: `scaleX(${(step + 1) / STEPS.length})` }} />
                  </div>
                  <div className="asm-progress__steps">
                    {STEPS.map((s, i) => (
                      <span key={s} aria-current={i === step ? "step" : undefined} className={i < step ? "is-done" : undefined}>
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="asm-step" key={step}>
                  {error && <p className="asm-error" role="alert">{error}</p>}
                  <StepBody step={step} a={answers} set={set} config={config} />
                </div>
                <div className="asm-nav">
                  {step > 0 ? (
                    <button type="button" className="btn btn-ghost" onClick={() => { setStep(step - 1); setError(""); }}>
                      Back
                    </button>
                  ) : (
                    <span />
                  )}
                  <button type="button" className="btn btn-primary" onClick={next}>
                    {step === LAST_STEP ? "See my recommendation" : "Next step"}
                  </button>
                </div>
              </>
            )}

            {phase === "analyzing" && (
              <div className="asm-analyzing" role="status" aria-live="polite">
                <div className="asm-analyzing__orb" />
                <h2 className="asm-step__title">Analyzing your profile…</h2>
                <p className="asm-step__hint">
                  Matching {answers.goals.length} goal{answers.goals.length === 1 ? "" : "s"} against our catalog.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
