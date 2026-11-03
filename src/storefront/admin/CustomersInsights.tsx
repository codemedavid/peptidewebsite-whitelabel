"use client";

// The analytics half of the store-admin Customers page: KPI row, revenue from
// customer accounts, segments, the Top spenders board, concentration and
// needs-attention. Every number comes from lib/storefront/customer-analytics;
// this file only decides markup. Rendered only with the Orders grant (the
// ledger is null without it).

import { useMemo, useState } from "react";
import {
  buildAttention,
  buildCustomerKpis,
  buildLeaders,
  buildRevenueTrend,
  buildSegments,
  topSpenderShare,
  type AccountInput,
  type AccountStats,
  type CustomerFilter,
  type CustomerKpi,
  type CustomerPeriod,
  type LeaderMetric,
  type LedgerEntry,
} from "@/lib/storefront/customer-analytics";
import { customerInitials } from "./AdminCustomerProfile";

const BAR_MAX_PCT = 82;
const AVATAR_TINTS = 6;
const MEDALS = 3;

export interface CustomersInsightsProps {
  accounts: AccountInput[];
  ledger: LedgerEntry[];
  stats: Map<string, AccountStats>;
  period: CustomerPeriod;
  now: Date;
  /** Whole units, grouped: "₱12,400". */
  money: (n: number) => string;
  /** Compact for chart labels: "₱12.4k". */
  moneyShort: (n: number) => string;
  vipRule: string;
  onOpenProfile?: (id: string) => void;
  onFilter: (filter: CustomerFilter) => void;
  /** Promo Codes, when this store and actor have it. */
  onOpenPromo?: () => void;
}

/** A stable pastel slot (0–5) per customer id. */
export function avatarTint(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % AVATAR_TINTS;
}

