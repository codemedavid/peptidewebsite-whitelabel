"use client";

// Group Buys → "Join requests" (paid group-buy access, groupbuy.paid_access).
// Top: each round's paid-join switch + fee. Below: the review queue — filter by
// status and round, open the receipt, approve, reject (reason required), mark
// refunded (refund reference required), revoke. Every rule is the server's
// (actions/gb-review.ts); this panel only collects input and shows results.

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Brand } from "../types";
import { useStore } from "../store";
import type { GroupBuy } from "@/lib/storefront/group-buy";
import type { JoinRequestCounts, JoinRequestRow } from "@/lib/storefront/gb-review.server";
import {
  getGroupBuyJoinReceiptAction,
  listGroupBuyJoinRequestsAction,
  reviewGroupBuyJoinRequestAction,
  saveGroupBuyPaidJoinAction,
} from "@/actions/gb-review";

type Filter = "paid_pending_approval" | "pending_payment" | "approved" | "rejected" | "refunded" | "revoked" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "paid_pending_approval", label: "Waiting for you" },
  { key: "pending_payment", label: "Not paid yet" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Refund owed" },
  { key: "refunded", label: "Refunded" },
  { key: "revoked", label: "Removed" },
  { key: "all", label: "All" },
];

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Not paid yet",
  paid_pending_approval: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected · refund owed",
  refunded: "Refunded",
  revoked: "Access removed",
};
// Mapped onto the admin's existing pill palette (storefront.css .admin-pill--*).
const STATUS_PILL: Record<string, string> = {
  pending_payment: "",
  paid_pending_approval: "admin-pill--new",
  approved: "admin-pill--available",
  rejected: "admin-pill--cancelled",
  refunded: "admin-pill--confirmed",
  revoked: "admin-pill--inactive",
};

const OPEN_ROUND = new Set(["draft", "scheduled", "active", "closed"]);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

