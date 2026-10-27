"use client";

// One member of a round, in Admin → Group Buys → Members. Leads with the one
// move that is waiting on the store (member-view.ts primaryMove); the rest sit
// quieter, and anything that tells the member "no" asks for a reason first.
// Buttons only appear for moves the member's own flow allows; the server
// (actions.ts → server/admin.ts) refuses anything else regardless.

import { useState } from "react";

import { ProofLightbox } from "@/storefront/admin/gb-proof-lightbox";
import { useStore } from "@/storefront/store";
import type { HistoryEvent, QueueRow } from "../index";
import { decidePaidAccessAction, getPaidAccessHistoryAction, getPaidAccessProofUrlAction } from "../actions";
import { primaryMove, timeAgo, type MemberMove } from "./member-view";
import { cachedProofUrl } from "./proof-url-cache";

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
const STATUS_TONE: Record<string, string> = {
  payment_review: "attention",
  approval_pending: "attention",
  active: "good",
  rejected: "bad",
  waitlisted: "info",
};
const REFUND_LABEL: Record<string, string> = { pending: "Refund owed", processing: "Refund in progress", refunded: "Refunded", not_applicable: "No refund" };
const CAN_REJECT = new Set(["waitlisted", "form_pending", "payment_pending", "payment_review", "approval_pending"]);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

type Prompt = { action: "reject" | "reject_payment" | "revoke" | "refund"; label: string; placeholder: string; confirm: string; danger: boolean };

const PROMPTS = {
  reject: { action: "reject", label: "Why are you rejecting them? (they see this)", placeholder: "e.g. This group buy is for existing customers", confirm: "Reject", danger: true },
  reject_payment: { action: "reject_payment", label: "What's wrong with the proof? (they see this)", placeholder: "e.g. The amount on the receipt is short", confirm: "Send proof back", danger: true },
  revoke: { action: "revoke", label: "Why are you removing them? (they see this)", placeholder: "e.g. Shared the group-buy prices", confirm: "Remove access", danger: true },
  refund: { action: "refund", label: "Refund reference number", placeholder: "e.g. the GCash reference of your refund", confirm: "Mark refunded", danger: false },
} as const satisfies Record<string, Prompt>;

const PRIMARY_LABEL: Record<MemberMove, string> = {
  confirm_and_approve: "Confirm & let in",
  confirm_payment: "Confirm payment",
  approve: "Approve",
  refund: "Mark refunded",
};

const DONE: Record<string, string> = {
  approve: "Approved — they've been told.",
  confirm_payment: "Payment confirmed.",
  confirm_and_approve: "Payment confirmed — they're in.",
  reject: "Rejected — they've been told.",
  reject_payment: "Proof sent back — they can pay again.",
  revoke: "Access removed.",
  refund: "Marked refunded.",
};

type Props = { row: QueueRow; now: number; onChanged: () => void };

