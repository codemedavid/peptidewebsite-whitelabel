"use client";

// Admin → Group Buys → Join flow → the review queue: proofs to check,
// approvals, refunds owed, the waitlist. Every rule is the server's
// (actions.ts → server/admin.ts): this panel collects a reason or reference
// and shows the result. Buttons only appear for moves the member's own flow
// allows; the server refuses anything else regardless.

import { useCallback, useEffect, useState } from "react";

import { useStore } from "@/storefront/store";
import type { HistoryEvent, QueueCounts, QueueRow, QueueTab } from "../index";
import { decidePaidAccessAction, expirePaidAccessHoldsAction, getPaidAccessHistoryAction, getPaidAccessProofUrlAction, listPaidAccessQueueAction } from "../actions";

const TABS: { key: QueueTab; label: string; empty: string }[] = [
  { key: "payments", label: "Payments to check", empty: "No payments waiting to be checked." },
  { key: "approvals", label: "Approvals", empty: "Nobody is waiting for approval." },
  { key: "refunds", label: "Refunds owed", empty: "No refunds owed." },
  { key: "waitlist", label: "Waitlist", empty: "Nobody is on the waitlist." },
  { key: "all", label: "Everyone", empty: "Nobody has joined yet." },
];

export const STATUS_LABEL: Record<string, string> = {
  waitlisted: "Waitlisted",
  form_pending: "Filling the form",
  payment_pending: "Not paid yet",
  payment_review: "Payment to check",
  approval_pending: "Waiting for approval",
  active: "In",
  rejected: "Rejected",
  expired: "Slot released",
  cancelled: "Left",
  revoked: "Removed",
};
// The admin's existing pill palette (storefront.css .admin-pill--*).
const STATUS_PILL: Record<string, string> = {
  payment_review: "admin-pill--new",
  approval_pending: "admin-pill--new",
  active: "admin-pill--available",
  rejected: "admin-pill--cancelled",
  revoked: "admin-pill--inactive",
  expired: "admin-pill--inactive",
  cancelled: "admin-pill--inactive",
};
const REFUND_LABEL: Record<string, string> = { pending: "Refund owed", processing: "Refund in progress", refunded: "Refunded", not_applicable: "No refund" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

type Props = { groupBuyId: string; onCounts?: (counts: QueueCounts) => void };

export function PaidAccessQueue({ groupBuyId, onCounts }: Props) {
  const { toast } = useStore();
  const [tab, setTab] = useState<QueueTab>("payments");
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const res = await listPaidAccessQueueAction({ groupBuyId, tab }).catch(() => null);
    if (!res || !res.ok) {
      setError(res?.message ?? "Couldn't load the queue.");
      setRows([]);
      return;
    }
    setRows(res.rows);
    setCounts(res.counts);
    onCounts?.(res.counts);
  }, [groupBuyId, tab, onCounts]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  const release = async () => {
    const res = await expirePaidAccessHoldsAction(groupBuyId).catch(() => null);
    if (!res || !res.ok) return toast(res?.message ?? "Couldn't release slots.");
    toast(res.expired ? `Released ${res.expired} unpaid slot${res.expired === 1 ? "" : "s"}${res.promoted ? `, moved ${res.promoted} in from the waitlist` : ""}.` : "No unpaid slots past their deadline.");
    void load();
  };

  const current = TABS.find((t) => t.key === tab)!;
  return (
    <section className="bnn-queue" aria-labelledby={`bnn-queue-${groupBuyId}`}>
      <div className="bnn-queue__head">
        <h3 className="admin-section__title" id={`bnn-queue-${groupBuyId}`}>
          Members
        </h3>
        <div className="bnn-row">
          <button type="button" className="admin-btn admin-btn--ghost" onClick={() => void release()}>
            Release unpaid slots
          </button>
          <button type="button" className="admin-btn admin-btn--ghost" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>
      <div className="bnn-tabs" role="tablist" aria-label="Member queue">
        {TABS.map((t) => {
          const n = counts ? (t.key === "all" ? counts.total : counts[t.key]) : null;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`bnn-chip${tab === t.key ? " is-active" : ""}`} onClick={() => setTab(t.key)}>
              {t.label}
              {n !== null && <span className="bnn-chip__n">{n}</span>}
            </button>
          );
        })}
      </div>
      {error && <div className="bnn-alert" role="alert">{error}</div>}
      {rows === null ? (
        <div className="bnn-skeleton" aria-busy="true" aria-label="Loading members" />
      ) : rows.length === 0 ? (
        <div className="admin-empty-set">{current.empty}</div>
      ) : (
        <div className="bnn-list">
          {rows.map((r) => (
            <MemberCard key={r.id} row={r} onChanged={() => void load()} />
          ))}
        </div>
      )}
    </section>
  );
}

