"use client";

// #my-groupbuy — "My Group Buy Order". A buyer types the email AND phone they
// used at checkout and sees, per group-buy round, every checkout they placed,
// one merged item list, and what is paid and still owed. No account needed:
// group-buy-only stores (mnm-pepsabuy) run without customer accounts or a Track
// page. Routed only while the operator has granted the feature (visibility.ts
// PAGE_TOGGLE["my-groupbuy"]); lookupMyGroupBuyOrderAction re-checks it.

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { BackLink } from "../components/BackLink";
import { STATUS_LABELS, STATUS_DOT, formatDate } from "../components/TrackedOrderDetail";
import { lookupMyGroupBuyOrderAction } from "@/actions/my-groupbuy-order";
import { LOOKUP_NO_MATCH, type MyGbRound } from "@/lib/storefront/my-groupbuy-order";
import { formatMoney } from "@/lib/storefront/currency";

type Lookup =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "found"; rounds: MyGbRound[] };

interface MyGroupBuyOrderPageProps {
  brand: Brand;
  onBack: () => void;
}

export function MyGroupBuyOrderPage({ brand, onBack }: MyGroupBuyOrderPageProps) {
  const { myOrders } = useStore();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ kind: "idle" });
  const money = (n: number) => formatMoney(n, brand.currency);

  // Prefill from the newest group-buy order THIS browser placed (its own local
  // copy — nothing is fetched), so a buyer arriving from the confirmation page
  // only has to press the button. Once only, and never over what they typed.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current) return;
    const recent = myOrders.find((o) => o.groupBuyId);
    if (!recent) return;
    prefilled.current = true;
    setEmail((v) => v || recent.customer?.email || "");
    setPhone((v) => v || recent.customer?.phone || "");
  }, [myOrders]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (lookup.kind === "loading") return;
    setLookup({ kind: "loading" });
    try {
      const res = await lookupMyGroupBuyOrderAction({ email, phone });
      if ("error" in res) setLookup({ kind: "error", message: res.error });
      else setLookup({ kind: "found", rounds: res.rounds });
    } catch {
      setLookup({ kind: "error", message: "Couldn't look up your order. Please try again." });
    }
  };

  const busy = lookup.kind === "loading";

  return (
    <section className="page mygb" id="my-groupbuy" aria-labelledby="mygb-title">
      <div className="page__container">
        <BackLink onClick={onBack} label="Back to Shop" />

        <div className="mygb__intro">
          <p className="acct__eyebrow">{brand.name}</p>
          <h1 id="mygb-title" className="page__title">My Group Buy Order</h1>
          <p className="page__sub">
            Enter the email and phone number you used at checkout to see everything you&rsquo;ve
            ordered in our group buys, what you&rsquo;ve paid, and what&rsquo;s left.
          </p>
        </div>

        <form className="acct-card acct-card--compact mygb-form" onSubmit={submit} noValidate>
          <div className="mygb-form__fields">
            <label className="acct-field">
              <span>Email</span>
              <input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label className="acct-field">
              <span>Phone number</span>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                placeholder="09XX XXX XXXX"
                required
              />
            </label>
          </div>
          <button type="submit" className="btn btn-primary mygb-form__submit" disabled={busy}>
            {busy ? "Looking up…" : "View my order"}
          </button>
          <p className="mygb-form__note">Both must match what you typed at checkout.</p>
        </form>

        <div className="mygb__results" aria-live="polite" aria-busy={busy}>
          {busy && <p className="acct__loading">Looking up your orders…</p>}
          {lookup.kind === "error" && (
            <p className="acct-error mygb__error" role="alert">
              {lookup.message}
            </p>
          )}
          {lookup.kind === "found" && lookup.rounds.length === 0 && (
            <div className="acct-empty mygb__empty">
              <p className="acct-empty__title">Nothing found</p>
              <p>{LOOKUP_NO_MATCH}</p>
              <p>Check for typos, or use the exact email and number from your order.</p>
            </div>
          )}
          {lookup.kind === "found" &&
            lookup.rounds.map((round) => <RoundCard key={round.id} round={round} money={money} />)}
        </div>
      </div>
    </section>
  );
}

// ── One round ─────────────────────────────────────────────────────────────────

