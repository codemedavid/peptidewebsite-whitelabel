"use client";

// The member's way into a gated group buy (#groupbuy, for a viewer the
// storefront locked out — brand.groupBuyTeaser). No account needed: a visitor
// types their email ("Already approved?" picks up an existing request; the
// join form takes it with the first step) and the browser gets the group-buy
// email pass. Then a clear stepper ("Step 2 of 3: Waiting for admin approval")
// and exactly ONE action for the next step; while the store reviews, the page
// re-checks on its own and unlocks the moment they're approved. Every word and
// rule comes from the server (../actions → the member's snapshot); nothing
// here decides access, and no amount is ever sent from here.

import { useCallback, useEffect, useState } from "react";

import type { Brand } from "@/storefront/types";
import { BackLink } from "@/storefront/components/BackLink";
import { gbCountdownLabel } from "@/lib/storefront/group-buy-page";
import type { GroupBuyJoinResult, GroupBuyJoinState, ShopGroupBuyTeaser } from "@/lib/mobile/shop-contract";
import {
  cancelPaidAccessJoinAction,
  continuePaidAccessWithEmailAction,
  forgetPaidAccessEmailAction,
  getPaidAccessJoinPageAction,
  startPaidAccessJoinAction,
  startPaidAccessOnlinePaymentAction,
  submitPaidAccessFormAction,
  submitPaidAccessProofAction,
  verifyPaidAccessEmailAction,
  type PaidAccessJoinPage as JoinPageResult,
  type PaidAccessJoinViewer,
} from "../actions";
import { ApplicationForm, PaymentAccounts, ProofForm, SentProof } from "./join-parts";
import { paidAccessJoinCss } from "./join-styles";

type Phase = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; state: GroupBuyJoinState };
type Run = (fn: () => Promise<GroupBuyJoinResult>) => Promise<void>;

/** sessionStorage key: AccountPage sends a shopper who left to sign in back here. */
export const PAID_ACCESS_JOIN_RETURN_KEY = "sf.gbJoinReturn";

const CANCELLABLE = new Set(["waitlisted", "form_pending", "payment_pending"]);
/** Waiting on the store: re-check so approval unlocks the page by itself. */
const WAITING = new Set(["payment_review", "approval_pending", "waitlisted"]);
const POLL_MS = 15_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GUEST: PaidAccessJoinViewer = { kind: "guest", email: "" };

