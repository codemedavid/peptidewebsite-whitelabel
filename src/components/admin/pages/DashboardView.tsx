"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CounterValue,
  FeedText,
  Ic,
  KPI,
  Sparkline,
  TenantAvatar,
} from "@/components/admin/shell/primitives";
import { formatPesosCompact } from "@/lib/admin/plans";
import type { AttentionItem, AttentionQueue, OverviewData } from "@/lib/admin/data";

/* ---------- revenue chart (SVG, hover tooltip) ---------- */
function RevenueChart({ series }: { series: OverviewData["revenueSeries"] }) {
  const w = 760,
    h = 240,
    pad = { l: 44, r: 16, t: 16, b: 30 };
  const data = series.current;
  const prev = series.previous;
  const labels = series.labels;
  const maxY = Math.max(...data, ...prev, 1) * 1.1;
  const stepX = (w - pad.l - pad.r) / (data.length - 1 || 1);
  const sx = (i: number) => pad.l + i * stepX;
  const sy = (v: number) => pad.t + (1 - v / maxY) * (h - pad.t - pad.b);
  const path = (arr: number[]) => arr.map((v, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const area = path(data) + ` L${sx(data.length - 1).toFixed(1)},${(h - pad.b).toFixed(1)} L${sx(0).toFixed(1)},${(h - pad.b).toFixed(1)} Z`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round((maxY * t) / 50000) * 50000);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div style={{ position: "relative", padding: "8px 0" }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        preserveAspectRatio="none"
        style={{ display: "block", height: 260 }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * w;
          let i = Math.round((x - pad.l) / stepX);
          i = Math.max(0, Math.min(data.length - 1, i));
          setHover(i);
        }}
      >
        <defs>
          <linearGradient id="revArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={sy(v)} y2={sy(v)} stroke="var(--border-soft)" strokeDasharray="2 4" />
            <text x={pad.l - 8} y={sy(v) + 4} fontSize="10.5" textAnchor="end" fill="var(--ink-400)" fontFamily="var(--font-mono)">
              {v >= 1000 ? "₱" + v / 1000 + "k" : "₱" + v}
            </text>
          </g>
        ))}
        {labels.map((l, i) => (
          <text key={i} x={sx(i)} y={h - 10} fontSize="10.5" textAnchor="middle" fill="var(--ink-400)">
            {l}
          </text>
        ))}
        <path d={path(prev)} fill="none" stroke="var(--ink-300)" strokeWidth="1.5" strokeDasharray="4 4" />
        <path d={area} fill="url(#revArea)" />
        <path d={path(data)} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((v, i) => (
          <circle key={i} cx={sx(i)} cy={sy(v)} r={hover === i ? 4.5 : 0} fill="var(--bg)" stroke="var(--accent)" strokeWidth="2" />
        ))}
        {hover !== null && <line x1={sx(hover)} x2={sx(hover)} y1={pad.t} y2={h - pad.b} stroke="var(--accent)" strokeOpacity="0.3" strokeWidth="1" />}
      </svg>
      {hover !== null && (
        <div
          style={{
            position: "absolute",
            left: `calc(${(sx(hover) / w) * 100}% - 70px)`,
            top: 4,
            background: "var(--bg)",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 11.5,
            boxShadow: "var(--shadow-md)",
            minWidth: 140,
            pointerEvents: "none",
          }}
        >
          <div style={{ color: "var(--ink-400)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{labels[hover]}</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: "var(--ink-500)" }}>This year</span>
            <span className="tnum" style={{ fontWeight: 600 }}>
              {formatPesosCompact(data[hover] * 100)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 2 }}>
            <span style={{ color: "var(--ink-400)" }}>Prev year</span>
            <span className="tnum muted">{formatPesosCompact(prev[hover] * 100)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function GrowthBars({ data, labels }: { data: number[]; labels: string[] }) {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 180, padding: "4px 0 24px" }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div
            style={{
              width: "100%",
              height: `${(v / max) * 100}%`,
              background: "linear-gradient(180deg, var(--accent) 0%, var(--accent) 60%, rgba(47,98,245,0.5) 100%)",
              borderRadius: "6px 6px 2px 2px",
              minHeight: 4,
            }}
            title={`${labels[i]} · ${v} tenants`}
          />
          <div style={{ fontSize: 10.5, color: "var(--ink-400)" }}>{labels[i]}</div>
        </div>
      ))}
    </div>
  );
}

type DashboardViewProps = { data: OverviewData; queue: AttentionQueue };