interface RoundCardProps {
  round: MyGbRound;
  money: (n: number) => string;
}

function RoundCard({ round, money }: RoundCardProps) {
  const headingId = `mygb-round-${round.id}`;
  const units = round.items.reduce((n, l) => n + l.qty, 0);
  const t = round.totals;
  return (
    <article className={`mygb-round is-${round.state}`} aria-labelledby={headingId}>
      <header className="mygb-round__head">
        <div className="mygb-round__titles">
          <span className={`mygb-round__state is-${round.state}`}>
            <span className="mygb-round__state-dot" aria-hidden />
            {round.stateLabel}
          </span>
          <h2 id={headingId} className="mygb-round__name">
            {round.name}
            {round.batch && <span className="mygb-round__batch">{round.batch}</span>}
          </h2>
        </div>
        {(round.deliveryEta || round.paymentDueAt) && (
          <dl className="mygb-round__meta">
            {round.deliveryEta && (
              <div>
                <dt>Delivery</dt>
                <dd>{round.deliveryEta}</dd>
              </div>
            )}
            {round.paymentDueAt && (
              <div className="is-due">
                <dt>Payment due</dt>
                <dd>{formatDate(round.paymentDueAt)}</dd>
              </div>
            )}
          </dl>
        )}
      </header>

      <div className="mygb-round__body">
        <section className="mygb-block" aria-label={`Items in ${round.name}`}>
          <h3 className="mygb-block__title">
            Your items <span className="acct-section__count">{units}</span>
          </h3>
          {round.items.length === 0 ? (
            <p className="mygb-block__empty">No active items in this round.</p>
          ) : (
            <ul className="mygb-lines">
              {round.items.map((line) => (
                <li key={line.key} className="mygb-line">
                  <span className="mygb-line__name">
                    {line.name}
                    {line.variation && <span className="mygb-line__var">{line.variation}</span>}
                  </span>
                  <span className="mygb-line__qty">× {line.qty}</span>
                  <span className="mygb-line__amt">{money(line.amount)}</span>
                </li>
              ))}
            </ul>
          )}

          <dl className="mygb-totals">
            <Row label="Items subtotal" value={money(t.subtotal)} />
            {t.discount > 0 && <Row label="Discount" value={`−${money(t.discount)}`} />}
            {t.shipping > 0 && <Row label="Shipping" value={money(t.shipping)} />}
            {t.adminFee > 0 && <Row label="Admin fee" value={money(t.adminFee)} />}
            {t.paymentFee > 0 && <Row label="Processing fee" value={money(t.paymentFee)} />}
            <Row label="Total" value={money(t.total)} tone="total" />
            <Row label="Paid" value={money(t.paid)} tone="paid" />
            <Row label={t.balance > 0 ? "Balance to pay" : "Balance"} value={money(t.balance)} tone={t.balance > 0 ? "owed" : "settled"} />
          </dl>
        </section>

        <section className="mygb-block" aria-label={`Checkouts in ${round.name}`}>
          <h3 className="mygb-block__title">
            Your checkouts <span className="acct-section__count">{round.checkouts.length}</span>
          </h3>
          <ul className="mygb-checkouts">
            {round.checkouts.map((c) => (
              <li key={c.orderNumber} className={`mygb-checkout ${c.status === "cancelled" ? "is-cancelled" : ""}`}>
                <span className="mygb-checkout__num">{c.orderNumber}</span>
                <span className="mygb-checkout__date">{formatDate(c.date)}</span>
                <span className="mygb-checkout__status">
                  <span className="acct-order__dot" style={{ background: STATUS_DOT[c.status] }} aria-hidden />
                  {STATUS_LABELS[c.status]}
                </span>
                <span className={`mygb-checkout__pay is-${c.paymentStatus}`}>
                  {c.paymentStatus === "paid" ? "Paid" : "Not yet paid"}
                </span>
                <span className="mygb-checkout__total">{c.status === "cancelled" ? "—" : money(c.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </article>
  );
}

interface RowProps {
  label: string;
  value: string;
  tone?: "total" | "paid" | "owed" | "settled";
}

function Row({ label, value, tone }: RowProps) {
  return (
    <div className={`mygb-totals__row${tone ? ` is-${tone}` : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