function roundTiming(teaser: ShopGroupBuyTeaser): string {
  if (teaser.state === "live") return gbCountdownLabel(teaser.endsAt) || "Live now";
  if (teaser.state === "upcoming" && teaser.startsAt) {
    return `Opens ${new Date(teaser.startsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }
  return "Closed";
}

type Props = {
  brand: Brand;
  teaser: ShopGroupBuyTeaser;
  onBack: () => void;
  /** Open the store's own sign-in (#account) — optional; an email is enough. */
  onSignIn: () => void;
};

export function PaidAccessJoinPage({ brand, teaser, onBack, onSignIn }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [viewer, setViewer] = useState<PaidAccessJoinViewer>(GUEST);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");

  const apply = useCallback((res: GroupBuyJoinResult) => {
    if (res.ok) {
      setError("");
      setPhase({ kind: "ready", state: res.state });
      if (res.checkout) window.location.assign(res.checkout.url);
    } else setError(res.message);
  }, []);

  const applyPage = useCallback(
    (page: JoinPageResult) => {
      if (page.result.ok) setViewer(page.viewer);
      apply(page.result);
    },
    [apply],
  );

  const load = useCallback(
    () =>
      getPaidAccessJoinPageAction(teaser.id).then((page) => {
        if (page.result.ok) applyPage(page);
        else setPhase({ kind: "error", message: page.result.message });
      }),
    [teaser.id, applyPage],
  );

  useEffect(() => {
    load().catch(() => setPhase({ kind: "error", message: "We couldn't load this group buy. Please try again." }));
  }, [load]);

  const state = phase.kind === "ready" ? phase.state : null;
  const isWaiting = viewer.kind !== "guest" && !!state?.status && WAITING.has(state.status);

  // Approval needs no "verify again": re-check while the store reviews.
  useEffect(() => {
    if (!isWaiting) return;
    const check = () => {
      if (document.visibilityState === "visible") void load().catch(() => undefined); // offline — next tick retries
    };
    const timer = window.setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [isWaiting, load]);

  const run: Run = async (fn) => {
    setIsBusy(true);
    try {
      apply(await fn());
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsBusy(false);
    }
  };

  /** Email-only join: who they are + Join, then (if that's where they landed) the first step. */
  const joinWithEmail =
    (expect: GroupBuyJoinState["status"], next?: () => Promise<GroupBuyJoinResult>) => async (): Promise<GroupBuyJoinResult> => {
      const page = await continuePaidAccessWithEmailAction(teaser.id, email);
      if (!page.result.ok) return page.result;
      setViewer(page.viewer);
      // Already further along (a returning email, the waitlist): show that instead.
      return next && page.result.state.status === expect ? next() : page.result;
    };

  const verify = async (typed: string) => {
    setIsBusy(true);
    try {
      const page = await verifyPaidAccessEmailAction(teaser.id, typed);
      if (page.result.ok) applyPage(page);
      else {
        setError(page.result.message);
        if (page.result.code === "not_found") setEmail(typed);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsBusy(false);
    }
  };

  const forget = async () => {
    setIsBusy(true);
    try {
      await forgetPaidAccessEmailAction();
      setViewer(GUEST);
      setEmail("");
      await load();
    } finally {
      setIsBusy(false);
    }
  };

  const steps = state?.stepper.steps ?? [];
  const showSummary = teaser.visibility === "summary" && teaser.summary;
  const isGuest = viewer.kind === "guest";

  return (
    <section className="page gbpage bnnjoin" id="groupbuy" aria-labelledby="bnnjoin-title">
      <style>{paidAccessJoinCss}</style>
      <div className="page__container gbpage__narrow">
        <BackLink onClick={onBack} label="Back to store" />

        <header className="bnnjoin__hero">
          <div className="bnnjoin__hero-top">
            <span className="gbpage__pill">● Members only</span>
            <span className="gbpage__countdown">{roundTiming(teaser)}</span>
          </div>
          <h1 className="bnnjoin__title font-display" id="bnnjoin-title">{teaser.name}</h1>
          {teaser.copy?.intro.trim() && <p className="bnnjoin__muted bnnjoin__intro">{teaser.copy.intro}</p>}
          <ol className="bnnjoin__way" aria-label="How to get in">
            {teaser.steps.map((s, i) => (
              <li key={`${s}-${i}`}>{s}</li>
            ))}
          </ol>
        </header>

        {showSummary && (
          <div className="bnnjoin__card bnnjoin__summary">
            {teaser.summary!.description && <p className="bnnjoin__muted">{teaser.summary!.description}</p>}
            <dl className="bnnjoin__facts">
              {teaser.summary!.productCount > 0 && <div><dt>Products</dt><dd>{teaser.summary!.productCount}</dd></div>}
              {teaser.summary!.deliveryEta && <div><dt>Delivery</dt><dd>{teaser.summary!.deliveryEta}</dd></div>}
              {teaser.summary!.maxSlots !== null && <div><dt>Slots</dt><dd>{teaser.summary!.slotsTaken} of {teaser.summary!.maxSlots} taken</dd></div>}
            </dl>
          </div>
        )}

        {state && isGuest && <AlreadyApproved isBusy={isBusy} onVerify={(typed) => void verify(typed)} />}
        {viewer.kind === "email" && (
          <p className="bnnjoin__as">
            Continuing as <strong>{viewer.email}</strong>
            <button type="button" className="bnnjoin__link" disabled={isBusy} onClick={() => void forget()}>Not you?</button>
          </p>
        )}

        {steps.length > 0 && (
          <ol className="bnnjoin__steps" style={{ gridTemplateColumns: `repeat(${steps.length + 1}, 1fr)` }} aria-label="Your progress">
            {steps.map((s, i) => (
              <li key={s.key} className={`bnnjoin__step is-${s.state}`} aria-current={s.state === "current" ? "step" : undefined}>
                <span className="bnnjoin__dot">{s.state === "done" ? "✓" : i + 1}</span>
                <span>{s.label}</span>
              </li>
            ))}
            <li className={`bnnjoin__step is-${state?.canAccess ? "done" : "upcoming"}`}>
              <span className="bnnjoin__dot">★</span>
              <span>{state?.stepper.accessLabel ?? "Access"}</span>
            </li>
          </ol>
        )}

        {phase.kind === "loading" && <div className="bnnjoin__card bnnjoin__skeleton" aria-busy="true" aria-label="Loading" />}
        {phase.kind === "error" && <div className="bnnjoin__card bnnjoin__alert" role="alert">{phase.message}</div>}

        {state && (
          <>
            {(!isGuest || !state.canJoin) && (
              <div className={`bnnjoin__card bnnjoin__status is-${state.stepper.tone}`} role="status" aria-live="polite">
                <div className="bnnjoin__status-title">{state.stepper.headline}</div>
                <p className="bnnjoin__muted">{state.stepper.detail}</p>
                {state.status === "rejected" && state.refundStatus === "refunded" && <p className="bnnjoin__muted">Your payment was refunded.</p>}
                {!state.window.open && state.window.message && state.status !== "active" && <p className="bnnjoin__muted">{state.window.message}</p>}
                {isWaiting && <p className="bnnjoin__muted">No need to come back and check — this page unlocks by itself once you’re approved.</p>}
              </div>
            )}
            {error && <div className="bnnjoin__card bnnjoin__alert" role="alert">{error}</div>}
            {isGuest ? (
              state.canJoin && <GuestJoin state={state} email={email} onEmail={setEmail} isBusy={isBusy} onRun={run} join={joinWithEmail} groupBuyId={teaser.id} />
            ) : (
              <NextStep state={state} isBusy={isBusy} onRun={run} groupBuyId={teaser.id} isEmailOnly={viewer.kind === "email"} />
            )}
            {viewer.kind === "account" && state.status && (CANCELLABLE.has(state.status) || (state.status === "approval_pending" && !steps.some((s) => s.key === "payment" && s.state === "done"))) && (
              <button type="button" className="bnnjoin__link bnnjoin__leave" disabled={isBusy} onClick={() => void run(() => cancelPaidAccessJoinAction(teaser.id))}>
                Leave this group buy
              </button>
            )}
            {isGuest && brand.customerAccountsEnabled && <SignInLink onSignIn={onSignIn} />}
          </>
        )}
      </div>
    </section>
  );
}

/** "Already approved?" — a returning member picks their request back up by email. */
function AlreadyApproved({ isBusy, onVerify }: { isBusy: boolean; onVerify: (email: string) => void }) {
  const [typed, setTyped] = useState("");
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onVerify(typed.trim());
  };
  return (
    <form className="bnnjoin__card bnnjoin__verify" onSubmit={handleSubmit}>
      <label className="bnnjoin__verify-label" htmlFor="bnnjoin-verify">Already joined or approved?</label>
      <input
        id="bnnjoin-verify"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@gmail.com"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        required
      />
      <button type="submit" className="btn btn-primary bnnjoin__verify-btn" disabled={isBusy || !EMAIL_RE.test(typed.trim())}>
        {isBusy ? "Checking…" : "Verify email"}
      </button>
    </form>
  );
}

type GuestJoinProps = {
  state: GroupBuyJoinState;
  email: string;
  onEmail: (email: string) => void;
  isBusy: boolean;
  onRun: Run;
  join: (expect: GroupBuyJoinState["status"], next?: () => Promise<GroupBuyJoinResult>) => () => Promise<GroupBuyJoinResult>;
  groupBuyId: string;
};

/** A newcomer: their email + the round's first step, sent together. */
function GuestJoin({ state, email, onEmail, isBusy, onRun, join, groupBuyId }: GuestJoinProps) {
  const first = state.stepper.steps[0]?.key;
  const hasEmail = EMAIL_RE.test(email.trim());
  const emailCard = (
    <div className="bnnjoin__card">
      <label className="bnnjoin__field">
        <span>Your email</span>
        <input type="email" inputMode="email" autoComplete="email" placeholder="you@gmail.com" value={email} onChange={(e) => onEmail(e.target.value)} required />
      </label>
      <p className="bnnjoin__hint">No account needed — this email is how the store knows it’s you. We’ll unlock checkout for it once you’re approved.</p>
    </div>
  );

  if (first === "payment") {
    return (
      <>
        {state.paymentOptions.manual && <PaymentAccounts methods={state.paymentAccounts} amount={state.amountLabel} />}
        {emailCard}
        {state.paymentOptions.online && (
          <div className="bnnjoin__card">
            <h2 className="bnnjoin__h2">Pay {state.amountLabel} online</h2>
            <button
              type="button"
              className="btn btn-primary bnnjoin__cta"
              disabled={isBusy || !hasEmail}
              onClick={() => void onRun(join("payment_pending", () => startPaidAccessOnlinePaymentAction(groupBuyId)))}
            >
              {isBusy ? "Opening checkout…" : `Pay ${state.amountLabel}`}
            </button>
          </div>
        )}
        {state.paymentOptions.manual && (
          <ProofForm
            groupBuyId={groupBuyId}
            methods={state.paymentAccounts}
            isBusy={isBusy}
            onRun={onRun}
            ready={hasEmail}
            cta="Submit for review"
            submit={(form) => join("payment_pending", () => submitPaidAccessProofAction(form))()}
          />
        )}
      </>
    );
  }
  if (first === "form") {
    return (
      <>
        {emailCard}
        <ApplicationForm
          questions={state.formQuestions}
          groupBuyId={groupBuyId}
          isBusy={isBusy}
          onRun={onRun}
          ready={hasEmail}
          submit={(answers) => join("form_pending", () => submitPaidAccessFormAction(groupBuyId, answers))()}
        />
      </>
    );
  }
  return (
    <>
      {emailCard}
      <div className="bnnjoin__card">
        <button type="button" className="btn btn-primary bnnjoin__cta" disabled={isBusy || !hasEmail} onClick={() => void onRun(join(null))}>
          {isBusy ? "Joining…" : state.stepper.action?.label ?? "Join"}
        </button>
      </div>
    </>
  );
}

function SignInLink({ onSignIn }: { onSignIn: () => void }) {
  const handleSignIn = () => {
    try {
      sessionStorage.setItem(PAID_ACCESS_JOIN_RETURN_KEY, "1");
    } catch {
      /* storage blocked — they'll tap Group Buy again */
    }
    onSignIn();
  };
  return (
    <p className="bnnjoin__muted bnnjoin__signin">
      Have an account?{" "}
      <button type="button" className="bnnjoin__link" onClick={handleSignIn}>Sign in instead</button>
    </p>
  );
}

type StepProps = {
  state: GroupBuyJoinState;
  isBusy: boolean;
  onRun: Run;
  groupBuyId: string;
  /** Joined with just an email: the proof's details stay private. */
  isEmailOnly: boolean;
};

/** The one action for the member's next step (or the way into the round). */
function NextStep({ state, isBusy, onRun, groupBuyId, isEmailOnly }: StepProps) {
  const action = state.stepper.action;
  if (state.canAccess) {
    return (
      <div className="bnnjoin__card">
        <button type="button" className="btn btn-primary bnnjoin__cta" onClick={() => window.location.reload()}>Open the group buy</button>
      </div>
    );
  }
  if (state.status === "payment_review" && state.proof) {
    return <SentProof groupBuyId={groupBuyId} proof={state.proof} amount={state.amountLabel} showDetails={!isEmailOnly} />;
  }
  if (!action) return null;
  if (action.kind === "join") {
    if (!state.canJoin) return null;
    return (
      <div className="bnnjoin__card">
        <button type="button" className="btn btn-primary bnnjoin__cta" disabled={isBusy} onClick={() => void onRun(() => startPaidAccessJoinAction(groupBuyId))}>
          {isBusy ? "Joining…" : action.label}
        </button>
      </div>
    );
  }
  if (action.kind === "fill_form") return <ApplicationForm questions={state.formQuestions} groupBuyId={groupBuyId} isBusy={isBusy} onRun={onRun} />;
  return (
    <>
      {state.proof?.rejectReason && (
        <div className="bnnjoin__card bnnjoin__alert" role="alert">Your last proof wasn’t accepted: {state.proof.rejectReason}</div>
      )}
      {state.paymentOptions.online && (
        <div className="bnnjoin__card">
          <h2 className="bnnjoin__h2">Pay {state.amountLabel} online</h2>
          <button type="button" className="btn btn-primary bnnjoin__cta" disabled={isBusy} onClick={() => void onRun(() => startPaidAccessOnlinePaymentAction(groupBuyId))}>
            {isBusy ? "Opening checkout…" : `Pay ${state.amountLabel}`}
          </button>
        </div>
      )}
      {state.paymentOptions.manual && (
        <>
          <PaymentAccounts methods={state.paymentAccounts} amount={state.amountLabel} />
          <ProofForm groupBuyId={groupBuyId} methods={state.paymentAccounts} isBusy={isBusy} onRun={onRun} />
        </>
      )}
    </>
  );
}

/** The home's slim "members only" strip → #groupbuy. Live/upcoming only. */
export function PaidAccessJoinStrip({ teaser, onOpen }: { teaser: ShopGroupBuyTeaser; onOpen: () => void }) {
  if (teaser.state === "closed") return null;
  const cta = teaser.membership ? "See where you are →" : teaser.joinFeeCents > 0 ? `Join for ${teaser.amountLabel} →` : "Join →";
  return (
    <button type="button" className="bnnjoin-strip" onClick={onOpen}>
      <style>{paidAccessJoinCss}</style>
      <span className="bnnjoin-strip__dot" aria-hidden="true" />
      <span>
        {teaser.name} {teaser.state === "live" ? "is live" : "is coming"} · members only
      </span>
      <span className="bnnjoin-strip__cta">{cta}</span>
    </button>
  );
}
