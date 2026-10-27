"use client";

// Admin → Group Buys → "Members": the people in one round — the live one by
// default. A header that says what the round is and how full it is, then the
// members sorted into buckets with "Needs you" first, so the store's next move
// is always at the top. How people get in is the "Join flow" tab; this tab
// only manages who is in. Talks to Paid Access only through ../actions.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Brand } from "@/storefront/types";
import type { GroupBuy } from "@/lib/storefront/group-buy";
import { useStore } from "@/storefront/store";
import type { QueueRow } from "../index";
import { expirePaidAccessHoldsAction, getPaidAccessSettingsAction, listPaidAccessQueueAction } from "../actions";
import { MemberCard } from "./MemberCard";
import { paidAccessMembersCss } from "./members-styles";
import {
  BUCKETS,
  bucketCounts,
  expiredHolds,
  flowSummary,
  formatAmount,
  inBucket,
  matchesSearch,
  slotMeter,
  sortForReview,
  timeAgo,
  type MemberBucket,
} from "./member-view";

const LISTED = new Set(["draft", "scheduled", "active", "closed"]);
const ROUND_STATUS: Record<string, string> = { active: "Live", scheduled: "Scheduled", closed: "Closed", draft: "Draft" };
/** Re-check while the tab is open, so a new proof shows without a click. */
const POLL_MS = 30_000;

type SettingsResult = Awaited<ReturnType<typeof getPaidAccessSettingsAction>>;
type FlowView = Extract<SettingsResult, { ok: true }>;

type Props = {
  brand: Brand;
  groupBuys: GroupBuy[];
  /** Jump to the Join flow tab (set up, or change, how people get in). */
  onOpenJoinFlow: () => void;
  /** A member moved — lets the parent refresh its "waiting" badge. */
  onChanged?: () => void;
};

