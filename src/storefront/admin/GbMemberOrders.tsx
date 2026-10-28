"use client";

// "Orders per customer" on one group buy's dashboard (AdminGroupBuyDetail).
// Every checkout a customer made in the round, merged into one row: what they
// bought in total, what it's worth, what they've paid and what they still owe
// (lib/storefront/gb-member-orders.ts). Each checkout stays its own order with
// its own payment proof — this is the consolidated READ of them.

import { useMemo, useState } from "react";

import { memberOrderTotals, type MemberOrder } from "@/lib/storefront/gb-member-orders";

type Props = {
  members: MemberOrder[];
  money: (n: number) => string;
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function matches(m: MemberOrder, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [m.name, m.email, m.contact, ...m.checkouts.map((c) => c.orderNumber)].some((v) =>
    v.toLowerCase().includes(q),
  );
}

export function GbMemberOrders({ members, money }: Props) {
  const [query, setQuery] = useState("");
  const totals = useMemo(() => memberOrderTotals(members), [members]);
  const shown = useMemo(() => members.filter((m) => matches(m, query)), [members, query]);
  const owing = members.filter((m) => m.balance > 0).length;

  return (
    <section className="gbm" aria-labelledby="gbm-title">
      <div className="gbm__head">
        <div>
          <h2 id="gbm-title" className="admin-section__title" style={{ margin: 0 }}>
            Orders per customer ({members.length})
          </h2>
          <p className="admin-field__hint" style={{ margin: "4px 0 0" }}>
            Every checkout a customer made in this group buy, combined. Matched by email or phone number.
          </p>
        </div>
        <dl className="gbm__totals">
          <div>
            <dt>Total value</dt>
            <dd>{money(totals.total)}</dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd className="gbm__ok">{money(totals.paid)}</dd>
          </div>
          <div>
            <dt>Balance</dt>
            <dd className={totals.balance > 0 ? "gbm__due" : "gbm__ok"}>{money(totals.balance)}</dd>
          </div>
        </dl>
      </div>

      {members.length === 0 ? (
        <div className="admin-empty-set">No customers have ordered in this group buy yet.</div>
      ) : (
        <>
          <div className="gbm__toolbar">
            <input
              className="admin-input"
              type="search"
              placeholder="Search name, phone, email or order #…"
              aria-label="Search customers"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="gbm__count">
              {owing === 0 ? "Everyone is fully paid" : `${owing} with a balance`}
            </span>
          </div>

          {shown.length === 0 ? (
            <div className="admin-empty-set">No customer matches “{query}”.</div>
          ) : (
            <ul className="gbm__list">
              {shown.map((m) => (
                <li key={m.id}>
                  <MemberRow member={m} money={money} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <style>{css}</style>
    </section>
  );
}

function MemberRow({ member: m, money }: { member: MemberOrder; money: (n: number) => string }) {
  const vials = m.products.reduce((s, p) => s + p.qty, 0);
  return (
    <details className="gbm__row">
      <summary className="gbm__summary">
        <span className="gbm__who">
          <span className="gbm__name">{m.name}</span>
          <span className="gbm__meta">
            {m.contact} · {m.checkouts.length} checkout{m.checkouts.length === 1 ? "" : "s"} · {vials} vial
            {vials === 1 ? "" : "s"}
          </span>
        </span>
        <span className="gbm__money">
          <span className="gbm__total">{money(m.total)}</span>
          {m.balance > 0 ? (
            <span className="gbm__pill gbm__pill--due">{money(m.balance)} due</span>
          ) : (
            <span className="gbm__pill gbm__pill--ok">Fully paid</span>
          )}
        </span>
        <svg className="gbm__chev" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>

      <div className="gbm__body">
        <div className="gbm__block">
          <h3 className="gbm__label">Products (all checkouts combined)</h3>
          <table className="gbm__table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="gbm__num">Qty</th>
                <th className="gbm__num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {m.products.map((p) => (
                <tr key={`${p.product}::${p.variation ?? ""}`}>
                  <td>
                    {p.product}
                    {p.variation && !p.product.includes(p.variation) ? ` — ${p.variation}` : ""}
                  </td>
                  <td className="gbm__num">{p.qty}</td>
                  <td className="gbm__num">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="gbm__block">
          <h3 className="gbm__label">Checkouts &amp; payments</h3>
          <table className="gbm__table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th className="gbm__num">Admin fee</th>
                <th className="gbm__num">Total</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {m.checkouts.map((c) => (
                <tr key={c.orderNumber}>
                  <td style={{ fontWeight: 600 }}>{c.orderNumber}</td>
                  <td>{fmtDate(c.date)}</td>
                  <td className="gbm__num">{c.adminFee > 0 ? money(c.adminFee) : "—"}</td>
                  <td className="gbm__num">{money(c.total)}</td>
                  <td>
                    <span className={`gbm__pill ${c.paid ? "gbm__pill--ok" : "gbm__pill--due"}`}>
                      {c.paid ? "Paid" : "Not yet paid"}
                    </span>
                  </td>
                </tr>
              ))}
              <tr className="gbm__sum">
                <td colSpan={2}>Total · paid {money(m.paid)}</td>
                <td className="gbm__num">{money(m.adminFee)}</td>
                <td className="gbm__num">{money(m.total)}</td>
                <td>{m.balance > 0 ? `${money(m.balance)} due` : "Fully paid"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="gbm__addr">
          <span className="gbm__label">Ship to</span> {m.address}
          {m.email && m.email !== m.contact ? ` · ${m.email}` : ""}
        </p>
      </div>
    </details>
  );
}

const css = `
.sf-root .gbm { margin-top: 24px; }
.sf-root .gbm__head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px 24px; margin-bottom: 12px; }
.sf-root .gbm__totals { display: flex; gap: 8px; margin: 0; }
.sf-root .gbm__totals > div { padding: 8px 14px; border-radius: 10px; background: rgba(0,0,0,.04); border: 1px solid rgba(0,0,0,.08); min-width: 108px; }
.sf-root .gbm__totals dt { font-size: 11px; opacity: .65; text-transform: uppercase; letter-spacing: .04em; }
.sf-root .gbm__totals dd { margin: 2px 0 0; font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.sf-root .gbm__ok { color: #15803d; }
.sf-root .gbm__due { color: #b45309; }
.sf-root .gbm__toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-bottom: 10px; }
.sf-root .gbm__toolbar .admin-input { max-width: 320px; flex: 1 1 220px; }
.sf-root .gbm__count { font-size: 12.5px; opacity: .7; }
.sf-root .gbm__list { list-style: none; margin: 0; padding: 0; border: 1px solid rgba(0,0,0,.1); border-radius: 12px; overflow: hidden; }
.sf-root .gbm__list > li + li { border-top: 1px solid rgba(0,0,0,.08); }
.sf-root .gbm__summary {
  display: grid; grid-template-columns: minmax(0,1fr) auto 18px; align-items: center; gap: 12px;
  padding: 12px 14px; cursor: pointer; list-style: none;
  transition: background-color 150ms ease;
}
.sf-root .gbm__summary::-webkit-details-marker { display: none; }
.sf-root .gbm__summary:hover { background: rgba(0,0,0,.03); }
.sf-root .gbm__summary:focus-visible { outline: 2px solid var(--brand-accent, #2563eb); outline-offset: -2px; }
.sf-root .gbm__row[open] > .gbm__summary { background: rgba(0,0,0,.035); }
.sf-root .gbm__who { display: flex; flex-direction: column; min-width: 0; }
.sf-root .gbm__name { font-weight: 700; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-root .gbm__meta { font-size: 12px; opacity: .65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-root .gbm__money { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.sf-root .gbm__total { font-weight: 700; font-variant-numeric: tabular-nums; }
.sf-root .gbm__pill { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 99px; white-space: nowrap; }
.sf-root .gbm__pill--ok { color: #15803d; background: #dcfce7; }
.sf-root .gbm__pill--due { color: #b45309; background: #fef3c7; }
.sf-root .gbm__chev { width: 18px; height: 18px; opacity: .5; transition: transform 200ms ease; }
.sf-root .gbm__row[open] .gbm__chev { transform: rotate(180deg); }
.sf-root .gbm__body { display: grid; gap: 14px; padding: 4px 14px 16px; }
@media (min-width: 960px) { .sf-root .gbm__body { grid-template-columns: 1fr 1.2fr; } .sf-root .gbm__addr { grid-column: 1 / -1; } }
.sf-root .gbm__block { min-width: 0; overflow-x: auto; }
.sf-root .gbm__label { margin: 0 0 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; opacity: .6; }
.sf-root .gbm__addr .gbm__label { display: inline; margin-right: 6px; }
.sf-root .gbm__table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.sf-root .gbm__table th { text-align: left; font-weight: 600; opacity: .6; padding: 4px 6px 4px 0; }
.sf-root .gbm__table td { padding: 6px 6px 6px 0; border-top: 1px solid rgba(0,0,0,.07); vertical-align: top; }
.sf-root .gbm__num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sf-root .gbm__sum td { border-top: 2px solid rgba(0,0,0,.2); font-weight: 700; }
.sf-root .gbm__addr { margin: 0; font-size: 12.5px; opacity: .85; overflow-wrap: anywhere; }
`;
