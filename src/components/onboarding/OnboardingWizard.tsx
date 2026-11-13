"use client";

// /get-started — pay-first sign-up.
//   Phase "pay":     Your business → Choose your package → Pay & submit (the only
//                    steps counted in the progress rail).
//   Phase "details": optional post-payment steps (branding, products, orders,
//                    payments), each skippable — the team asks on WhatsApp.
//   Phase "done":    store address, reference, what happens next.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, PartyPopper, Loader2, CircleCheck } from "lucide-react";
import {
  STEPS,
  DETAILS_STEPS,
  validateStep,
  validateStepKey,
  draftToPayload,
  draftToDetails,
  prefillOrderDestination,
  useOnboardingDraft,
  type Draft,
  type SubmittedSignup,
} from "./useOnboardingForm";
import {
  BusinessStep,
  BrandingStep,
  ProductsStep,
  OrdersStep,
  PaymentsStep,
  PackageStep,
  CheckoutStep,
  type StepProps,
} from "./steps";
import { WhatsAppContact } from "./WhatsAppContact";
import {
  submitOnboardingAction,
  saveOnboardingLeadAction,
  updateOnboardingDetailsAction,
} from "@/actions/public-onboarding";
import { SITE, type Package } from "@/marketing/config";
import {
  visiblePackagePaymentMethods,
  type PackagePaymentConfig,
} from "@/lib/platform/package-payment";

// Pre-payment flow, in order (matches STEPS).
const STEP_COMPONENTS = [BusinessStep, PackageStep, CheckoutStep];

// Optional post-payment flow, in order (matches DETAILS_STEPS).
const DETAIL_COMPONENTS = [BrandingStep, ProductsStep, OrdersStep, PaymentsStep];

// A slow lead save must never hold the visitor on step 1.
const LEAD_SAVE_TIMEOUT_MS = 4000;

type Shared = {
  packagePayment: PackagePaymentConfig;
  packages: Package[];
};

function scrollTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function OnboardingWizard({ packagePayment, packages }: Shared) {
  const { draft, update, clearDraft, hydrated } = useOnboardingDraft();
  const [finished, setFinished] = useState<SubmittedSignup | null>(null);

  // Preselect the package from ?plan=… (set by the marketing pricing cards).
  useEffect(() => {
    const plan = new URLSearchParams(window.location.search).get("plan");
    if (plan && ["starter", "pro", "enterprise"].includes(plan)) update({ packageKey: plan });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish(signup: SubmittedSignup) {
    setFinished(signup);
    clearDraft();
    scrollTop();
  }

  return (
    <div className="mk-wizard-wrap">
      <div className="mk-container" style={{ maxWidth: 760 }}>
        <div
          style={{
            marginBottom: 18,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <Link href="/" className="mk-link" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <ArrowLeft size={16} /> Back to home
          </Link>
          <WhatsAppContact />
        </div>

        {finished ? (
          <DonePanel signup={finished} whatsapp={draft.whatsapp} />
        ) : hydrated && draft.submitted ? (
          <DetailsFlow
            draft={draft}
            update={update}
            signup={draft.submitted}
            onFinish={finish}
            {...{ packagePayment, packages }}
          />
        ) : (
          <PayFlow draft={draft} update={update} packagePayment={packagePayment} packages={packages} />
        )}
      </div>
    </div>
  );
}

/* ============================================================ pay phase */
function PayFlow({
  draft,
  update,
  packagePayment,
  packages,
}: Shared & { draft: Draft; update: (p: Partial<Draft>) => void }) {
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"lead" | "submit" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const methodIds = visiblePackagePaymentMethods(packagePayment).map((m) => m.id);
  const isLast = step === STEPS.length - 1;
  const Current = STEP_COMPONENTS[step] as (p: StepProps) => React.ReactElement;
  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  async function saveLead() {
    setBusy("lead");
    try {
      const res = await Promise.race([
        saveOnboardingLeadAction({
          businessName: draft.businessName,
          whatsapp: draft.whatsapp,
          contactPerson: draft.contactPerson,
          description: draft.description,
          leadToken: draft.leadToken || undefined,
          website: draft.website,
        }),
        new Promise<{ error: string }>((resolve) =>
          setTimeout(() => resolve({ error: "timed out" }), LEAD_SAVE_TIMEOUT_MS),
        ),
      ]);
      if ("token" in res) update({ leadToken: res.token, storeSlug: res.slug });
      else console.warn("[get-started] lead not saved:", res.error);
    } catch (e) {
      // Never block the visitor on a failed lead save.
      console.warn("[get-started] lead save failed", e);
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    setBusy("submit");
    setSubmitError(null);
    try {
      const res = await submitOnboardingAction(draftToPayload(draft), draft.leadToken || undefined);
      if ("error" in res) {
        setSubmitError(res.error);
        return;
      }
      update({
        submitted: { token: res.token, slug: res.slug, url: res.url, reference: res.reference },
        leadToken: "",
        termsAccepted: false,
        ...prefillOrderDestination(draft),
      });
      scrollTop();
    } catch {
      setSubmitError("Something went wrong submitting your details. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function goNext() {
    const e = validateStep(step, draft, { methodIds });
    setErrors(e);
    if (Object.keys(e).length) return;
    if (isLast) {
      await submit();
      return;
    }
    if (STEPS[step].key === "business") await saveLead();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    scrollTop();
  }

  function goTo(target: number) {
    // Jump back to any earlier step; the draft is preserved.
    if (target >= step) return;
    setErrors({});
    setStep(target);
    scrollTop();
  }

  return (
    <div className="mk-wizard">
      <div className="mk-wizard-head">
        {step === 0 ? (
          <Link href="/" className="mk-wizard-back" aria-label="Back to home">
            <ArrowLeft size={18} />
          </Link>
        ) : (
          <button type="button" className="mk-wizard-back" onClick={() => goTo(step - 1)}
            disabled={busy !== null} aria-label={`Back to ${STEPS[step - 1].title}`}>
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="mk-progress">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="mk-progress-meta">
          <b>
            Step {step + 1} of {STEPS.length}
          </b>
          <span>{pct}% complete</span>
        </div>
      </div>

      <div className="mk-steps-rail" role="list" aria-label="Sign-up steps">
        {STEPS.map((s, i) => {
          const state = i === step ? "active" : i < step ? "done" : "upcoming";
          const canGoBack = i < step;
          return (
            <button key={s.key} type="button" role="listitem" className="mk-step-dot" data-state={state}
              onClick={() => goTo(i)} disabled={!canGoBack || busy !== null}
              aria-label={canGoBack ? `Go back to ${s.title}` : s.title}>
              {i < step && <Check size={13} />}
              {s.rail}
            </button>
          );
        })}
      </div>

      <div className="mk-step-body">
        <h1 className="mk-step-title">{STEPS[step].title}</h1>
        <p className="mk-step-sub">{STEPS[step].subtitle}</p>
        <Current draft={draft} update={update} errors={errors} packagePayment={packagePayment} packages={packages} />
        {submitError && (
          <p className="mk-error" role="alert" style={{ marginTop: 10 }}>
            {submitError}
          </p>
        )}
      </div>

      <div className="mk-wizard-foot">
        <button type="button" className="mk-btn mk-btn-ghost" onClick={() => goTo(step - 1)}
          disabled={step === 0 || busy !== null}>
          <ArrowLeft size={16} /> Back
        </button>
        <button type="button" className="mk-btn mk-btn-primary" onClick={() => void goNext()} disabled={busy !== null}>
          {busy === "submit" ? (
            <>
              <Loader2 size={16} className="mk-spin" /> Submitting…
            </>
          ) : busy === "lead" ? (
            <>
              <Loader2 size={16} className="mk-spin" /> Saving…
            </>
          ) : isLast ? (
            <>
              Submit payment <Check size={16} />
            </>
          ) : (
            <>
              Continue <ArrowRight size={16} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ============================================================ details phase */
function DetailsFlow({
  draft,
  update,
  signup,
  onFinish,
  packagePayment,
  packages,
}: Shared & {
  draft: Draft;
  update: (p: Partial<Draft>) => void;
  signup: SubmittedSignup;
  onFinish: (s: SubmittedSignup) => void;
}) {
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Has the client answered (not skipped) any step? Only then is there anything to send.
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const meta = DETAILS_STEPS[step];
  const isLast = step === DETAILS_STEPS.length - 1;
  const Current = DETAIL_COMPONENTS[step] as (p: StepProps) => React.ReactElement;

  async function send() {
    setSending(true);
    setSendError(null);
    try {
      const res = await updateOnboardingDetailsAction(signup.token, draftToDetails(draft));
      if ("error" in res) setSendError(res.error);
      else onFinish(signup);
    } catch {
      setSendError("We couldn't send your details — please try again, or skip and message us on WhatsApp.");
    } finally {
      setSending(false);
    }
  }

  function advance() {
    setErrors({});
    setStep((s) => s + 1);
    scrollTop();
  }

  function onContinue() {
    const e = validateStepKey(meta.key, draft);
    setErrors(e);
    if (Object.keys(e).length) return;
    setTouched(true);
    if (isLast) void send();
    else advance();
  }

  function onSkip() {
    if (!isLast) return advance();
    if (touched) void send();
    else onFinish(signup);
  }

  return (
    <div className="mk-wizard">
      <div className="mk-step-body">
        <p className="mk-hint" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 0, color: "var(--green)", fontWeight: 600 }}>
          <CircleCheck size={16} aria-hidden="true" /> Payment submitted — your store is reserved at {signup.url}
        </p>
        <p className="mk-hint" style={{ margin: "4px 0 2px" }}>
          Help us build your store faster · Optional · {step + 1} of {DETAILS_STEPS.length}
        </p>
        <h1 className="mk-step-title">{meta.title}</h1>
        <p className="mk-step-sub">{meta.subtitle}</p>
        <Current draft={draft} update={update} errors={errors} packagePayment={packagePayment} packages={packages} />
        {sendError && (
          <p className="mk-error" role="alert" style={{ marginTop: 10 }}>
            {sendError}
          </p>
        )}
      </div>

      <div className="mk-wizard-foot" style={{ flexWrap: "wrap", gap: 10 }}>
        <button type="button" className="mk-btn mk-btn-ghost" onClick={() => { setErrors({}); setStep((s) => s - 1); }}
          disabled={step === 0 || sending}>
          <ArrowLeft size={16} /> Back
        </button>
        <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 10, marginLeft: "auto" }}>
          <button type="button" className="mk-btn mk-btn-ghost" onClick={onSkip} disabled={sending}>
            Skip — we&apos;ll ask you on WhatsApp
          </button>
          <button type="button" className="mk-btn mk-btn-primary" onClick={onContinue} disabled={sending}>
            {sending ? (
              <>
                <Loader2 size={16} className="mk-spin" /> Sending…
              </>
            ) : isLast ? (
              <>
                Send details <Check size={16} />
              </>
            ) : (
              <>
                Continue <ArrowRight size={16} />
              </>
            )}
          </button>
        </span>
      </div>
      <p className="mk-hint" style={{ textAlign: "center", padding: "0 0 18px" }}>
        <button type="button" className="mk-link" onClick={() => onFinish(signup)} disabled={sending}
          style={{ background: "none", border: 0, cursor: "pointer", font: "inherit" }}>
          Skip all and finish
        </button>
      </p>
    </div>
  );
}

/* ============================================================ done */
function DonePanel({ signup, whatsapp }: { signup: SubmittedSignup; whatsapp: string }) {
  return (
    <div className="mk-wizard">
      <div className="mk-success">
        <span className="mk-success-badge">
          <PartyPopper size={34} />
        </span>
        <h1 className="mk-step-title" style={{ fontSize: "1.9rem" }}>You&apos;re all set!</h1>
        <p className="mk-step-sub" style={{ maxWidth: 460, margin: "8px auto 0" }}>
          Thanks for signing up. We&apos;ve received your payment proof, and your store is reserved at:
        </p>
        <div className="mk-success-url">{signup.url}</div>
        <p className="mk-step-sub" style={{ margin: "0 auto 8px" }}>
          Reference: <b>{signup.reference}</b>
        </p>
        <p className="mk-step-sub" style={{ maxWidth: 480, margin: "0 auto 12px" }}>
          We&apos;ll build and publish your store within 2–5 days and message you on WhatsApp at{" "}
          <b>{whatsapp || "the number you gave us"}</b>.
        </p>
        <p style={{ margin: "0 auto 14px" }}>
          <WhatsAppContact message={`Hi! My Pepweb sign-up reference is ${signup.reference}.`} />
        </p>
        <Link href="/" className="mk-btn mk-btn-primary" style={{ marginTop: 8 }}>
          Back to {SITE.brand}
          {SITE.brandSuffix}
        </Link>
      </div>
    </div>
  );
}