export function PaidAccessMembers({ brand, groupBuys, onOpenJoinFlow, onChanged }: Props) {
  const rounds = groupBuys.filter((g) => LISTED.has(g.status));
  const preferred = rounds.find((g) => g.status === "active") ?? rounds.find((g) => g.status === "scheduled") ?? rounds[0];
  const [selectedId, setSelectedId] = useState(preferred?.id ?? "");
  const round = rounds.find((g) => g.id === selectedId) ?? preferred;

  if (!round) {
    return (
      <div className="pam">
        <style>{paidAccessMembersCss}</style>
        <div className="pam-empty">
          <p className="pam-empty__title">No rounds yet</p>
          <p className="admin-field__hint">Create a round on the Rounds tab. Its members will show up here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pam">
      <style>{paidAccessMembersCss}</style>
      {rounds.length > 1 && (
        <div className="pam-rounds" role="radiogroup" aria-label="Round">
          {rounds.map((g) => (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={g.id === round.id}
              className={`pam-round${g.id === round.id ? " is-active" : ""}`}
              onClick={() => setSelectedId(g.id)}
            >
              <span className="pam-round__dot" data-status={g.status} aria-hidden="true" />
              {g.name}
              <span className="pam-round__status">{ROUND_STATUS[g.status] ?? g.status}</span>
            </button>
          ))}
        </div>
      )}
      <RoundMembers key={round.id} round={round} currency={brand.currency || "₱"} onOpenJoinFlow={onOpenJoinFlow} onChanged={onChanged} />
    </div>
  );
}

type RoundProps = { round: GroupBuy; currency: string; onOpenJoinFlow: () => void; onChanged?: () => void };

function RoundMembers({ round, currency, onOpenJoinFlow, onChanged }: RoundProps) {
  const { toast } = useStore();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [flow, setFlow] = useState<FlowView | null>(null);
  const [error, setError] = useState("");
  const [bucket, setBucket] = useState<MemberBucket | null>(null);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [isReleasing, setIsReleasing] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [queue, settings] = await Promise.all([
        listPaidAccessQueueAction({ groupBuyId: round.id, tab: "all" }).catch(() => null),
        getPaidAccessSettingsAction(round.id).catch(() => null),
      ]);
      if (!queue || !queue.ok) {
        setError(queue?.message ?? "Couldn't load members. Check your connection and try again.");
        setRows((prev) => prev ?? []);
        return;
      }
      setError("");
      setRows(queue.rows);
      setTotal(queue.counts.total);
      setFlow(settings && settings.ok ? settings : null);
      setLoadedAt(Date.now());
      setNow(Date.now());
    } finally {
      inFlight.current = false;
    }
  }, [round.id]);

  useEffect(() => {
    void load();
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  const counts = useMemo(() => bucketCounts(rows ?? []), [rows]);
  // Land on "Needs you" when something waits, else on everyone.
  const active: MemberBucket = bucket ?? (counts.needs > 0 ? "needs" : "all");
  const visible = useMemo(
    () => sortForReview((rows ?? []).filter((r) => inBucket(r, active) && matchesSearch(r, query))),
    [rows, active, query],
  );
  const expired = expiredHolds(rows ?? [], now);

  const refresh = () => {
    void load();
    onChanged?.();
  };

  const release = async () => {
    setIsReleasing(true);
    try {
      const res = await expirePaidAccessHoldsAction(round.id).catch(() => null);
      if (!res || !res.ok) return toast(res?.message ?? "Couldn't release slots.");
      toast(
        res.expired
          ? `Released ${res.expired} unpaid slot${res.expired === 1 ? "" : "s"}${res.promoted ? `, moved ${res.promoted} in from the waitlist` : ""}.`
          : "No unpaid slots past their deadline.",
      );
      refresh();
    } finally {
      setIsReleasing(false);
    }
  };

  const current = BUCKETS.find((b) => b.key === active)!;
  const settings = flow?.exists ? flow.settings : null;
  const meter = settings ? slotMeter(flow?.slotsTaken ?? 0, settings.capacity.maxSlots) : null;
  const closesAt = settings?.schedule.closesAt ?? round.endsAt;
  const summary = settings ? flowSummary(settings.steps, formatAmount(currency, settings.payment.amountCents)) : "";

  return (
    <section className="pam-round-panel" aria-labelledby={`pam-title-${round.id}`}>
      <header className="pam-hero">
        <div className="pam-hero__main">
          <div className="pam-hero__eyebrow">
            <span className="pam-round__dot" data-status={round.status} aria-hidden="true" />
            {ROUND_STATUS[round.status] ?? round.status}
            {closesAt && <span> · joining closes {new Date(closesAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
          </div>
          <h3 className="pam-hero__title" id={`pam-title-${round.id}`}>{round.name}</h3>
          {summary && (
            <p className="pam-hero__flow">
              {summary}
              <button type="button" className="pam-link" onClick={onOpenJoinFlow}>Change</button>
            </p>
          )}
        </div>
        {meter && (
          <div className="pam-meter" aria-label={`Slots: ${meter.label}`}>
            <div className="pam-meter__label">
              <span>Slots</span>
              <strong>{meter.label}</strong>
            </div>
            {meter.fill !== null && (
              <div className="pam-meter__track" aria-hidden="true">
                <div className="pam-meter__fill" style={{ transform: `scaleX(${meter.fill})` }} data-full={meter.fill >= 1 || undefined} />
              </div>
            )}
          </div>
        )}
      </header>

      {flow && !flow.exists && (
        <div className="pam-setup" role="status">
          <div>
            <strong>Nobody can join this round yet.</strong>
            <p className="admin-field__hint">Choose how people get in first — open, pay to join, or approve each one.</p>
          </div>
          <button type="button" className="admin-btn pam-primary" onClick={onOpenJoinFlow}>Set up join flow</button>
        </div>
      )}

      {expired > 0 && (
        <div className="pam-banner" role="status">
          <span>
            <strong>{expired} unpaid slot{expired === 1 ? "" : "s"}</strong> passed the payment deadline.
          </span>
          <button type="button" className="admin-btn admin-btn--ghost" disabled={isReleasing} onClick={() => void release()}>
            {isReleasing ? "Releasing…" : "Release to the waitlist"}
          </button>
        </div>
      )}

      <div className="pam-toolbar">
        <div className="pam-buckets" role="tablist" aria-label="Members">
          {BUCKETS.map((b) => {
            const n = counts[b.key];
            const isUrgent = b.key === "needs" && n > 0;
            return (
              <button
                key={b.key}
                type="button"
                role="tab"
                id={`pam-tab-${round.id}-${b.key}`}
                aria-selected={active === b.key}
                aria-controls={`pam-list-${round.id}`}
                className={`pam-bucket${active === b.key ? " is-active" : ""}${isUrgent ? " is-urgent" : ""}`}
                onClick={() => setBucket(b.key)}
              >
                {b.label}
                <span className="pam-bucket__n">{rows === null ? "·" : n}</span>
              </button>
            );
          })}
        </div>
        <div className="pam-toolbar__side">
          <label className="pam-search">
            <span className="pam-sr">Search members</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input type="search" value={query} placeholder="Name or email" onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button type="button" className="pam-refresh" onClick={refresh} title="Refresh">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" />
            </svg>
            <span>{loadedAt ? `Updated ${timeAgo(new Date(loadedAt).toISOString(), now)}` : "Refresh"}</span>
          </button>
        </div>
      </div>

      {error && <div className="pam-alert" role="alert">{error}</div>}

      <div id={`pam-list-${round.id}`} role="tabpanel" aria-labelledby={`pam-tab-${round.id}-${active}`} className="pam-list">
        {rows === null ? (
          <>
            <div className="pam-skeleton" aria-busy="true" aria-label="Loading members" />
            <div className="pam-skeleton" aria-hidden="true" />
          </>
        ) : visible.length === 0 ? (
          <div className={`pam-empty${active === "needs" && !query ? " is-done" : ""}`}>
            <p className="pam-empty__title">{query ? `No one matches “${query.trim()}”` : current.empty}</p>
            {active === "needs" && !query && counts.all > 0 && (
              <button type="button" className="pam-link" onClick={() => setBucket("all")}>See everyone ({counts.all})</button>
            )}
          </div>
        ) : (
          visible.map((r) => <MemberCard key={r.id} row={r} now={now} onChanged={refresh} />)
        )}
        {rows !== null && total > rows.length && (
          <p className="admin-field__hint">Showing the latest {rows.length} of {total} members.</p>
        )}
      </div>
    </section>
  );
}

/** Proofs to check + approvals across every round — the Members tab badge.
 *  A failed count shows nothing rather than a wrong number. */
export function usePaidAccessWaitingCount(isEnabled: boolean): { waiting: number | null; refresh: () => void } {
  const [waiting, setWaiting] = useState<number | null>(null);
  const refresh = useCallback(() => {
    if (!isEnabled) return;
    void listPaidAccessQueueAction({ tab: "approvals" })
      .then((res) => setWaiting(res.ok ? res.counts.payments + res.counts.approvals : null))
      .catch(() => setWaiting(null));
  }, [isEnabled]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { waiting, refresh };
}
