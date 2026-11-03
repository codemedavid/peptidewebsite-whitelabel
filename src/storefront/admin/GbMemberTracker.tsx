"use client";

// Member tracker — how many group buys each member joined in a period
// (Orders → Group buys → Member tracker). Counting rules live in
// lib/storefront/gb-participation; this screen only picks the period, filters
// and renders. One fetch; every filter change is local.

import { useEffect, useMemo, useState } from "react";
import type { Brand } from "../types";
import { getGroupBuyParticipationAction } from "@/actions/group-buys";
import { formatMoney } from "@/lib/storefront/currency";
import {
  buildParticipation,
  monthOptions,
  participationSummary,
  participationWindow,
  type ParticipantRow,
  type ParticipationOrder,
  type ParticipationPeriod,
} from "@/lib/storefront/gb-participation";
import { csvCell } from "@/lib/storefront/customer-analytics";
import "./member-tracker.css";

type PresetKey = "this" | "last" | "3m" | "6m" | "all" | "month";

const PRESETS: readonly { key: Exclude<PresetKey, "month">; label: string }[] = [
  { key: "this", label: "This month" },
  { key: "last", label: "Last month" },
  { key: "3m", label: "Last 3 months" },
  { key: "6m", label: "Last 6 months" },
  { key: "all", label: "All time" },
];

const MIN_JOINED = [1, 2, 3, 5] as const;

function periodFor(key: PresetKey, month: string, months: readonly { value: string }[]): ParticipationPeriod {
  if (key === "this") return { kind: "month", month: months[0]?.value ?? month };
  if (key === "last") return { kind: "month", month: months[1]?.value ?? months[0]?.value ?? month };
  if (key === "3m") return { kind: "last", months: 3 };
  if (key === "6m") return { kind: "last", months: 6 };
  if (key === "month") return { kind: "month", month };
  return { kind: "all" };
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });

