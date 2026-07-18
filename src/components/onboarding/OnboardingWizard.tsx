"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, PartyPopper, Loader2 } from "lucide-react";
import {
  STEPS,
  validateStep,
  draftToPayload,
  useOnboardingDraft,
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
import { submitOnboardingAction } from "@/actions/public-onboarding";
import { SITE, type Package } from "@/marketing/config";
import type { PackagePaymentConfig } from "@/lib/platform/package-payment";

const STEP_COMPONENTS = [
  BusinessStep,
  BrandingStep,
  ProductsStep,
  OrdersStep,
  PaymentsStep,
  PackageStep,
  CheckoutStep,
];

export function OnboardingWizard({
  packagePayment,
  packages,
}: {
  packagePayment: PackagePaymentConfig;
  packages: Package[];
}) {
  const { draft, update, clearDraft } = useOnboardingDraft();
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<{ slug: string; url: string } | null>(null);

  // Preselect the package from ?plan=… (set by the marketing pricing cards).
  // The ₱699 trial offer is retired: a stale `?trial=1` link no longer opts in.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const plan = params.get("plan");
    if (plan && ["starter", "pro", "enterprise"].includes(plan)) {
      update({ packageKey: plan });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLast = step === STEPS.length - 1;
  const Current = STEP_COMPONENTS[step] as (p: StepProps) => React.ReactElement;

  function goNext() {
    const e = validateStep(step, draft);
    setErrors(e);
    if (Object.keys(e).length) return;
    if (isLast) {
      void submit();
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack() {
    setErrors({});
    setStep((s) => Math.max(0, s - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goTo(target: number) {
    // Allow jumping straight back to any earlier step. The draft is preserved,
    // so users can revise prior answers without losing what they've entered.
    if (target >= step) return;
    setErrors({});
    setStep(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await submitOnboardingAction(draftToPayload(draft));
      if ("error" in res) {
        setSubmitError(res.error);
      } else {
        clearDraft();
        setDone({ slug: res.slug, url: res.url });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setSubmitError("Something went wrong submitting your details. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="mk-wizard-wrap">
        <div className="mk-container" style={{ maxWidth: 760 }}>
          <div className="mk-wizard">
            <div className="mk-success">
              <span className="mk-success-badge">
                <PartyPopper size={34} />
              </span>
              <h1 className="mk-step-title" style={{ fontSize: "1.9rem" }}>You&apos;re all set! 🎉</h1>
              <p className="mk-step-sub" style={{ maxWidth: 460, margin: "8px auto 0" }}>
                Thanks for signing up. We&apos;ve received your details and payment proof, and your
                store is reserved at:
              </p>
              <div className="mk-success-url">{done.url}</div>
              <p className="mk-step-sub" style={{ maxWidth: 480, margin: "0 auto 8px" }}>
                Our team is now setting up and customizing your website. We&apos;ll confirm and
                publish it, then email <b>{draft.email || "you"}</b> with your login details.
              </p>
              <Link href="/" className="mk-btn mk-btn-primary" style={{ marginTop: 8 }}>
                Back to {SITE.brand}
                {SITE.brandSuffix}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <div className="mk-wizard-wrap">
      <div className="mk-container" style={{ maxWidth: 760 }}>
        <div style={{ marginBottom: 18 }}>
          <Link href="/" className="mk-link" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <ArrowLeft size={16} /> Back to home
          </Link>
        </div>

        <div className="mk-wizard">
          <div className="mk-wizard-head">
            {step === 0 ? (
              <Link href="/" className="mk-wizard-back" aria-label="Back to home">
                <ArrowLeft size={18} />
              </Link>
            ) : (
              <button
                type="button"
                className="mk-wizard-back"
                onClick={goBack}
                disabled={submitting}
                aria-label={`Back to ${STEPS[step - 1].title}`}
              >
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

          <div className="mk-steps-rail" role="list" aria-label="Onboarding steps">
            {STEPS.map((s, i) => {
              const state = i === step ? "active" : i < step ? "done" : "upcoming";
              const canGoBack = i < step;
              return (
                <button
                  key={s.key}
                  type="button"
                  role="listitem"
                  className="mk-step-dot"
                  data-state={state}
                  onClick={() => goTo(i)}
                  disabled={!canGoBack || submitting}
                  aria-label={canGoBack ? `Go back to ${s.title}` : s.title}
                >
                  {i < step && <Check size={13} />}
                  {s.title.split(" ")[0]}
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
            <button type="button" className="mk-btn mk-btn-ghost" onClick={goBack} disabled={step === 0 || submitting}>
              <ArrowLeft size={16} /> Back
            </button>
            <button type="button" className="mk-btn mk-btn-primary" onClick={goNext} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 size={16} className="mk-spin" /> Submitting…
                </>
              ) : isLast ? (
                <>
                  Submit &amp; Finish <Check size={16} />
                </>
              ) : (
                <>
                  Continue <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