export function AdminGroupBuyJoins({
  brand,
  groupBuys,
  onGroupBuysChange,
  onWaitingCount,
}: {
  brand: Brand;
  groupBuys: GroupBuy[];
  onGroupBuysChange: (next: GroupBuy[]) => void;
  /** Lets the tab show how many receipts are waiting. */
  onWaitingCount?: (n: number) => void;
}) {
  const currency = brand.currency || "₱";
  const fee = (cents: number) => `${currency}${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
  const rounds = groupBuys.filter((g) => OPEN_ROUND.has(g.status));
  return (
    <div className="gbjoins">
      <style>{css}</style>
      <PaidJoinSettings rounds={rounds} fee={fee} onSaved={(gb) => onGroupBuysChange(groupBuys.map((g) => (g.id === gb.id ? gb : g)))} />
      <JoinQueue rounds={groupBuys} fee={fee} onWaitingCount={onWaitingCount} />
    </div>
  );
}

function PaidJoinSettings({ rounds, fee, onSaved }: { rounds: GroupBuy[]; fee: (c: number) => string; onSaved: (gb: GroupBuy) => void }) {
  return (
    <section className="gbjoins__section" aria-labelledby="gbjoins-settings">
      <h2 className="admin-section__title" id="gbjoins-settings">
        Paid join, per round
      </h2>
      <p className="admin-field__hint">
        Turn it on and customers pay this fee (receipt + reference) and wait for your approval before they can see the round&apos;s products or
        order. Each round is separate — paying for one never opens another.
      </p>
      {rounds.length === 0 ? (
        <div className="admin-empty-set">No rounds yet. Create one on the Rounds tab.</div>
      ) : (
        <div className="admin-ship-list">
          {rounds.map((gb) => (
            <PaidJoinRow key={gb.id} gb={gb} fee={fee} onSaved={onSaved} />
          ))}
        </div>
      )}
    </section>
  );
}

function PaidJoinRow({ gb, fee, onSaved }: { gb: GroupBuy; fee: (c: number) => string; onSaved: (gb: GroupBuy) => void }) {
  const { toast } = useStore();
  const saved = gb.joinFeeCents ? String(gb.joinFeeCents / 100) : "";
  const [on, setOn] = useState(gb.paidJoin === true);
  const [amount, setAmount] = useState(saved);
  const [busy, setBusy] = useState(false);
  const dirty = on !== (gb.paidJoin === true) || (on && amount !== saved);
  const wholeCatalog = gb.productIds.length === 0;
  const statusLabel = gb.status === "active" ? "Live" : gb.status === "scheduled" ? "Scheduled" : gb.status === "closed" ? "Closed" : "Draft";

  const save = async () => {
    setBusy(true);
    try {
      const res = await saveGroupBuyPaidJoinAction({ id: gb.id, paidJoin: on, joinFee: amount });
      if ("error" in res) return toast(res.error);
      onSaved(res.groupBuy);
      toast(on ? `Paid join on — ${fee(res.groupBuy.joinFeeCents ?? 0)} to join.` : "Paid join off — the round is open to everyone.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-ship-row gbjoins__round">
      <div className="admin-ship-row__info">
        <div className="gbjoins__round-name">{gb.name}</div>
        <div className="admin-field__hint">
          {statusLabel}
          {gb.paidJoin && gb.joinFeeCents ? ` · paid join ${fee(gb.joinFeeCents)}` : " · open to everyone"}
        </div>
        {on && wholeCatalog && (
          <div className="gbjoins__warn" role="note">
            This round has no assigned products, so it covers your whole catalog: while it&apos;s live, customers who haven&apos;t been approved
            see an empty shop.
          </div>
        )}
      </div>
      <div className="gbjoins__controls">
        <label className="gbjoins__toggle">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          <span>Require paid join</span>
        </label>
        <label className="gbjoins__fee">
          <span className="admin-field__label">Fee</span>
          <input
            className="admin-input"
            inputMode="decimal"
            placeholder="500"
            value={amount}
            disabled={!on}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={`Join fee for ${gb.name}`}
          />
        </label>
        <button type="button" className="admin-btn" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function JoinQueue({ rounds, fee, onWaitingCount }: { rounds: GroupBuy[]; fee: (c: number) => string; onWaitingCount?: (n: number) => void }) {
  const [filter, setFilter] = useState<Filter>("paid_pending_approval");
  const [round, setRound] = useState("");
  const [rows, setRows] = useState<JoinRequestRow[] | null>(null);
  const [counts, setCounts] = useState<JoinRequestCounts | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const res = await listGroupBuyJoinRequestsAction({ status: filter === "all" ? undefined : filter, groupBuyId: round || undefined });
    if ("error" in res) {
      setError(res.error);
      setRows([]);
      return;
    }
    setRows(res.requests);
    setCounts(res.counts);
    onWaitingCount?.(res.counts.paid_pending_approval);
  }, [filter, round, onWaitingCount]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  const total = useMemo(() => (counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0), [counts]);

  return (
    <section className="gbjoins__section" aria-labelledby="gbjoins-queue">
      <div className="gbjoins__queue-head">
        <h2 className="admin-section__title" id="gbjoins-queue">
          Join requests
        </h2>
        <button type="button" className="admin-btn admin-btn--ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <div className="gbjoins__filters" role="tablist" aria-label="Filter join requests">
        {FILTERS.map((f) => {
          const n = f.key === "all" ? total : (counts?.[f.key] ?? 0);
          return (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              className={`gbjoins__chip${filter === f.key ? " is-active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {counts && <span className="gbjoins__chip-n">{n}</span>}
            </button>
          );
        })}
        {rounds.length > 1 && (
          <select className="admin-input gbjoins__round-select" value={round} onChange={(e) => setRound(e.target.value)} aria-label="Filter by round">
            <option value="">All rounds</option>
            {rounds.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="gbjoins__warn" role="alert">
          {error}
        </div>
      )}
      {rows === null ? (
        <div className="admin-field__hint" aria-busy="true">
          Loading requests…
        </div>
      ) : rows.length === 0 ? (
        <div className="admin-empty-set">{filter === "paid_pending_approval" ? "Nothing waiting — you're all caught up." : "No requests here."}</div>
      ) : (
        <div className="gbjoins__list">
          {rows.map((r) => (
            <RequestCard key={r.id} row={r} fee={fee} onChanged={() => void load()} />
          ))}
        </div>
      )}
    </section>
  );
}

type Pending = null | "reject" | "refund" | "revoke";

