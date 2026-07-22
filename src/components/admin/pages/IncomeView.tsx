"use client";

// "My Income" client view (/admin/income) — the Claude Design "Income
// Analytics" screen ported onto the .sa admin design system and wired to real
// data (IncomeAnalytics from lib/admin/income-data.ts). Client-side state is
// only the weekly/monthly chart granularity; everything shown comes from the
// server-computed, JSON-safe payload.

import { useMemo, useState } from "react";
import Link from "next/link";
import type { IncomeAnalytics, IncomeSeries, UpcomingRenewal } from "@/lib/admin/income-analytics";

type Granularity = "weekly" | "monthly";

const PLAN_BAR_COLORS = ["var(--accent)", "#7c3aed", "#8fa3ff", "#0ea5e9"];

const URGENCY_BADGE: Record<UpcomingRenewal["urgency"], { cls: string; label: string }> = {
  overdue: { cls: "badge-danger", label: "Overdue" },
  due_soon: { cls: "badge-warn", label: "Due soon" },
  scheduled: { cls: "badge-success", label: "Scheduled" },
};

// Distinct-but-calm avatar tints, picked by a stable hash of the tenant id.
const AVATAR_TINTS = [
  { bg: "var(--accent-soft)", fg: "var(--accent-ink)" },
  { bg: "var(--success-soft)", fg: "var(--success)" },
  { bg: "var(--warn-soft)", fg: "var(--warn)" },
  { bg: "var(--info-soft)", fg: "var(--info)" },
];

function tintOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_TINTS[(h >>> 0) % AVATAR_TINTS.length];
}

function peso(cents: number): string {
  return "₱" + Math.round(cents / 100).toLocaleString("en-PH");
}

function pesoAxis(cents: number): string {
  const pesos = cents / 100;
  return pesos >= 1000 ? `₱${Math.round(pesos / 1000)}k` : `₱${Math.round(pesos)}`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

/** Actual (solid + area) vs projected (dashed) income chart, adapted from the
 *  design's buildChart onto the admin theme tokens. */
function IncomeChart({ series }: { series: IncomeSeries }) {
  const W = 1100;
  const H = 300;
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 34;

  const labels = [...series.labels, ...series.projectedLabels];
  const actual = series.actualCents;
  const projected = series.projectedCents;
  const all = [...actual, ...projected, 1];
  const rawMax = Math.max(...all) * 1.15;
  // Round the axis top to a clean step so gridline labels stay tidy.
  const step = Math.pow(10, Math.max(2, Math.floor(Math.log10(rawMax)) - 1));
  const max = Math.ceil(rawMax / step) * step;
  const n = labels.length;
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, n - 1);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);

  const aPts = actual.map((v, i) => [x(i), y(v)] as const);
  const lastA = aPts[aPts.length - 1] ?? ([x(0), y(0)] as const);
  const lineD = "M" + aPts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L");
  const areaD = `${lineD} L${lastA[0].toFixed(1)},${y(0).toFixed(1)} L${(aPts[0]?.[0] ?? x(0)).toFixed(1)},${y(0).toFixed(1)} Z`;
  const pPts = [lastA, ...projected.map((v, i) => [x(actual.length + i), y(v)] as const)];
  const projD = "M" + pPts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L");

  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((t) => max * t);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Actual vs projected platform income">
      <defs>
        <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridVals.map((gv) => (
        <g key={gv}>
          <line x1={padL} x2={W - padR} y1={y(gv)} y2={y(gv)} stroke="var(--border-soft)" strokeDasharray="3 4" />
          <text x={padL - 8} y={y(gv) + 4} textAnchor="end" fontSize={11} fill="var(--ink-400)">
            {pesoAxis(gv)}
          </text>
        </g>
      ))}
      {labels.map((l, i) => (
        <text
          key={`${l}-${i}`}
          x={x(i)}
          y={H - 10}
          textAnchor="middle"
          fontSize={11.5}
          fill={i >= actual.length ? "var(--accent)" : "var(--ink-400)"}
          fontWeight={i >= actual.length ? 600 : 400}
          opacity={i >= actual.length ? 0.75 : 1}
        >
          {l}
        </text>
      ))}
      {/* projection zone tint */}
      <rect x={lastA[0]} y={padT} width={Math.max(0, W - padR - lastA[0])} height={H - padT - padB} fill="var(--accent)" opacity={0.03} />
      <path d={areaD} fill="url(#incomeGrad)" />
      <path d={lineD} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" />
      <path d={projD} fill="none" stroke="var(--accent)" strokeOpacity={0.45} strokeWidth={2.5} strokeDasharray="6 6" strokeLinejoin="round" />
      {aPts.map((p, i) => (
        <circle key={`a${i}`} cx={p[0]} cy={p[1]} r={3.5} fill="var(--bg)" stroke="var(--accent)" strokeWidth={2} />
      ))}
      {pPts.slice(1).map((p, i) => (
        <circle key={`p${i}`} cx={p[0]} cy={p[1]} r={3.5} fill="var(--bg)" stroke="var(--accent)" strokeOpacity={0.45} strokeWidth={2} />
      ))}
    </svg>
  );
}

