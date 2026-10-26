"use client";

// Paid group-buy JOIN page (#groupbuy for a viewer locked out of a paid round —
// brand.groupBuyTeaser). Join → pay the fee → send the receipt + reference →
// wait for the store's approval. Everything it shows comes from the server
// (actions/gb-join.ts); the fee is the server's, never computed or sent here.

import { useEffect, useRef, useState } from "react";

import type { Brand } from "../types";
import { BackLink } from "./BackLink";
import { gbCountdownLabel } from "@/lib/storefront/group-buy-page";
import { formatMoney } from "@/lib/storefront/currency";
import type { GroupBuyTeaser } from "@/lib/storefront/gb-access";
import type { GroupBuyJoinResult, GroupBuyJoinState, ShopPaymentMethod } from "@/lib/mobile/shop-contract";
import {
  getGroupBuyJoinAction,
  getGroupBuyReceiptUrlAction,
  startGroupBuyJoinAction,
  submitGroupBuyReceiptAction,
} from "@/actions/gb-join";

type Phase = { kind: "loading" } | { kind: "signed-out" } | { kind: "error"; message: string } | { kind: "ready"; state: GroupBuyJoinState };

const STEPS = ["Join", "Pay & send receipt", "Approval"] as const;
/** sessionStorage key: AccountPage sends a shopper who left to sign in back here. */
export const GB_JOIN_RETURN_KEY = "sf.gbJoinReturn";
const RECEIPT_ACCEPT = "image/*,.jpg,.jpeg,.png,.webp,.heic,.heif";

function stepFor(status: string | undefined): number {
  if (status === "pending_payment") return 1;
  if (status === "paid_pending_approval") return 2;
  if (status === "approved") return 3;
  return 0;
}