type Prompt = null | { action: "reject" | "reject_payment" | "revoke" | "refund"; label: string; placeholder: string; confirm: string };

const PROMPTS = {
  reject: { action: "reject", label: "Reason (the member sees this)", placeholder: "e.g. This group buy is for existing customers", confirm: "Reject" },
  reject_payment: { action: "reject_payment", label: "What's wrong with the proof? (the member sees this)", placeholder: "e.g. The amount on the receipt is short", confirm: "Send back" },
  revoke: { action: "revoke", label: "Reason (the member sees this)", placeholder: "e.g. Shared the group-buy prices", confirm: "Remove access" },
  refund: { action: "refund", label: "Refund reference number", placeholder: "e.g. the GCash reference of your refund", confirm: "Mark refunded" },
} as const satisfies Record<string, NonNullable<Prompt>>;

const DONE: Record<string, string> = {
  approve: "Approved — they've been told.",
  confirm_payment: "Payment confirmed.",
  confirm_and_approve: "Payment confirmed and approved.",
  reject: "Rejected — they've been told.",
  reject_payment: "Proof sent back — they can pay again.",
  revoke: "Access removed.",
  refund: "Marked refunded.",
};

function MemberCard({ row, onChanged }: { row: QueueRow; onChanged: () => void }) {
  const { toast } = useStore();
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [text, setText] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  const p = row.payment;
  const approvalAfterPayment = row.steps.indexOf("approval") > row.steps.indexOf("payment") && row.steps.includes("payment");
  const canRejectMember = ["waitlisted", "form_pending", "payment_pending", "payment_review", "approval_pending"].includes(row.status);

  const decide = async (action: string, extra: Record<string, string> = {}) => {
    setIsBusy(true);
    try {
      const target = ["confirm_payment", "confirm_and_approve", "reject_payment"].includes(action) ? { paymentId: p?.id ?? "" } : { membershipId: row.id };
      const res = await decidePaidAccessAction({ action, ...target, ...extra });
      if (!res.ok) return toast(res.message);
      toast(DONE[action] ?? "Saved.");
      setPrompt(null);
      setText("");
      onChanged();
    } catch {
      toast("Something went wrong — please try again.");
    } finally {
      setIsBusy(false);
    }
  };

  const viewProof = async () => {
    if (!p) return;
    const res = await getPaidAccessProofUrlAction(p.id).catch(() => null);
    if (!res || !res.ok) return toast(res?.message ?? "Couldn't open the proof.");
    window.open(res.url, "_blank", "noopener,noreferrer");
  };

  const loadHistory = async () => {
    if (history) return;
    const res = await getPaidAccessHistoryAction({ membershipId: row.id }).catch(() => null);
    setHistory(res && res.ok ? res.events : []);
  };

  const confirmPrompt = () => {
    if (!prompt) return;
    void decide(prompt.action, prompt.action === "refund" ? { reference: text } : { reason: text });
  };

  return (
    <article className="bnn-card" aria-label={`${row.customerName}, ${STATUS_LABEL[row.status] ?? row.status}`}>
      <header className="bnn-card__head">
        <div>
          <div className="bnn-card__who">{row.customerName}</div>
          <div className="admin-field__hint">{row.customerEmail}</div>
        </div>
        <div className="bnn-row">
          <span className={`admin-pill ${STATUS_PILL[row.status] ?? ""}`}>{STATUS_LABEL[row.status] ?? row.status}</span>
          {REFUND_LABEL[row.refundStatus] && row.status === "rejected" && <span className="admin-pill">{REFUND_LABEL[row.refundStatus]}</span>}
        </div>
      </header>

      <dl className="bnn-facts">
        <div><dt>Joined</dt><dd>{when(row.createdAt)}</dd></div>
        {p && <div><dt>{p.kind === "deposit" ? "Deposit" : "Amount"}</dt><dd>{p.amountLabel}{p.provider !== "manual" ? " · online" : ""}</dd></div>}
        {p?.method && <div><dt>Paid with</dt><dd>{p.method}</dd></div>}
        {p?.reference && (
          <div>
            <dt>Reference</dt>
            <dd>
              {p.reference}
              {p.duplicateReference && <span className="bnn-dupe"> · used on another payment too</span>}
            </dd>
          </div>
        )}
        {p?.paidAt && <div><dt>Paid</dt><dd>{when(p.paidAt)}</dd></div>}
        {row.holdExpiresAt && row.status === "payment_pending" && <div><dt>Slot held until</dt><dd>{when(row.holdExpiresAt)}</dd></div>}
        {row.reviewReason && <div><dt>Reason</dt><dd>{row.reviewReason}</dd></div>}
        {row.refundReference && <div><dt>Refund ref</dt><dd>{row.refundReference}</dd></div>}
      </dl>

      {row.formAnswers.length > 0 && (
        <dl className="bnn-answers">
          {row.formAnswers.map((a) => (
            <div key={a.question}>
              <dt>{a.question}</dt>
              <dd>{a.answer}</dd>
            </div>
          ))}
        </dl>
      )}

      {prompt ? (
        <div className="bnn-prompt">
          <label className="admin-field__label" htmlFor={`bnn-p-${row.id}`}>{prompt.label}</label>
          <textarea id={`bnn-p-${row.id}`} className="admin-input" rows={2} value={text} placeholder={prompt.placeholder} onChange={(e) => setText(e.target.value)} autoFocus />
          <div className="bnn-actions">
            <button type="button" className="admin-btn admin-btn--ghost" disabled={isBusy} onClick={() => setPrompt(null)}>Cancel</button>
            <button type="button" className="admin-btn bnn-danger" disabled={isBusy || !text.trim()} onClick={confirmPrompt}>{isBusy ? "Saving…" : prompt.confirm}</button>
          </div>
        </div>
      ) : (
        <div className="bnn-actions">
          {p?.hasReceipt && <button type="button" className="admin-btn admin-btn--ghost" onClick={() => void viewProof()}>View proof</button>}
          {row.status === "payment_review" && p?.status === "submitted" && (
            <>
              <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setPrompt(PROMPTS.reject_payment)}>Send proof back</button>
              <button type="button" className="admin-btn" disabled={isBusy} onClick={() => void decide("confirm_payment")}>Confirm payment</button>
              {approvalAfterPayment && <button type="button" className="admin-btn" disabled={isBusy} onClick={() => void decide("confirm_and_approve")}>Confirm & approve</button>}
            </>
          )}
          {row.status === "approval_pending" && <button type="button" className="admin-btn" disabled={isBusy} onClick={() => void decide("approve")}>Approve</button>}
          {canRejectMember && <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setPrompt(PROMPTS.reject)}>Reject</button>}
          {row.status === "rejected" && row.refundStatus === "pending" && <button type="button" className="admin-btn" onClick={() => setPrompt(PROMPTS.refund)}>Mark refunded</button>}
          {row.status === "active" && <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setPrompt(PROMPTS.revoke)}>Remove access</button>}
        </div>
      )}

      <details className="bnn-history" onToggle={(e) => (e.currentTarget.open ? void loadHistory() : undefined)}>
        <summary>History</summary>
        {history === null ? (
          <p className="admin-field__hint">Loading…</p>
        ) : (
          <ol>
            {history.map((e, i) => (
              <li key={`${e.createdAt}-${i}`}>
                <strong>{e.toStatus ? STATUS_LABEL[e.toStatus] ?? REFUND_LABEL[e.toStatus] ?? e.toStatus : e.kind}</strong> · {e.actorKind}
                {e.actorId && e.actorKind !== "customer" ? ` (${e.actorId})` : ""} · {when(e.createdAt)}
                {e.reason ? ` — ${e.reason}` : ""}
              </li>
            ))}
          </ol>
        )}
      </details>
    </article>
  );
}