export function DashboardView({ data, queue }: DashboardViewProps) {
  const k = data.kpis;
  const maxRev = Math.max(...data.topTenants.map((t) => t.revenueCents), 1);

  const kpis = [
    { label: "Total tenants", value: <CounterValue value={k.totalTenants} />, delta: `+${k.newTenants30d} vs 30d`, deltaDir: "up" as const, icon: "Buildings", spark: data.sparks.tenants },
    { label: "Active sites", value: <CounterValue value={k.activeSubscriptions} />, delta: "Live", deltaDir: "flat" as const, icon: "Card", spark: data.sparks.subscriptions },
    { label: "Total revenue", value: <CounterValue value={Math.round(k.monthlyRevenueCents / 100 / 1000)} prefix="₱" suffix="k" />, delta: "Plans + 30d", deltaDir: "up" as const, icon: "DollarSign", spark: data.sparks.revenue },
    { label: "Total orders", value: <CounterValue value={k.totalOrders} />, delta: `+${k.newOrders30d} vs 30d`, deltaDir: "up" as const, icon: "Box", spark: data.sparks.orders },
    { label: "Total customers", value: <CounterValue value={k.totalCustomers} />, delta: "Lifetime", deltaDir: "flat" as const, icon: "Users", spark: data.sparks.customers, sparkColor: "var(--success)" },
    { label: "Active trials", value: <CounterValue value={k.activeTrials} />, delta: "In trial", deltaDir: "flat" as const, icon: "Sparkles", spark: data.sparks.trials, sparkColor: "var(--warn)" },
  ];

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Platform overview</h1>
          <p className="page-sub">Your to-do list first, then metrics across every tenant storefront</p>
        </div>
      </div>

      {/* What needs doing comes first; the metrics follow. */}
      <NeedsAttention queue={queue} expiringCount={data.expiringTenants.length} />
      {data.expiringTenants.length > 0 && <ExpiringPanel tenants={data.expiringTenants} />}

      <div className="kpi-grid">
        {kpis.map((kpi, i) => (
          <KPI key={i} {...kpi} />
        ))}
      </div>

      <div className="grid-2 mb-4">
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">Platform revenue</h3>
              <div className="card-sub">Order revenue · trailing 12 months vs prior year</div>
            </div>
            <div className="row" style={{ gap: 14, fontSize: 11.5 }}>
              <span className="row" style={{ gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--accent)" }} />
                <span className="muted">This year</span>
              </span>
              <span className="row" style={{ gap: 6 }}>
                <span style={{ width: 8, height: 2, background: "var(--ink-300)" }} />
                <span className="muted">Last year</span>
              </span>
            </div>
          </div>
          <div className="card-body" style={{ padding: 12 }}>
            <RevenueChart series={data.revenueSeries} />
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">Tenant growth</h3>
              <div className="card-sub">Active tenants by month</div>
            </div>
            <span className="badge badge-success">
              <Ic.TrendUp style={{ width: 11, height: 11 }} /> {k.totalTenants}
            </span>
          </div>
          <div className="card-body">
            <GrowthBars data={data.tenantGrowth} labels={data.revenueSeries.labels} />
            <div className="row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--border-soft)", paddingTop: 14, marginTop: -8 }}>
              <Stat label="Total" value={String(k.totalTenants)} />
              <Stat label="Active" value={String(k.activeSubscriptions)} />
              <Stat label="Trials" value={String(k.activeTrials)} tone="var(--success)" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">Top performing tenants</h3>
              <div className="card-sub">By total revenue</div>
            </div>
            <Link href="/tenants" className="btn btn-ghost btn-sm">
              View all <Ic.ArrowRight />
            </Link>
          </div>
          <div>
            {data.topTenants.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>No active tenants yet.</div>}
            {data.topTenants.map((t, i) => (
              <Link
                key={t.id}
                href={`/tenants/${t.slug}`}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: i < data.topTenants.length - 1 ? "1px solid var(--border-soft)" : "none" }}
              >
                <div style={{ width: 18, color: "var(--ink-400)", fontSize: 12, fontVariantNumeric: "tabular-nums", textAlign: "center" }}>{i + 1}</div>
                <TenantAvatar name={t.name} logoUrl={t.logoUrl} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="tenant-name">{t.name}</div>
                  <div className="tenant-domain">{t.slug}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="tnum" style={{ fontWeight: 600 }}>
                    {formatPesosCompact(t.revenueCents)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-400)" }} className="tnum">
                    {t.orders.toLocaleString()} orders
                  </div>
                </div>
                <div style={{ width: 70 }}>
                  <div className="bar">
                    <span style={{ width: `${Math.min(100, (t.revenueCents / maxRev) * 100)}%` }} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">Recent activity</h3>
              <div className="card-sub">Platform-wide events</div>
            </div>
            <Link href="/audit" className="btn btn-ghost btn-sm">
              All logs
            </Link>
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            {data.activity.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>No recent activity.</div>}
            {data.activity.map((a, i) => {
              const IconCmp = Ic[a.icon] || Ic.Activity;
              return (
                <div key={i} className="feed-item">
                  <div className="feed-dot" style={a.danger ? { background: "var(--danger-soft)", color: "var(--danger)" } : {}}>
                    <IconCmp />
                  </div>
                  <div className="feed-body">
                    <div>
                      <FeedText text={a.text} />
                    </div>
                    <div className="feed-time">{a.time}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// `all` = a page listing the whole bucket. Payments have none — each is
// confirmed on its tenant's Billing tab — so the overflow is plain text.
const QUEUE_COLUMNS: { key: keyof AttentionQueue; title: string; empty: string; all?: string; icon: string }[] = [
  { key: "onboarding", title: "Onboarding", empty: "No sign-ups waiting", all: "/onboarding", icon: "Sparkles" },
  { key: "upgrades", title: "Upgrade requests", empty: "No upgrades to approve", all: "/upgrades", icon: "TrendUp" },
  { key: "payments", title: "Payments to confirm", empty: "No payments to review", icon: "Wallet" },
];

function waitingFor(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** The operator's to-do list: oldest-first queues for the three kinds of work
 *  that wait on them. Collapses to a single line when everything is clear. */
function NeedsAttention({ queue, expiringCount }: { queue: AttentionQueue; expiringCount: number }) {
  const total = queue.onboarding.count + queue.upgrades.count + queue.payments.count;
  if (total === 0) {
    return (
      <div className="card attn-clear mb-4" role="status">
        <Ic.CheckCircle aria-hidden />
        <span>
          Nothing waiting on you{expiringCount > 0 ? ` — ${expiringCount} subscription${expiringCount === 1 ? "" : "s"} expiring below` : ""}.
        </span>
      </div>
    );
  }
  return (
    <section className="card mb-4" aria-labelledby="attn-title">
      <div className="card-head">
        <div>
          <h2 id="attn-title" className="card-title">
            Needs attention
          </h2>
          <div className="card-sub">Oldest first · {total} waiting on you</div>
        </div>
        <span className="badge badge-warn">{total}</span>
      </div>
      <div className="attn-grid">
        {QUEUE_COLUMNS.map((col) => {
          const bucket = queue[col.key];
          const IconCmp = Ic[col.icon];
          return (
            <div key={col.key} className="attn-col">
              <div className="attn-col-head">
                <IconCmp aria-hidden />
                <span>{col.title}</span>
                <span className={"attn-count tnum" + (bucket.count ? " on" : "")}>{bucket.count}</span>
              </div>
              {bucket.items.length === 0 ? (
                <div className="attn-empty">{col.empty}</div>
              ) : (
                <ul className="attn-list">
                  {bucket.items.map((item: AttentionItem) => (
                    <li key={item.id}>
                      <Link href={item.href} className="attn-item">
                        <span className="attn-item-text">
                          <span className="attn-item-title">{item.title}</span>
                          <span className="attn-item-detail">{item.detail}</span>
                        </span>
                        <span className="attn-age tnum">{waitingFor(item.at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {bucket.count > bucket.items.length &&
                (col.all ? (
                  <Link href={col.all} className="attn-more">
                    View all {bucket.count} <Ic.ArrowRight aria-hidden />
                  </Link>
                ) : (
                  <span className="attn-more muted">+{bucket.count - bucket.items.length} more on tenant Billing tabs</span>
                ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** "Expiring soon" panel — tenants whose paid subscription is near due or
 *  lapsed, most-urgent first. Only rendered when non-empty. */
function ExpiringPanel({ tenants }: { tenants: OverviewData["expiringTenants"] }) {
  const dueLabel = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? "—"
      : d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
  };
  return (
    <div className="card mb-4">
      <div className="card-head">
        <div>
          <h3 className="card-title">Expiring soon</h3>
          <div className="card-sub">Subscriptions due within 7 days or already lapsed</div>
        </div>
        <span className="badge badge-warn">{tenants.length}</span>
      </div>
      <div>
        {tenants.map((t, i) => {
          const u = t.subscriptionUrgency!;
          const overdue = u.level === "overdue";
          const tone = overdue ? "var(--danger)" : "var(--warn)";
          const daysText = overdue
            ? "Overdue"
            : `${u.daysLeft} ${u.daysLeft === 1 ? "day" : "days"} left`;
          return (
            <Link
              key={t.id}
              href={`/tenants/${t.slug}`}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: i < tenants.length - 1 ? "1px solid var(--border-soft)" : "none" }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: tone, flexShrink: 0 }} aria-hidden />
              <TenantAvatar name={t.name} logoUrl={t.logoUrl} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="tenant-name">{t.name}</div>
                <div className="tenant-domain">{t.slug}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: tone }}>{daysText}</div>
                <div style={{ fontSize: 11, color: "var(--ink-400)" }} className="tnum">
                  {overdue ? "ended" : "due"} {dueLabel(u.endsAt)}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--ink-400)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: tone }} className="tnum">
        {value}
      </div>
    </div>
  );
}