export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function kpiValue(k: CustomerKpi, money: (n: number) => string): string {
  if (k.kind === "money") return money(k.value);
  if (k.kind === "percent") return `${Math.round(k.value * 100)}%`;
  return k.value.toLocaleString();
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

type TrendProps = Pick<CustomersInsightsProps, "ledger" | "period" | "now" | "money" | "moneyShort">;

function RevenueTrendCard({ ledger, period, now, money, moneyShort }: TrendProps) {
  const trend = useMemo(() => buildRevenueTrend(ledger, period, now), [ledger, period, now]);
  const max = Math.max(...trend.bars.map((b) => b.total), 1);
  const summary = trend.bars.map((b) => `${b.label}: ${money(b.total)}`).join(", ");
  return (
    <section className="cx-card" aria-labelledby="cx-trend-title">
      <header className="cx-card__head">
        <h2 id="cx-trend-title" className="cx-card__title">Revenue from customer accounts</h2>
        <span className="cx-card__caption">{trend.caption}</span>
      </header>
      <div className="cx-bars" role="img" aria-label={summary}>
        {trend.bars.map((b, i) => (
          <div key={b.key} className="cx-bars__col">
            <span className="cx-bars__value">{b.total > 0 ? moneyShort(b.total) : "—"}</span>
            <div
              className="cx-bars__bar"
              data-current={i === trend.bars.length - 1 ? "true" : undefined}
              style={{ height: `${Math.max(1, Math.round((b.total / max) * BAR_MAX_PCT))}%` }}
              title={`${b.label}: ${money(b.total)}`}
            />
          </div>
        ))}
      </div>
      <div className="cx-bars__labels" aria-hidden="true">
        {trend.bars.map((b) => (
          <span key={b.key}>{b.label}</span>
        ))}
      </div>
    </section>
  );
}

type SegmentsProps = Pick<CustomersInsightsProps, "accounts" | "stats" | "money" | "vipRule" | "onFilter">;

function SegmentsCard({ accounts, stats, money, vipRule, onFilter }: SegmentsProps) {
  const segments = useMemo(() => buildSegments(accounts, stats, vipRule), [accounts, stats, vipRule]);
  const label = segments.map((s) => `${s.label} ${s.count}`).join(", ");
  const filterFor = { vip: "top", repeat: "orders", one: "orders", none: "none" } as const;
  return (
    <section className="cx-card" aria-labelledby="cx-seg-title">
      <header className="cx-card__head">
        <h2 id="cx-seg-title" className="cx-card__title">Customer segments</h2>
        <span className="cx-card__caption">All time · {plural(accounts.length, "account")}</span>
      </header>
      <div className="cx-segbar" role="img" aria-label={label}>
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <div key={s.key} data-seg={s.key} style={{ width: `${s.pct}%` }} />
          ))}
      </div>
      <ul className="cx-seglist">
        {segments.map((s) => (
          <li key={s.key}>
            <button type="button" className="cx-seg" onClick={() => onFilter(filterFor[s.key])} disabled={s.count === 0}>
              <span className="cx-seg__swatch" data-seg={s.key} aria-hidden="true" />
              <span className="cx-seg__text">
                <span className="cx-seg__label">{s.label}</span>
                <span className="cx-seg__rule">{s.rule}</span>
              </span>
              <span className="cx-seg__nums">
                <span className="cx-seg__count">{plural(s.count, "customer")}</span>
                <span className="cx-seg__rev">{money(s.revenue)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type LeadersProps = Pick<CustomersInsightsProps, "accounts" | "stats" | "money" | "onOpenProfile">;

function LeadersCard({ accounts, stats, money, onOpenProfile }: LeadersProps) {
  const [metric, setMetric] = useState<LeaderMetric>("spend");
  const leaders = useMemo(() => buildLeaders(accounts, stats, metric), [accounts, stats, metric]);
  return (
    <section className="cx-card cx-leaders" aria-labelledby="cx-top-title">
      <header className="cx-card__head cx-card__head--center">
        <div className="cx-card__stack">
          <h2 id="cx-top-title" className="cx-card__title">Top spenders</h2>
          <span className="cx-card__caption">All customers · all time</span>
        </div>
        <div className="cx-toggle" role="group" aria-label="Rank by">
          {(["spend", "orders"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {m === "spend" ? "By spend" : "By orders"}
            </button>
          ))}
        </div>
      </header>
      {leaders.length === 0 ? (
        <p className="cx-empty">Your best buyers show up here after their first order.</p>
      ) : (
        <ol className="cx-board">
          {leaders.map((c, i) => {
            const value = metric === "spend" ? money(c.spent) : plural(c.orders, "order");
            const secondary =
              metric === "spend"
                ? `${plural(c.orders, "order")} · avg ${money(c.avg)}`
                : `${money(c.spent)} spent · last order ${shortDate(c.lastAt)}`;
            return (
              <li key={c.id} className="cx-board__row">
                <span className="cx-rank" data-medal={i < MEDALS ? String(i + 1) : undefined}>
                  {i + 1}
                </span>
                <span className="cx-avatar" data-tint={avatarTint(c.id)} aria-hidden="true">
                  {customerInitials(c.name)}
                </span>
                <span className="cx-board__who">
                  {onOpenProfile ? (
                    <button type="button" className="cx-name" onClick={() => onOpenProfile(c.id)}>
                      {c.name}
                    </button>
                  ) : (
                    <span className="cx-name">{c.name}</span>
                  )}
                  <span className="cx-board__sub">{secondary}</span>
                </span>
                <span className="cx-meter" aria-hidden="true">
                  <span style={{ width: `${c.pct}%` }} />
                </span>
                <span className="cx-board__value">{value}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

type SideProps = Pick<CustomersInsightsProps, "accounts" | "stats" | "now" | "onFilter" | "onOpenPromo">;

function SideCards({ accounts, stats, now, onFilter, onOpenPromo }: SideProps) {
  const share = useMemo(() => topSpenderShare(stats), [stats]);
  const { noOrders, lapsed, toLink } = useMemo(() => buildAttention(accounts, stats, now), [accounts, stats, now]);
  const lapsedMonth = lapsed.lastAt ? new Date(lapsed.lastAt).toLocaleDateString(undefined, { month: "long" }) : "";
  const more = lapsed.count - lapsed.names.length;
  return (
    <div className="cx-side">
      {share !== null && (
        <section className="cx-card cx-concentration" aria-labelledby="cx-conc-title">
          <span id="cx-conc-title" className="cx-concentration__eyebrow">CONCENTRATION</span>
          <span className="cx-concentration__figure">{Math.round(share * 100)}%</span>
          <p className="cx-concentration__text">
            of account revenue comes from your top {Math.min(MEDALS, accounts.length)} customers. Keep them close.
          </p>
          <button type="button" className="cx-concentration__cta" onClick={() => onFilter("top")}>
            See top spenders
          </button>
        </section>
      )}
      <section className="cx-card" aria-labelledby="cx-attn-title">
        <h2 id="cx-attn-title" className="cx-card__title">Needs attention</h2>
        {toLink.accounts > 0 && (
          <div className="cx-attn">
            <span className="cx-attn__title">
              {plural(toLink.orders, "earlier order")} to link to {plural(toLink.accounts, "account")}
            </span>
            <span className="cx-attn__text">
              Placed as a guest with the same email before they signed up. Link them so the history and totals are
              complete.
            </span>
            <button type="button" className="cx-link" onClick={() => onFilter("unlinked")}>
              Review →
            </button>
          </div>
        )}
        {toLink.accounts > 0 && (noOrders.count > 0 || lapsed.count > 0) && <div className="cx-rule" />}
        {toLink.accounts === 0 && noOrders.count === 0 && lapsed.count === 0 && (
          <p className="cx-empty">Nothing waiting on you. Every account has bought recently.</p>
        )}
        {noOrders.count > 0 && (
          <div className="cx-attn">
            <span className="cx-attn__title">{plural(noOrders.count, "account")}, no orders yet</span>
            <span className="cx-attn__text">
              {noOrders.joinedThisWeek > 0 ? `${noOrders.joinedThisWeek} joined this week. ` : ""}A first-order promo code
              often converts sign-ups.
            </span>
            <button type="button" className="cx-link" onClick={onOpenPromo ?? (() => onFilter("none"))}>
              {onOpenPromo ? "Create promo code →" : "View them →"}
            </button>
          </div>
        )}
        {noOrders.count > 0 && lapsed.count > 0 && <div className="cx-rule" />}
        {lapsed.count > 0 && (
          <div className="cx-attn">
            <span className="cx-attn__title">{plural(lapsed.count, "buyer")} quiet for 45+ days</span>
            <span className="cx-attn__text">
              {lapsed.names.join(" and ")}
              {more > 0 ? ` and ${more} more` : ""} {lapsed.count === 1 ? "hasn't" : "haven't"} ordered since{" "}
              {lapsedMonth}.
            </span>
            <button type="button" className="cx-link" onClick={() => onFilter("lapsed")}>
              View quiet buyers →
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export function CustomersInsights(props: CustomersInsightsProps) {
  const { accounts, ledger, stats, period, now, money } = props;
  const kpis = useMemo(
    () => buildCustomerKpis({ accounts, ledger, stats, period, now }),
    [accounts, ledger, stats, period, now],
  );
  return (
    <>
      <section className="cx-kpis" aria-label="Customer metrics">
        {kpis.map((k) => (
          <div key={k.id} className="cx-kpi">
            <span className="cx-kpi__label">{k.label}</span>
            <span className="cx-kpi__value">{kpiValue(k, money)}</span>
            <span className="cx-kpi__sub">{k.sub}</span>
          </div>
        ))}
      </section>

      <div className="cx-grid">
        <RevenueTrendCard {...props} />
        <SegmentsCard {...props} />
      </div>

      <div className="cx-grid cx-grid--leaders">
        <LeadersCard {...props} />
        <SideCards {...props} />
      </div>
    </>
  );
}