export function MemberCard({ row, now, onChanged }: Props) {
  const { toast } = useStore();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [text, setText] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [isOpeningProof, setIsOpeningProof] = useState(false);
  const p = row.payment;
  const lead = primaryMove(row);
  const reviewingProof = row.status === "payment_review" && p?.status === "submitted";

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

  const runLead = () => {
    if (!lead) return;
    if (lead === "refund") return setPrompt(PROMPTS.refund);
    void decide(lead);
  };

  // Shown in the page's lightbox, never a new ImageKit tab; the link is held
  // client-side so reopening it costs no second fetch (proof-url-cache.ts).
  const viewProof = async () => {
    if (!p) return;
    setIsOpeningProof(true);
    const res = await cachedProofUrl(`admin:${p.id}`, () => getPaidAccessProofUrlAction(p.id)).catch(() => null);
    setIsOpeningProof(false);
    if (!res || !res.ok) return toast(res?.message ?? "Couldn't open the proof.");
    setProofUrl(res.url);
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

  const statusLabel = STATUS_LABEL[row.status] ?? row.status;
  const initial = (row.customerName || row.customerEmail).trim().charAt(0).toUpperCase() || "?";
  const holdNote = row.holdExpiresAt && row.status === "payment_pending" ? `Slot held until ${when(row.holdExpiresAt)}` : "";
  const refundNote = row.status === "rejected" ? REFUND_LABEL[row.refundStatus] ?? "" : "";
  const hasNotes = !!(holdNote || row.reviewReason || refundNote || row.refundReference);

  return (
    <article className={`pam-card${lead ? " is-waiting" : ""}`} aria-label={`${row.customerName}, ${statusLabel}`}>
      <header className="pam-card__head">
        <span className="pam-avatar" aria-hidden="true">{initial}</span>
        <div className="pam-card__who">
          <div className="pam-card__name">{row.customerName}</div>
          <div className="pam-card__sub">
            {row.customerEmail} · joined {timeAgo(row.createdAt, now)}
          </div>
        </div>
        <span className="pam-status" data-tone={STATUS_TONE[row.status] ?? "muted"}>{statusLabel}</span>
      </header>

      {p && (
        <div className="pam-pay">
          <div className="pam-pay__amount">
            {p.amountLabel}
            <span className="pam-pay__kind">{p.kind === "deposit" ? "deposit" : "to join"}{p.provider !== "manual" ? " · online" : ""}</span>
          </div>
          <dl className="pam-pay__facts">
            {p.method && <div><dt>Paid with</dt><dd>{p.method}</dd></div>}
            {p.reference && (
              <div>
                <dt>Reference</dt>
                <dd>
                  <span className="pam-mono">{p.reference}</span>
                  {p.duplicateReference && <span className="pam-dupe" role="note">Used on another payment too — check it</span>}
                </dd>
              </div>
            )}
            {p.paidAt && <div><dt>Paid</dt><dd>{when(p.paidAt)}</dd></div>}
          </dl>
          {p.hasReceipt && (
            <button type="button" className="pam-link" disabled={isOpeningProof} onClick={() => void viewProof()}>
              {isOpeningProof ? "Opening…" : "View proof"}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </button>
          )}
          {proofUrl && <ProofLightbox url={proofUrl} label={row.customerName} onClose={() => setProofUrl(null)} />}
        </div>
      )}

      {hasNotes && (
        <ul className="pam-notes">
          {holdNote && <li>{holdNote}</li>}
          {row.reviewReason && <li>Reason: {row.reviewReason}</li>}
          {refundNote && <li>{refundNote}</li>}
          {row.refundReference && <li>Refund ref: <span className="pam-mono">{row.refundReference}</span></li>}
        </ul>
      )}

      {row.formAnswers.length > 0 && (
        <dl className="pam-answers">
          {row.formAnswers.map((a) => (
            <div key={a.question}>
              <dt>{a.question}</dt>
              <dd>{a.answer}</dd>
            </div>
          ))}
        </dl>
      )}

      {prompt ? (
        <div className="pam-prompt">
          <label className="admin-field__label" htmlFor={`pam-p-${row.id}`}>{prompt.label}</label>
          <textarea id={`pam-p-${row.id}`} className="admin-input" rows={2} value={text} placeholder={prompt.placeholder} onChange={(e) => setText(e.target.value)} autoFocus />
          <div className="pam-actions">
            <button type="button" className="admin-btn admin-btn--ghost" disabled={isBusy} onClick={() => setPrompt(null)}>Cancel</button>
            <button type="button" className={`admin-btn${prompt.danger ? " pam-danger" : ""}`} disabled={isBusy || !text.trim()} onClick={confirmPrompt}>
              {isBusy ? "Saving…" : prompt.confirm}
            </button>
          </div>
        </div>
      ) : (
        <div className="pam-actions">
          <div className="pam-actions__quiet">
            {reviewingProof && <button type="button" className="pam-text-btn" onClick={() => setPrompt(PROMPTS.reject_payment)}>Send proof back</button>}
            {CAN_REJECT.has(row.status) && <button type="button" className="pam-text-btn is-danger" onClick={() => setPrompt(PROMPTS.reject)}>Reject</button>}
            {row.status === "active" && <button type="button" className="pam-text-btn is-danger" onClick={() => setPrompt(PROMPTS.revoke)}>Remove access</button>}
          </div>
          {lead === "confirm_and_approve" && (
            <button type="button" className="admin-btn admin-btn--ghost" disabled={isBusy} onClick={() => void decide("confirm_payment")}>
              Confirm payment only
            </button>
          )}
          {lead && (
            <button type="button" className="admin-btn pam-primary" disabled={isBusy} onClick={runLead}>
              {isBusy ? "Saving…" : PRIMARY_LABEL[lead]}
            </button>
          )}
        </div>
      )}

      <details className="pam-history" onToggle={(e) => (e.currentTarget.open ? void loadHistory() : undefined)}>
        <summary>History</summary>
        {history === null ? (
          <p className="admin-field__hint">Loading…</p>
        ) : history.length === 0 ? (
          <p className="admin-field__hint">Nothing recorded yet.</p>
        ) : (
          <ol>
            {history.map((e, i) => (
              <li key={`${e.createdAt}-${i}`}>
                <strong>{e.toStatus ? STATUS_LABEL[e.toStatus] ?? REFUND_LABEL[e.toStatus] ?? e.toStatus : e.kind}</strong>
                <span> · {e.actorKind === "customer" ? "member" : e.actorKind}{e.actorId && e.actorKind !== "customer" ? ` (${e.actorId})` : ""} · {when(e.createdAt)}</span>
                {e.reason ? <span> — {e.reason}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </details>
    </article>
  );
}