function downloadCsv(rows: readonly ParticipantRow[], periodLabel: string) {
  const header = ["Member", "Email", "Contact", "WhatsApp", "WhatsApp name", "Group buys joined", "Checkouts", "Spent", "Last joined", "Group buys"];
  const lines = [header, ...rows.map((r) => [
    r.name, r.email, r.contact, r.whatsapp, r.whatsappName, r.groupBuys, r.checkouts, r.spent, shortDate(r.lastJoinedAt), r.rounds.join(" | "),
  ])].map((cells) => cells.map((c) => csvCell(c)).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `member-tracker-${periodLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function GbMemberTracker({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const [orders, setOrders] = useState<ParticipationOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<PresetKey>("3m");
  const [month, setMonth] = useState("");
  const [minJoined, setMinJoined] = useState<number>(1);
  const [query, setQuery] = useState("");
  const money = (n: number) => formatMoney(n, brand.currency);

  useEffect(() => {
    let alive = true;
    void getGroupBuyParticipationAction()
      .then((res) => {
        if (!alive) return;
        if ("error" in res) setError(res.error);
        else setOrders(res.enabled ? res.orders : []);
      })
      .catch(() => alive && setError("Couldn't load the member tracker — please refresh."));
    return () => {
      alive = false;
    };
  }, []);

  const now = useMemo(() => new Date(), []);
  const months = useMemo(() => monthOptions(orders ?? [], now), [orders, now]);
  const period = periodFor(preset, month || months[0]?.value || "", months);
  const periodLabel =
    preset === "month"
      ? months.find((m) => m.value === month)?.label ?? "Month"
      : preset === "this" ? months[0]?.label ?? "This month"
      : preset === "last" ? months[1]?.label ?? "Last month"
      : PRESETS.find((p) => p.key === preset)?.label ?? "";

  const rows = useMemo(
    () => (orders ? buildParticipation(orders, participationWindow(period, now)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, preset, month, now],
  );
  const summary = participationSummary(rows);
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      r.groupBuys >= minJoined &&
      (!q || [r.name, r.email, r.contact, r.whatsapp, r.whatsappName].some((v) => v.toLowerCase().includes(q))),
  );

  return (
    <div className="admin">
      <main className="admin__inner mtr">
        <div className="admin-table__head">
          <h1 className="admin-table__title">
            <a className="admin-table__title-back" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Group buys
            </a>
            <span>Member tracker</span>
          </h1>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            disabled={shown.length === 0}
            onClick={() => downloadCsv(shown, periodLabel)}
          >
            Export CSV
          </button>
        </div>
        <p className="ogb-lede">How many group buys each member joined. A member is matched by account, email or phone, so top-ups and repeat orders count once per group buy.</p>

        <div className="mtr-periods" role="group" aria-label="Period">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className="mtr-period"
              aria-pressed={preset === p.key}
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
          <label className={`mtr-month${preset === "month" ? " is-on" : ""}`}>
            <span className="mtr-sr">Pick a month</span>
            <select
              value={preset === "month" ? month : ""}
              onChange={(e) => {
                setMonth(e.target.value);
                setPreset(e.target.value ? "month" : "3m");
              }}
            >
              <option value="">Pick a month…</option>
              {months.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
        </div>

        {error ? (
          <p className="ogb-round__error" role="alert">{error}</p>
        ) : !orders ? (
          <div className="ogb-skeleton" aria-busy="true" aria-label="Loading members"><span /><span /><span /></div>
        ) : (
          <>
            <dl className="mtr-summary" aria-label={`Summary for ${periodLabel}`}>
              <div className="mtr-summary__lead">
                <dt>Members who joined · {periodLabel}</dt>
                <dd>{summary.members}</dd>
              </div>
              <div>
                <dt>Joined 2+ group buys</dt>
                <dd>{summary.repeat}</dd>
              </div>
              <div>
                <dt>Total joins</dt>
                <dd>{summary.joins}</dd>
              </div>
            </dl>

            <div className="mtr-tools">
              <input
                type="search"
                className="admin-input mtr-search"
                placeholder="Search name, email, phone or WhatsApp"
                aria-label="Search members"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="mtr-min" role="group" aria-label="Joined at least">
                <span>Joined at least</span>
                {MIN_JOINED.map((n) => (
                  <button key={n} type="button" className="mtr-chip" aria-pressed={minJoined === n} onClick={() => setMinJoined(n)}>
                    {n} GB{n > 1 ? "s" : ""}
                  </button>
                ))}
              </div>
            </div>

            {shown.length === 0 ? (
              <div className="ogb-nolive">
                {rows.length === 0 ? `No one joined a group buy in ${periodLabel.toLowerCase()}.` : "No member matches these filters."}
              </div>
            ) : (
              <ol className="mtr-list">
                {shown.map((r) => (
                  <li key={r.key} className="mtr-row">
                    <div className="mtr-row__count" aria-label={`${r.groupBuys} group buys joined`}>
                      <strong>{r.groupBuys}</strong>
                      <span>GB{r.groupBuys === 1 ? "" : "s"}</span>
                    </div>
                    <div className="mtr-row__who">
                      <span className="mtr-row__name">{r.name}</span>
                      <span className="mtr-row__meta">
                        {[r.contact, r.whatsappName && `WA: ${r.whatsappName}${r.whatsapp ? ` · ${r.whatsapp}` : ""}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <span className="mtr-row__rounds">
                        {r.rounds.map((name, i) => (
                          <span key={`${name}-${i}`} className="mtr-round">{name}</span>
                        ))}
                      </span>
                    </div>
                    <div className="mtr-row__side">
                      <span className="mtr-row__money">{money(r.spent)}</span>
                      <span className="mtr-row__meta">
                        {r.checkouts} checkout{r.checkouts === 1 ? "" : "s"} · last {shortDate(r.lastJoinedAt)}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </main>
    </div>
  );
}