const PROMPTS: Record<Exclude<Pending, null>, { label: string; placeholder: string; confirm: string }> = {
  reject: { label: "Reason (the customer sees this)", placeholder: "e.g. The amount on the receipt is short", confirm: "Reject and owe a refund" },
  refund: { label: "Refund reference number", placeholder: "e.g. the GCash reference of your refund", confirm: "Mark refunded" },
  revoke: { label: "Reason (the customer sees this)", placeholder: "e.g. Shared the group-buy prices", confirm: "Remove access" },
};

const DONE: Record<"approve" | Exclude<Pending, null>, string> = {
  approve: "Approved — they've been told.",
  reject: "Rejected — the customer was told a refund is coming.",
  refund: "Marked refunded.",
  revoke: "Access removed.",
};

function RequestCard({ row, fee, onChanged }: { row: JoinRequestRow; fee: (c: number) => string; onChanged: () => void }) {
  const { toast } = useStore();
  const [pending, setPending] = useState<Pending>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const prompt = pending ? PROMPTS[pending] : null;

  const decide = async (action: "approve" | "reject" | "refund" | "revoke") => {
    setBusy(true);
    try {
      const res = await reviewGroupBuyJoinRequestAction({ id: row.id, action, ...(action === "refund" ? { refundReference: text } : { reason: text }) });
      if ("error" in res) return toast(res.error);
      toast(DONE[action]);
      setPending(null);
      setText("");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const viewReceipt = async () => {
    const res = await getGroupBuyJoinReceiptAction(row.id);
    if ("error" in res) return toast(res.error);
    window.open(res.url, "_blank", "noopener,noreferrer");
  };

  const cancel = () => {
    setPending(null);
    setText("");
  };

  return (
    <article className="gbjoins__card" aria-label={`${row.customerName}, ${STATUS_LABEL[row.status] ?? row.status}`}>
      <header className="gbjoins__card-head">
        <div>
          <div className="gbjoins__who">{row.customerName}</div>
          <div className="admin-field__hint">{row.customerEmail}</div>
        </div>
        <span className={`admin-pill ${STATUS_PILL[row.status] ?? ""}`}>{STATUS_LABEL[row.status] ?? row.status}</span>
      </header>
      <dl className="gbjoins__facts">
        <div>
          <dt>Round</dt>
          <dd>{row.roundName}</dd>
        </div>
        <div>
          <dt>Fee</dt>
          <dd>{fee(row.amountCents)}</dd>
        </div>
        {row.method && (
          <div>
            <dt>Paid with</dt>
            <dd>{row.method}</dd>
          </div>
        )}
        {row.reference && (
          <div>
            <dt>Reference</dt>
            <dd>
              {row.reference}
              {row.duplicateReference && <span className="gbjoins__dupe"> · used on another request too</span>}
            </dd>
          </div>
        )}
        {row.paidAt && (
          <div>
            <dt>Paid</dt>
            <dd>{when(row.paidAt)}</dd>
          </div>
        )}
        {row.submittedAt && (
          <div>
            <dt>Sent</dt>
            <dd>{when(row.submittedAt)}</dd>
          </div>
        )}
        {row.reviewReason && (
          <div>
            <dt>Reason</dt>
            <dd>{row.reviewReason}</dd>
          </div>
        )}
        {row.refundReference && (
          <div>
            <dt>Refund ref</dt>
            <dd>{row.refundReference}</dd>
          </div>
        )}
      </dl>

      {prompt ? (
        <div className="gbjoins__prompt">
          <label className="admin-field__label" htmlFor={`gbj-${row.id}`}>
            {prompt.label}
          </label>
          <textarea id={`gbj-${row.id}`} className="admin-input" rows={2} value={text} placeholder={prompt.placeholder} onChange={(e) => setText(e.target.value)} autoFocus />
          <div className="gbjoins__actions">
            <button type="button" className="admin-btn admin-btn--ghost" onClick={cancel} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="admin-btn gbjoins__danger" disabled={busy || !text.trim()} onClick={() => void decide(pending!)}>
              {busy ? "Saving…" : prompt.confirm}
            </button>
          </div>
        </div>
      ) : (
        <div className="gbjoins__actions">
          {row.hasReceipt && (
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => void viewReceipt()}>
              View receipt
            </button>
          )}
          {row.status === "paid_pending_approval" && (
            <>
              <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setPending("reject")}>
                Reject
              </button>
              <button type="button" className="admin-btn" disabled={busy} onClick={() => void decide("approve")}>
                {busy ? "Approving…" : "Approve"}
              </button>
            </>
          )}
          {row.status === "rejected" && (
            <button type="button" className="admin-btn" onClick={() => setPending("refund")}>
              Mark refunded
            </button>
          )}
          {row.status === "approved" && (
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setPending("revoke")}>
              Remove access
            </button>
          )}
        </div>
      )}

      {row.history.length > 0 && (
        <details className="gbjoins__history">
          <summary>History ({row.history.length})</summary>
          <ol>
            {row.history.map((e) => (
              <li key={`${e.toStatus}-${e.at}`}>
                <strong>{STATUS_LABEL[e.toStatus] ?? e.toStatus}</strong> · {e.actorKind} · {when(e.at)}
                {e.reason ? ` — ${e.reason}` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}

const css = `
.gbjoins { display: grid; gap: 22px; }
.gbjoins__section { display: grid; gap: 10px; }
.gbjoins__round { align-items: center; gap: 12px; flex-wrap: wrap; }
.gbjoins__round-name { font-weight: 600; }
.gbjoins__controls { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.gbjoins__toggle { display: inline-flex; align-items: center; gap: 8px; font-weight: 500; cursor: pointer; min-height: 40px; }
.gbjoins__toggle input { width: 18px; height: 18px; accent-color: var(--brand-main, #0a66a1); }
.gbjoins__fee { display: grid; gap: 4px; width: 110px; }
.gbjoins__warn { margin-top: 6px; padding: 8px 10px; border-radius: 8px; font-size: 13px; line-height: 1.45;
  background: color-mix(in oklab, #d97706 10%, transparent); border: 1px solid color-mix(in oklab, #d97706 35%, transparent); }
.gbjoins__queue-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.gbjoins__filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.gbjoins__chip { font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 99px; border: 1px solid var(--brand-border, rgba(0,0,0,.14)); background: transparent; color: inherit;
  transition: background .15s ease, border-color .15s ease; }
.gbjoins__chip:hover { border-color: var(--brand-main, #0a66a1); }
.gbjoins__chip:focus-visible { outline: 2px solid var(--brand-main, #0a66a1); outline-offset: 2px; }
.gbjoins__chip.is-active { background: var(--brand-main, #0a66a1); border-color: var(--brand-main, #0a66a1); color: var(--brand-button-text, #fff); }
.gbjoins__chip-n { font-size: 11px; padding: 1px 7px; border-radius: 99px; background: color-mix(in oklab, currentColor 14%, transparent); }
.sf-root .gbjoins .admin-input.gbjoins__round-select { width: auto; min-width: 180px; }
.gbjoins__list { display: grid; gap: 12px; }
.gbjoins__card { padding: 14px 16px; border-radius: 12px; border: 1px solid var(--brand-border, rgba(0,0,0,.12)); display: grid; gap: 10px; }
.gbjoins__card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.gbjoins__who { font-weight: 700; font-size: 15px; }
.gbjoins__facts { margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px 16px; }
.gbjoins__facts div { display: grid; gap: 2px; }
.gbjoins__facts dt { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; opacity: .65; }
.gbjoins__facts dd { margin: 0; font-size: 14px; word-break: break-word; }
.gbjoins__dupe { color: #b45309; font-weight: 600; }
.gbjoins__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.gbjoins__prompt { display: grid; gap: 6px; }
.sf-root .gbjoins .admin-btn.gbjoins__danger { background: #b42318; border-color: #b42318; color: #fff; }
.sf-root .gbjoins .admin-btn.gbjoins__danger:hover:not(:disabled) { background: #912018; border-color: #912018; }
.gbjoins__history summary { cursor: pointer; font-size: 13px; font-weight: 600; opacity: .8; }
.gbjoins__history ol { margin: 8px 0 0; padding-left: 18px; display: grid; gap: 4px; font-size: 13px; }
`;