function roundTiming(teaser: GroupBuyTeaser): string {
  if (teaser.state === "live") return gbCountdownLabel(teaser.endsAt) || "Live now";
  if (teaser.state === "upcoming" && teaser.startsAt) {
    return `Opens ${new Date(teaser.startsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }
  return "Closed";
}

export function GroupBuyJoinPage({
  brand,
  teaser,
  onBack,
  onSignIn,
}: {
  brand: Brand;
  teaser: GroupBuyTeaser;
  onBack: () => void;
  /** Open the store's own sign-in (#account). */
  onSignIn: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const apply = (res: GroupBuyJoinResult) => {
    if (res.ok) {
      setError("");
      setPhase({ kind: "ready", state: res.state });
    } else if (res.code === "unauthenticated") setPhase({ kind: "signed-out" });
    else setError(res.message);
    return res.ok;
  };

  useEffect(() => {
    let cancelled = false;
    getGroupBuyJoinAction(teaser.id)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok && res.code !== "unauthenticated") setPhase({ kind: "error", message: res.message });
        else apply(res);
      })
      .catch(() => !cancelled && setPhase({ kind: "error", message: "We couldn't load this group buy. Please try again." }));
    return () => {
      cancelled = true;
    };
  }, [teaser.id]);

  const run = async (fn: () => Promise<GroupBuyJoinResult>) => {
    setBusy(true);
    try {
      apply(await fn());
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const fee = phase.kind === "ready" ? phase.state.joinFeeLabel : formatMoney(teaser.joinFeeCents / 100, brand.currency || "₱", { decimals: teaser.joinFeeCents % 100 !== 0 });
  const request = phase.kind === "ready" ? phase.state.request : null;
  const step = stepFor(request?.status);

  return (
    <section className="page gbpage gbjoin" id="groupbuy">
      <style>{gbJoinCss}</style>
      <div className="page__container gbpage__narrow">
        <BackLink onClick={onBack} label="Back to store" />

        <header className="gbjoin__hero">
          <div className="gbjoin__hero-top">
            <span className="gbpage__pill">● Members only</span>
            <span className="gbpage__countdown">{roundTiming(teaser)}</span>
          </div>
          <h1 className="gbjoin__title font-display">{teaser.name}</h1>
          <p className="gbjoin__lede">Pay the join fee, send your receipt, and the store will let you in to see the products and order.</p>
          <div className="gbjoin__fee">
            <span className="gbjoin__fee-amount font-display">{fee}</span>
            <span className="gbjoin__fee-label">one-time join fee for this group buy</span>
          </div>
        </header>

        <ol className="gbjoin__steps" aria-label="How joining works">
          {STEPS.map((label, i) => (
            <li key={label} className={`gbjoin__step${i < step ? " is-done" : ""}${i === step && step < 3 ? " is-current" : ""}`} aria-current={i === step ? "step" : undefined}>
              <span className="gbjoin__step-dot">{i < step ? "✓" : i + 1}</span>
              <span className="gbjoin__step-label">{label}</span>
            </li>
          ))}
        </ol>

        {phase.kind === "loading" && <div className="gbjoin__card gbjoin__skeleton" aria-busy="true" aria-label="Loading" />}

        {phase.kind === "error" && (
          <div className="gbjoin__card gbjoin__alert" role="alert">
            {phase.message}
          </div>
        )}

        {phase.kind === "signed-out" && (
          <div className="gbjoin__card">
            <h2 className="gbjoin__h2">Sign in to join</h2>
            {brand.customerAccountsEnabled ? (
              <>
                <p className="gbjoin__muted">Your join request and approval are tied to your account, so the store knows it’s you.</p>
                <button
                  type="button"
                  className="btn btn-primary gbjoin__cta"
                  onClick={() => {
                    try {
                      sessionStorage.setItem(GB_JOIN_RETURN_KEY, "1");
                    } catch {
                      /* storage blocked — they'll tap Group Buy again */
                    }
                    onSignIn();
                  }}
                >
                  Sign in or create an account
                </button>
              </>
            ) : (
              <p className="gbjoin__muted">Open the {brand.name} app and sign in there to join this group buy.</p>
            )}
          </div>
        )}

        {phase.kind === "ready" && (
          <ReadyView state={phase.state} busy={busy} error={error} onRun={run} roundId={teaser.id} />
        )}
      </div>
    </section>
  );
}

function ReadyView({
  state,
  busy,
  error,
  onRun,
  roundId,
}: {
  state: GroupBuyJoinState;
  busy: boolean;
  error: string;
  onRun: (fn: () => Promise<GroupBuyJoinResult>) => Promise<void>;
  roundId: string;
}) {
  const status = state.request?.status;
  return (
    <>
      {state.request && (
        <div className={`gbjoin__card gbjoin__status is-${state.status.tone}`} role="status" aria-live="polite">
          <div className="gbjoin__status-title">{state.status.title}</div>
          <p className="gbjoin__muted">{state.status.detail}</p>
        </div>
      )}

      {error && (
        <div className="gbjoin__card gbjoin__alert" role="alert">
          {error}
        </div>
      )}

      {state.canJoin && (
        <div className="gbjoin__card">
          <h2 className="gbjoin__h2">{status === "refunded" ? "Join again" : "Ready to join?"}</h2>
          <p className="gbjoin__muted">You’ll see where to send {state.joinFeeLabel} next. Nothing is charged here — you pay the store directly.</p>
          <button type="button" className="btn btn-primary gbjoin__cta" disabled={busy} onClick={() => onRun(() => startGroupBuyJoinAction(roundId))}>
            {busy ? "Starting…" : `Join for ${state.joinFeeLabel}`}
          </button>
        </div>
      )}

      {status === "pending_payment" && (
        <>
          <PaymentMethods methods={state.paymentMethods} amount={state.joinFeeLabel} />
          <ReceiptForm roundId={roundId} methods={state.paymentMethods} busy={busy} onRun={onRun} />
        </>
      )}

      {status === "paid_pending_approval" && state.request && <SentReceipt roundId={roundId} request={state.request} amount={state.joinFeeLabel} />}

      {status === "approved" && (
        <div className="gbjoin__card">
          <button type="button" className="btn btn-primary gbjoin__cta" onClick={() => window.location.reload()}>
            Open the group buy
          </button>
        </div>
      )}
    </>
  );
}

function PaymentMethods({ methods, amount }: { methods: ShopPaymentMethod[]; amount: string }) {
  const [copied, setCopied] = useState("");
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? "" : c)), 1600);
    } catch {
      /* clipboard blocked — the number is still on screen to type */
    }
  };
  return (
    <div className="gbjoin__card">
      <h2 className="gbjoin__h2">Send exactly {amount} to</h2>
      {methods.length === 0 ? (
        <p className="gbjoin__muted">The store hasn’t listed a payment account yet — message them for where to pay.</p>
      ) : (
        <ul className="gbjoin__methods">
          {methods.map((m) => (
            <li key={m.id} className="gbjoin__method">
              <div className="gbjoin__method-main">
                <div className="gbjoin__method-name">{m.name}</div>
                {m.account && <div className="gbjoin__muted">{m.account}</div>}
                {m.number && (
                  <div className="gbjoin__number">
                    <span>{m.number}</span>
                    <button type="button" className="gbjoin__copy" onClick={() => copy(m.id, m.number)} aria-label={`Copy ${m.name} number`}>
                      {copied === m.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
              {m.qrImage && <img className="gbjoin__qr" src={m.qrImage} alt={`${m.name} QR code`} width={96} height={96} loading="lazy" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReceiptForm({
  roundId,
  methods,
  busy,
  onRun,
}: {
  roundId: string;
  methods: ShopPaymentMethod[];
  busy: boolean;
  onRun: (fn: () => Promise<GroupBuyJoinResult>) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState(methods[0]?.name ?? "");
  const [paidAt, setPaidAt] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = (f: File | null) => {
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : "");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const form = new FormData();
    form.set("roundId", roundId);
    if (file) form.set("file", file);
    form.set("reference", reference);
    form.set("method", method);
    if (paidAt) form.set("paidAt", new Date(paidAt).toISOString());
    void onRun(() => submitGroupBuyReceiptAction(form));
  };

  return (
    <form className="gbjoin__card gbjoin__form" onSubmit={submit}>
      <h2 className="gbjoin__h2">Send your receipt</h2>
      <button type="button" className={`gbjoin__drop${preview ? " has-file" : ""}`} onClick={() => input.current?.click()}>
        {preview ? <img src={preview} alt="Your receipt" /> : <span>Tap to add a screenshot of your payment</span>}
      </button>
      <input ref={input} type="file" accept={RECEIPT_ACCEPT} hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />

      <label className="gbjoin__field">
        <span>Reference number</span>
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 1023 4567 8901" inputMode="text" autoComplete="off" maxLength={64} required />
      </label>
      {methods.length > 0 && (
        <label className="gbjoin__field">
          <span>Paid with</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="gbjoin__field">
        <span>When you paid <em>(optional)</em></span>
        <input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-primary gbjoin__cta" disabled={busy || !file || reference.trim().length < 4}>
        {busy ? "Sending…" : "Send receipt"}
      </button>
    </form>
  );
}

function SentReceipt({ roundId, request, amount }: { roundId: string; request: NonNullable<GroupBuyJoinState["request"]>; amount: string }) {
  const [msg, setMsg] = useState("");
  const view = async () => {
    setMsg("");
    const res = await getGroupBuyReceiptUrlAction(roundId).catch(() => null);
    if (res && res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
    else setMsg(res && !res.ok ? res.message : "Couldn't open your receipt.");
  };
  return (
    <div className="gbjoin__card">
      <dl className="gbjoin__facts">
        <div><dt>Amount</dt><dd>{amount}</dd></div>
        <div><dt>Reference</dt><dd>{request.reference}</dd></div>
        {request.method && <div><dt>Paid with</dt><dd>{request.method}</dd></div>}
        {request.submittedAt && <div><dt>Sent</dt><dd>{new Date(request.submittedAt).toLocaleString()}</dd></div>}
      </dl>
      {request.hasReceipt && (
        <button type="button" className="gbjoin__link" onClick={view}>
          View my receipt
        </button>
      )}
      {msg && <p className="gbjoin__muted" role="alert">{msg}</p>}
    </div>
  );
}

const gbJoinCss = `
.sf-root .gbjoin__hero {
  margin: 8px 0 18px; padding: 20px 18px 18px; border-radius: 22px;
  background: var(--brand-main); color: var(--brand-button-text);
  box-shadow: 0 10px 28px color-mix(in oklab, var(--brand-main) 30%, transparent);
}
.sf-root .gbjoin__hero-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sf-root .gbjoin__title { margin: 14px 0 6px; font-size: clamp(24px, 6.5vw, 32px); line-height: 1.1; }
.sf-root .gbjoin__lede { margin: 0; font-size: 14px; line-height: 1.5; opacity: .9; }
.sf-root .gbjoin__fee {
  margin-top: 16px; padding-top: 14px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  border-top: 1px solid color-mix(in oklab, var(--brand-button-text) 22%, transparent);
}
.sf-root .gbjoin__fee-amount { font-size: clamp(30px, 9vw, 40px); font-weight: 700; letter-spacing: -.01em; }
.sf-root .gbjoin__fee-label { font-size: 12px; font-weight: 600; opacity: .85; }
.sf-root .gbjoin__steps { list-style: none; margin: 0 0 16px; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.sf-root .gbjoin__step { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; color: var(--brand-text-muted); font-size: 12px; font-weight: 600; }
.sf-root .gbjoin__step-dot {
  width: 28px; height: 28px; border-radius: 99px; display: grid; place-items: center; font-size: 12px; font-weight: 700;
  border: 1.5px solid var(--brand-border); background: var(--brand-surface); transition: background .2s ease, color .2s ease, border-color .2s ease;
}
.sf-root .gbjoin__step.is-current { color: var(--brand-text); }
.sf-root .gbjoin__step.is-current .gbjoin__step-dot { border-color: var(--brand-main); color: var(--brand-main); box-shadow: 0 0 0 4px color-mix(in oklab, var(--brand-main) 14%, transparent); }
.sf-root .gbjoin__step.is-done .gbjoin__step-dot { background: var(--brand-main); border-color: var(--brand-main); color: var(--brand-button-text); }
.sf-root .gbjoin__card {
  margin-bottom: 12px; padding: 16px; border-radius: 18px;
  background: var(--brand-surface); border: 1px solid var(--brand-border);
  box-shadow: 0 2px 10px color-mix(in oklab, var(--brand-main) 6%, transparent);
}
.sf-root .gbjoin__skeleton { height: 120px; background: linear-gradient(90deg, var(--brand-surface) 0%, color-mix(in oklab, var(--brand-main) 7%, var(--brand-surface)) 50%, var(--brand-surface) 100%); background-size: 200% 100%; animation: gbjoin-shimmer 1.2s ease-in-out infinite; }
@keyframes gbjoin-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .sf-root .gbjoin__skeleton { animation: none; } }
.sf-root .gbjoin__h2 { margin: 0 0 6px; font-size: 17px; font-weight: 700; color: var(--brand-text); }
.sf-root .gbjoin__muted { margin: 0; font-size: 14px; line-height: 1.5; color: var(--brand-text-muted); }
.sf-root .gbjoin__cta { width: 100%; margin-top: 14px; min-height: 46px; }
.sf-root .gbjoin__alert { border-color: color-mix(in oklab, #c0392b 40%, transparent); background: color-mix(in oklab, #c0392b 7%, var(--brand-surface)); color: var(--brand-text); font-size: 14px; }
.sf-root .gbjoin__status { border-left: 4px solid var(--brand-main); }
.sf-root .gbjoin__status.is-success { border-left-color: #1f8a4c; }
.sf-root .gbjoin__status.is-danger { border-left-color: #c0392b; }
.sf-root .gbjoin__status-title { font-size: 16px; font-weight: 700; color: var(--brand-text); margin-bottom: 4px; }
.sf-root .gbjoin__methods { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 10px; }
.sf-root .gbjoin__method { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 12px; border-radius: 14px; background: color-mix(in oklab, var(--brand-main) 5%, var(--brand-surface)); }
.sf-root .gbjoin__method-name { font-weight: 700; color: var(--brand-text); }
.sf-root .gbjoin__number { margin-top: 6px; display: flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--brand-text); }
.sf-root .gbjoin__copy { font: inherit; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 99px; border: 1px solid var(--brand-main); color: var(--brand-main); background: transparent; cursor: pointer; }
.sf-root .gbjoin__copy:hover { background: color-mix(in oklab, var(--brand-main) 10%, transparent); }
.sf-root .gbjoin__copy:focus-visible, .sf-root .gbjoin__drop:focus-visible, .sf-root .gbjoin__link:focus-visible { outline: 2px solid var(--brand-main); outline-offset: 2px; }
.sf-root .gbjoin__qr { width: 96px; height: 96px; border-radius: 10px; object-fit: cover; background: #fff; flex: none; }
.sf-root .gbjoin__form { display: grid; gap: 12px; }
.sf-root .gbjoin__drop {
  font: inherit; cursor: pointer; min-height: 132px; border-radius: 14px; padding: 12px;
  border: 1.5px dashed color-mix(in oklab, var(--brand-main) 45%, var(--brand-border)); background: color-mix(in oklab, var(--brand-main) 4%, var(--brand-surface));
  color: var(--brand-text-muted); font-size: 14px; display: grid; place-items: center; transition: border-color .2s ease, background .2s ease;
}
.sf-root .gbjoin__drop:hover { border-color: var(--brand-main); }
.sf-root .gbjoin__drop.has-file { border-style: solid; padding: 6px; }
.sf-root .gbjoin__drop img { max-height: 220px; max-width: 100%; border-radius: 10px; object-fit: contain; }
.sf-root .gbjoin__field { display: grid; gap: 6px; font-size: 13px; font-weight: 600; color: var(--brand-text); }
.sf-root .gbjoin__field em { font-style: normal; font-weight: 500; color: var(--brand-text-muted); }
.sf-root .gbjoin__field input, .sf-root .gbjoin__field select {
  font: inherit; font-size: 16px; padding: 11px 12px; border-radius: 12px; border: 1px solid var(--brand-border); background: var(--brand-surface); color: var(--brand-text);
}
.sf-root .gbjoin__field input:focus, .sf-root .gbjoin__field select:focus { outline: none; border-color: var(--brand-main); box-shadow: 0 0 0 3px color-mix(in oklab, var(--brand-main) 18%, transparent); }
.sf-root .gbjoin__facts { margin: 0; display: grid; gap: 10px; }
.sf-root .gbjoin__facts div { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
.sf-root .gbjoin__facts dt { color: var(--brand-text-muted); }
.sf-root .gbjoin__facts dd { margin: 0; font-weight: 600; color: var(--brand-text); text-align: right; word-break: break-word; }
.sf-root .gbjoin__link { margin-top: 12px; font: inherit; font-weight: 700; font-size: 14px; color: var(--brand-main); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.sf-root .gbjoin-strip {
  display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; width: 100%;
  padding: 10px 16px; font: inherit; font-size: 13px; font-weight: 600; border: 0; cursor: pointer;
  background: var(--brand-main); color: var(--brand-button-text);
}
.sf-root .gbjoin-strip:hover .gbjoin-strip__cta { text-decoration: underline; }
.sf-root .gbjoin-strip:focus-visible { outline: 2px solid var(--brand-text); outline-offset: -4px; }
.sf-root .gbjoin-strip__dot { width: 8px; height: 8px; border-radius: 99px; background: currentColor; opacity: .85; }
.sf-root .gbjoin-strip__cta { font-weight: 800; }
`;

/** The home's slim "members only" strip → #groupbuy. Live/upcoming only. */
export function GroupBuyJoinStrip({ brand, teaser, onOpen }: { brand: Brand; teaser: GroupBuyTeaser; onOpen: () => void }) {
  if (teaser.state === "closed") return null;
  const fee = formatMoney(teaser.joinFeeCents / 100, brand.currency || "₱", { decimals: teaser.joinFeeCents % 100 !== 0 });
  const joined = teaser.membership && teaser.membership.status !== "refunded";
  return (
    <button type="button" className="gbjoin-strip" onClick={onOpen}>
      <style>{gbJoinCss}</style>
      <span className="gbjoin-strip__dot" aria-hidden="true" />
      <span>
        {teaser.name} {teaser.state === "live" ? "is live" : "is coming"} · members only
      </span>
      <span className="gbjoin-strip__cta">{joined ? "Check your request →" : `Join for ${fee} →`}</span>
    </button>
  );
}