function upcomingCsv(rows: UpcomingRenewal[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = "Tenant,Plan,Monthly (PHP),Renews,Status";
  const body = rows.map((u) =>
    [
      esc(u.name),
      esc(u.planLabel),
      (u.monthlyCents / 100).toFixed(2),
      new Date(u.renewsIso).toISOString().slice(0, 10),
      URGENCY_BADGE[u.urgency].label,
    ].join(","),
  );
  return [head, ...body].join("\n");
}

export function IncomeView({ data }: { data: IncomeAnalytics }) {
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const monthly = granularity === "monthly";
  const series = monthly ? data.monthly : data.weekly;

  const expectedCents = monthly ? data.expectedThisMonthCents : data.expectedThisWeekCents;
  const expectedSub = monthly
    ? `${data.activeBilledCount} active tenant${data.activeBilledCount === 1 ? "" : "s"} billed`
    : `${data.renewalsThisWeekCount} renewal${data.renewalsThisWeekCount === 1 ? "" : "s"} due this week`;
  const collectedSub =
    data.mrrCents > 0
      ? `${data.collectedPct}% of expected · ${data.paidTenantCountThisMonth} of ${data.activeBilledCount} paid`
      : "No billed tenants yet";
  const chartSub = monthly
    ? `Monthly · last 6 months + next ${data.monthly.projectedCents.length} projected`
    : `Weekly · last 6 weeks + next ${data.weekly.projectedCents.length} projected`;

  const displayUpcoming = useMemo(() => data.upcoming.slice(0, 8), [data.upcoming]);

  const exportCsv = () => {
    const blob = new Blob([upcomingCsv(data.upcoming)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "upcoming-tenant-payments.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">My Income</h1>
          <p className="page-sub">Your subscription earnings from tenant billing — past performance and projected income</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="seg" role="tablist" aria-label="Chart granularity">
            <button
              type="button"
              role="tab"
              aria-selected={!monthly}
              className={"seg-item" + (!monthly ? " active" : "")}
              onClick={() => setGranularity("weekly")}
            >
              Weekly
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={monthly}
              className={"seg-item" + (monthly ? " active" : "")}
              onClick={() => setGranularity("monthly")}
            >
              Monthly
            </button>
          </div>
          <button type="button" className="btn btn-sm" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid-3 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
        <div className="kpi">
          <div className="kpi-label">MRR (monthly recurring)</div>
          <div className="kpi-value">{peso(data.mrrCents)}</div>
          {data.momDeltaPct !== null && (
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6, color: data.momDeltaPct >= 0 ? "var(--success)" : "var(--danger)" }}>
              {data.momDeltaPct >= 0 ? "+" : ""}
              {data.momDeltaPct}% collections vs prior month
            </div>
          )}
        </div>
        <div className="kpi">
          <div className="kpi-label">Expected {monthly ? "this month" : "this week"}</div>
          <div className="kpi-value">{peso(expectedCents)}</div>
          <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 6 }}>{expectedSub}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Collected this month</div>
          <div className="kpi-value">{peso(data.collectedThisMonthCents)}</div>
          <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 6 }}>{collectedSub}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Projected · next 3 mo</div>
          <div className="kpi-value">{peso(data.projectedNext3moCents)}</div>
          <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 6 }}>From active tenant billing</div>
        </div>
      </div>

      {/* Income chart */}
      <div className="card mb-4">
        <div className="card-head">
          <div>
            <h3 className="card-title">Platform income</h3>
            <div className="card-sub">{chartSub} · pulled from tenant billing</div>
          </div>
          <div style={{ display: "flex", gap: 18, alignItems: "center", fontSize: 13, color: "var(--ink-500)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 18, height: 3, borderRadius: 2, background: "var(--accent)", display: "inline-block" }} /> Actual income
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 18, height: 0, borderTop: "3px dashed var(--accent)", opacity: 0.45, display: "inline-block" }} /> Projected
            </span>
          </div>
        </div>
        <div className="card-body" style={{ padding: 12 }}>
          <IncomeChart series={series} />
        </div>
      </div>

      {/* Upcoming payments + right-hand stack */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="card-head">
            <div>
              <h3 className="card-title">Upcoming tenant payments</h3>
              <div className="card-sub">Next renewals, amounts from each tenant&apos;s billing settings</div>
            </div>
            <Link href="/tenants" style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>
              View all
            </Link>
          </div>
          {displayUpcoming.length === 0 ? (
            <div className="card-body" style={{ color: "var(--ink-500)", fontSize: 13.5 }}>
              No subscription windows set yet. Set a tenant&apos;s subscription window from its detail page and renewals will appear here.
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1.2fr 1fr 1fr 1fr",
                  padding: "10px 20px",
                  fontSize: 11.5,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  color: "var(--ink-400)",
                  borderBottom: "1px solid var(--border-soft)",
                  background: "var(--bg-canvas)",
                }}
              >
                <div>TENANT</div>
                <div>PLAN</div>
                <div>MONTHLY</div>
                <div>RENEWS</div>
                <div style={{ textAlign: "right" }}>STATUS</div>
              </div>
              {displayUpcoming.map((u) => {
                const tint = tintOf(u.tenantId);
                const badge = URGENCY_BADGE[u.urgency];
                return (
                  <div
                    key={u.tenantId}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 1.2fr 1fr 1fr 1fr",
                      padding: "12px 20px",
                      fontSize: 13.5,
                      alignItems: "center",
                      borderBottom: "1px solid var(--border-soft)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600, color: "var(--ink-900)" }}>
                      <span
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 8,
                          background: tint.bg,
                          color: tint.fg,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {u.initials}
                      </span>
                      {u.name}
                    </div>
                    <div style={{ color: "var(--ink-700)" }}>{u.planLabel}</div>
                    <div style={{ fontWeight: 600, color: "var(--ink-900)" }}>{peso(u.monthlyCents)}</div>
                    <div style={{ color: "var(--ink-500)" }}>{shortDate(u.renewsIso)}</div>
                    <div style={{ textAlign: "right" }}>
                      <span className={`badge ${badge.cls}`}>{badge.label}</span>
                    </div>
                  </div>
                );
              })}
              <div
                style={{
                  padding: "13px 20px",
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13.5,
                  background: "var(--bg-canvas)",
                }}
              >
                <span style={{ color: "var(--ink-500)" }}>
                  {data.upcoming30dCount} renewal{data.upcoming30dCount === 1 ? "" : "s"} in the next 30 days
                </span>
                <span style={{ fontWeight: 700, color: "var(--ink-900)" }}>{peso(data.upcoming30dTotalCents)} expected</span>
              </div>
            </>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <div>
                <h3 className="card-title">Income by plan</h3>
                <div className="card-sub">Share of MRR per plan tier</div>
              </div>
            </div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {data.planBreakdown.length === 0 && (
                <div style={{ color: "var(--ink-500)", fontSize: 13.5 }}>No recurring income yet.</div>
              )}
              {data.planBreakdown.map((p, i) => (
                <div key={p.key}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                      {p.label}{" "}
                      <span style={{ color: "var(--ink-400)", fontWeight: 500 }}>
                        · {p.tenantCount} tenant{p.tenantCount === 1 ? "" : "s"} · {p.pctOfMrr}%
                      </span>
                    </span>
                    <span style={{ fontWeight: 700, color: "var(--ink-900)" }}>{peso(p.mrrCents)}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: "var(--bg-active)", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        borderRadius: 4,
                        background: PLAN_BAR_COLORS[i % PLAN_BAR_COLORS.length],
                        width: `${p.barPct}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h3 className="card-title">At-risk income</h3>
                <div className="card-sub">Overdue subscription windows</div>
              </div>
            </div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.atRisk.length === 0 && (
                <div style={{ color: "var(--ink-500)", fontSize: 13.5 }}>Nothing overdue — all renewals are on track.</div>
              )}
              {data.atRisk.map((r) => (
                <div
                  key={r.tenantId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    border: "1px solid var(--danger-soft)",
                    background: "color-mix(in srgb, var(--danger-soft) 40%, transparent)",
                    borderRadius: 10,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-900)" }}>{r.name}</div>
                    <div style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 2 }}>{r.note}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--danger)" }}>{peso(r.monthlyCents)}</div>
                </div>
              ))}
              {data.atRisk.length > 0 && (
                <div style={{ fontSize: 12.5, color: "var(--ink-400)" }}>Projections exclude at-risk amounts until resolved.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
