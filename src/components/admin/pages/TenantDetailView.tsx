"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ic, StatusBadge, TenantAvatar, FeedText, tenantColor } from "@/components/admin/shell/primitives";
import { useAdminUI } from "@/components/admin/shell/AdminShell";
import { planMeta, planLimits, formatPesos } from "@/lib/admin/plans";
import { FEATURE_GROUPS } from "@/lib/features/catalog";
import { suspendTenantAction } from "@/actions/admin";
import { setTenantAdminPasswordAction } from "@/actions/tenant-admin";
import type { TenantDetail } from "@/lib/admin/data";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "peptide.app").replace(/:\d+$/, "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function TenantDetailView({ tenant }: { tenant: TenantDetail }) {
  const router = useRouter();
  const { showToast } = useAdminUI();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState("overview");
  const pm = planMeta(tenant.planKey);
  const planCls = pm.key === "enterprise" ? "badge-accent" : pm.key === "pro" ? "badge-info" : "badge-neutral";

  const suspend = () =>
    startTransition(async () => {
      const res = await suspendTenantAction(tenant.slug);
      if ("error" in res) showToast(res.error);
      else {
        showToast(`Tenant ${res.status === "suspended" ? "suspended" : "reactivated"}`);
        router.refresh();
      }
    });

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "features", label: "Features", count: tenant.enabledFeatures },
    { id: "usage", label: "Usage" },
    { id: "orders", label: "Orders", count: tenant.orders > 999 ? "1k+" : tenant.orders },
    { id: "billing", label: "Billing" },
    { id: "audit", label: "Audit log" },
  ];

  const aov = tenant.orders > 0 ? Math.round(tenant.revenueCents / 100 / tenant.orders) : 0;
  const storefront = `https://${tenant.slug}.${ROOT}`;

  return (
    <div className="page-inner">
      <Link href="/tenants" className="btn btn-ghost btn-sm mb-3" style={{ paddingLeft: 4 }}>
        <Ic.ChevronLeft /> All tenants
      </Link>

      <div className="card" style={{ marginBottom: 20, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px", display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          <TenantAvatar name={tenant.name} logoUrl={tenant.logoUrl} size={56} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="row" style={{ gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
              <h1 className="page-title" style={{ marginBottom: 0 }}>
                {tenant.name}
              </h1>
              <StatusBadge status={tenant.status} />
              <span className={"badge " + planCls}>{pm.label}</span>
            </div>
            <div className="row" style={{ gap: 16, color: "var(--ink-500)", fontSize: 13, flexWrap: "wrap" }}>
              <a className="row mono" style={{ gap: 4, color: "var(--accent)" }} href={storefront} target="_blank" rel="noreferrer">
                {tenant.slug}.{ROOT} <Ic.External style={{ width: 12, height: 12 }} />
              </a>
              <span>·</span>
              <span>
                <Ic.Users style={{ width: 12, height: 12, verticalAlign: "-2px", marginRight: 4 }} />
                {tenant.owner}
              </span>
              <span>·</span>
              <span>
                <Ic.Mail style={{ width: 12, height: 12, verticalAlign: "-2px", marginRight: 4 }} />
                {tenant.email}
              </span>
              <span>·</span>
              <span>
                <Ic.History style={{ width: 12, height: 12, verticalAlign: "-2px", marginRight: 4 }} />
                Created {tenant.createdAt}
              </span>
            </div>
          </div>
          <div className="row">
            <a className="btn btn-sm" href={storefront} target="_blank" rel="noreferrer">
              <Ic.External /> Login as tenant
            </a>
            <Link className="btn btn-sm" href={`/tenants/${tenant.slug}/settings`}>
              <Ic.Edit /> Edit
            </Link>
            <button className="btn btn-sm" onClick={suspend} disabled={pending}>
              <Ic.Lock /> {tenant.status === "suspended" ? "Reactivate" : "Suspend"}
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderTop: "1px solid var(--border-soft)", background: "var(--bg-canvas)" }}>
          {[
            { label: "Lifetime revenue", v: `$${(tenant.revenueCents / 100 / 1000).toFixed(1)}k`, sub: "all orders" },
            { label: "Total orders", v: tenant.orders.toLocaleString(), sub: aov ? `$${aov} AOV` : "—" },
            { label: "MRR", v: tenant.status === "trial" ? "Trial" : formatPesos(pm.priceCents), sub: `${pm.label} plan` },
            { label: "Customers", v: tenant.visitors.toLocaleString(), sub: "lifetime contacts" },
          ].map((m, i) => (
            <div key={i} style={{ padding: "14px 24px", borderRight: i < 3 ? "1px solid var(--border-soft)" : "none" }}>
              <div style={{ fontSize: 11, color: "var(--ink-400)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{m.label}</div>
              <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4, letterSpacing: "-0.02em" }} className="tnum">
                {m.v}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-400)", marginTop: 2 }}>{m.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <div key={t.id} className={"tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>
            {t.label}
            {t.count !== undefined && <span className="tab-count tnum">{t.count}</span>}
          </div>
        ))}
      </div>

      {tab === "overview" && <Overview tenant={tenant} storefront={storefront} />}
      {tab === "features" && <FeaturesPanel tenant={tenant} />}
      {tab === "usage" && <UsagePanel tenant={tenant} />}
      {tab === "orders" && <OrdersPanel tenant={tenant} />}
      {tab === "billing" && <BillingPanel tenant={tenant} />}
      {tab === "audit" && <AuditPanel tenant={tenant} />}
    </div>
  );
}

/* ---------- helpers ---------- */
function UsageBar({ label, used, cap, unit = "" }: { label: string; used: number; cap: number | null; unit?: string }) {
  const isUnlimited = cap === null;
  const pct = isUnlimited ? Math.min(100, used / 50) : Math.min(100, (used / cap) * 100);
  const tone = pct > 90 ? "danger" : pct > 75 ? "warn" : "success";
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 5 }}>
        <span style={{ color: "var(--ink-700)" }}>{label}</span>
        <span className="tnum muted">
          {used}
          {unit} {isUnlimited ? <span style={{ color: "var(--success)" }}>· unlimited</span> : `/ ${cap.toLocaleString()}${unit}`}
        </span>
      </div>
      <div className={"bar " + tone}>
        <span style={{ width: pct + "%" }} />
      </div>
    </div>
  );
}

function ReviewRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", padding: "8px 0", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
      <div style={{ color: "var(--ink-400)" }}>{k}</div>
      <div style={{ color: "var(--ink-900)" }}>{v}</div>
    </div>
  );
}

function TenantRevenueChart({ data }: { data: number[] }) {
  const w = 480,
    h = 160,
    pad = { l: 36, r: 8, t: 8, b: 22 };
  const max = Math.max(...data, 1) * 1.15;
  const stepX = (w - pad.l - pad.r) / (data.length - 1 || 1);
  const sx = (i: number) => pad.l + i * stepX;
  const sy = (v: number) => pad.t + (1 - v / max) * (h - pad.t - pad.b);
  const path = data.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const area = path + ` L${sx(data.length - 1).toFixed(1)},${(h - pad.b).toFixed(1)} L${sx(0).toFixed(1)},${(h - pad.b).toFixed(1)} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" preserveAspectRatio="none" style={{ display: "block", height: 180 }}>
      <defs>
        <linearGradient id="trArea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#trArea)" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- OVERVIEW ---------- */
function Overview({ tenant, storefront }: { tenant: TenantDetail; storefront: string }) {
  const limits = planLimits(tenant.planKey);
  const ordersThisMonth = Math.min(tenant.orders, limits.ordersPerMonth ?? tenant.orders);
  return (
    <div className="grid-2">
      <div className="col" style={{ gap: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">Revenue trend</h3>
              <div className="card-sub">Last 12 months · {tenant.name}</div>
            </div>
          </div>
          <div className="card-body" style={{ padding: 12 }}>
            <TenantRevenueChart data={tenant.monthlyRevenue} />
          </div>
        </div>

        <WebsitePreview tenant={tenant} storefront={storefront} />

        <div className="card">
          <div className="card-head">
            <h3 className="card-title">Recent orders</h3>
          </div>
          {tenant.recentOrders.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>No orders yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tenant.recentOrders.slice(0, 5).map((o) => (
                  <tr key={o.orderNumber} style={{ cursor: "default" }}>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--ink-700)" }}>
                      {o.orderNumber}
                    </td>
                    <td>{o.customer}</td>
                    <td className="tnum muted">{o.items}</td>
                    <td className="tnum" style={{ textAlign: "right", fontWeight: 500 }}>
                      ${(o.totalCents / 100).toFixed(0)}
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="col" style={{ gap: 16 }}>
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">Quick actions</h3>
          </div>
          <div className="card-body" style={{ display: "grid", gap: 6 }}>
            <ActionRow icon="External" label="Open storefront" sub={`${tenant.slug}.${ROOT}`} href={storefront} external />
            <ActionRow icon="Layers" label="Manage features" sub={`${tenant.enabledFeatures} modules active`} href={`/tenants/${tenant.slug}/features`} />
            <ActionRow icon="Image" label="Edit branding" sub="Theme, colors, logo" href={`/tenants/${tenant.slug}/branding`} />
            <ActionRow icon="Settings" label="Settings" sub="Store, order numbers" href={`/tenants/${tenant.slug}/settings`} />
          </div>
        </div>

        <AdminPasswordCard slug={tenant.slug} />

        <div className="card">
          <div className="card-head">
            <h3 className="card-title">Plan &amp; limits</h3>
          </div>
          <div className="card-body" style={{ padding: 16 }}>
            <UsageBar label="Orders this month" used={ordersThisMonth} cap={limits.ordersPerMonth} />
            <UsageBar label="Staff accounts" used={limits.staffSeats === null ? 9 : Math.min(3, limits.staffSeats)} cap={limits.staffSeats} />
            <UsageBar label="Storage" used={2.4} cap={limits.storageGb} unit="GB" />
            <UsageBar label="Bandwidth (30d)" used={184} cap={limits.bandwidthGb} unit="GB" />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3 className="card-title">Recent activity</h3>
          </div>
          <div>
            {tenant.audit.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>No activity recorded.</div>}
            {tenant.audit.slice(0, 5).map((a, i) => {
              const IconCmp = Ic[a.icon] || Ic.Activity;
              return (
                <div key={i} className="feed-item" style={{ padding: "10px 16px" }}>
                  <div className="feed-dot">
                    <IconCmp />
                  </div>
                  <div className="feed-body">
                    <div style={{ fontSize: 13 }}>
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

function AdminPasswordCard({ slug }: { slug: string }) {
  const { showToast } = useAdminUI();
  const [pending, startTransition] = useTransition();
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const save = () => {
    setErr(null);
    startTransition(async () => {
      const res = await setTenantAdminPasswordAction(slug, pwd);
      if ("error" in res) {
        setErr(res.error);
      } else {
        setPwd("");
        showToast("Tenant admin password updated.");
      }
    });
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">Admin password</h3>
          <div className="card-sub">
            Tenant signs in at <span className="mono">{slug}.{ROOT}/admin</span> with this password.
          </div>
        </div>
      </div>
      <div className="card-body" style={{ display: "grid", gap: 8, padding: 16 }}>
        <input
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          placeholder="New password (min 6 chars)"
          autoComplete="new-password"
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-canvas)",
            fontSize: 13,
          }}
        />
        {err && <div style={{ fontSize: 12, color: "var(--danger)" }}>{err}</div>}
        <button
          type="button"
          className="btn btn-sm"
          onClick={save}
          disabled={pending || pwd.length < 6}
          style={{ justifySelf: "start" }}
        >
          {pending ? "Saving…" : "Set password"}
        </button>
      </div>
    </div>
  );
}

function ActionRow({ icon, label, sub, href, external }: { icon: string; label: string; sub: string; href: string; external?: boolean }) {
  const IconCmp = Ic[icon];
  const inner = (
    <>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--bg-canvas)", display: "grid", placeItems: "center", color: "var(--ink-500)" }}>
        <IconCmp />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-900)" }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "var(--ink-400)" }}>{sub}</div>
      </div>
      <Ic.ChevronRight style={{ width: 14, height: 14, color: "var(--ink-300)" }} />
    </>
  );
  const style = { display: "flex", alignItems: "center", gap: 10, padding: "10px 8px", borderRadius: 8 } as const;
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" style={style}>
      {inner}
    </a>
  ) : (
    <Link href={href} style={style}>
      {inner}
    </Link>
  );
}

function WebsitePreview({ tenant, storefront }: { tenant: TenantDetail; storefront: string }) {
  const [c1, c2] = tenantColor(tenant.name);
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div>
          <h3 className="card-title">Live storefront</h3>
          <div className="card-sub mono">
            {tenant.slug}.{ROOT}
          </div>
        </div>
        <a className="btn btn-sm" href={storefront} target="_blank" rel="noreferrer">
          <Ic.External /> Open
        </a>
      </div>
      <div style={{ padding: 14, background: "var(--bg-canvas)" }}>
        <div style={{ background: "white", border: "1px solid var(--border-c)", borderRadius: 10, overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border-soft)", background: "#f7f8fa" }}>
            <div style={{ display: "flex", gap: 5 }}>
              {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
                <span key={c} style={{ width: 9, height: 9, borderRadius: 999, background: c }} />
              ))}
            </div>
            <div style={{ flex: 1, height: 20, background: "white", border: "1px solid var(--border-c)", borderRadius: 4, fontSize: 10.5, color: "var(--ink-500)", display: "flex", alignItems: "center", padding: "0 8px", fontFamily: "var(--font-mono)" }}>
              {tenant.slug}.{ROOT}
            </div>
          </div>
          <div style={{ padding: 18, color: "#0f1a2b" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 14, borderBottom: "1px solid #e7eaee" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 22, height: 22, borderRadius: 5, background: `linear-gradient(135deg, ${c1}, ${c2})` }} />
                <strong style={{ fontSize: 12, letterSpacing: "-0.01em" }}>{tenant.name}</strong>
              </div>
              <div style={{ display: "flex", gap: 14, fontSize: 10.5, color: "#56627a" }}>
                <span>Products</span>
                <span>Protocols</span>
                <span>COA</span>
                <span>About</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <span style={{ fontSize: 10, padding: "3px 9px", border: "1px solid #d8dce4", borderRadius: 999, color: "#56627a" }}>Sign in</span>
                <span style={{ fontSize: 10, padding: "3px 9px", background: "#0f1a2b", color: "white", borderRadius: 999 }}>Shop</span>
              </div>
            </div>
            <div style={{ paddingTop: 18 }}>
              <div style={{ fontSize: 9.5, color: "#56627a", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Research peptides · lab-tested</div>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.15, maxWidth: 340 }}>Precision compounds for the discerning practitioner.</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 18 }}>
                {["BPC-157", "TB-500", "GHK-Cu"].map((p, i) => (
                  <div key={p} style={{ border: "1px solid #e7eaee", borderRadius: 8, overflow: "hidden", background: "#f7f8fa" }}>
                    <div style={{ height: 56, background: `linear-gradient(135deg, ${["#dbe5ff", "#e0f2fe", "#e8f7ee"][i]} 0%, ${["#c2d4ff", "#bae6fd", "#bbf0cb"][i]} 100%)` }} />
                    <div style={{ padding: "8px 10px" }}>
                      <div style={{ fontSize: 10.5, fontWeight: 600 }}>{p}</div>
                      <div style={{ fontSize: 9.5, color: "#56627a" }}>5mg vial</div>
                      <div style={{ fontSize: 10.5, fontWeight: 600, marginTop: 4 }}>${[89, 119, 64][i]}.00</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- FEATURES ---------- */
function FeaturesPanel({ tenant }: { tenant: TenantDetail }) {
  const grouped = FEATURE_GROUPS.map((group) => ({
    group,
    items: tenant.featureStates.filter((f) => f.group === group),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="grid-2">
      <div>
        {grouped.map(({ group, items }) => {
          const enabledCount = items.filter((f) => f.enabled).length;
          return (
            <div key={group} className="fcat open" style={{ marginBottom: 12 }}>
              <div className="fcat-head" style={{ cursor: "default" }}>
                <div className="fcat-icon">
                  <Ic.Layers />
                </div>
                <div className="fcat-name">{group}</div>
                <div className="fcat-count tnum">
                  {enabledCount} of {items.length} enabled
                </div>
              </div>
              <div className="fcat-body">
                {items.map((f) => (
                  <div key={f.key} className={"feat-row" + (f.locked ? " locked" : "")}>
                    <div className="feat-info">
                      <div className="feat-name">
                        {f.label}
                        {f.locked && (
                          <span className="lock">
                            <Ic.Lock /> Upgrade
                          </span>
                        )}
                      </div>
                      <div className="feat-desc">{f.description}</div>
                    </div>
                    <span className={"badge " + (f.locked ? "badge-neutral" : f.enabled ? "badge-success" : "badge-neutral")}>
                      {f.locked ? "Locked" : f.enabled ? "On" : "Off"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="col" style={{ gap: 16, alignSelf: "flex-start" }}>
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">Feature summary</h3>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span className="muted">Total enabled</span>
              <span className="tnum" style={{ fontWeight: 600 }}>
                {tenant.enabledFeatures} / {tenant.totalFeatures}
              </span>
            </div>
            <div className="bar">
              <span style={{ width: `${(tenant.enabledFeatures / Math.max(1, tenant.totalFeatures)) * 100}%` }} />
            </div>
            <div className="divider" />
            {grouped.map(({ group, items }) => (
              <div key={group} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "5px 0" }}>
                <span>{group}</span>
                <span className="tnum muted">
                  {items.filter((f) => f.enabled).length} / {items.length}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">Edit toggles</h3>
          </div>
          <div className="card-body" style={{ padding: 14 }}>
            <div style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 10 }}>Grant or revoke individual modules in the full editor.</div>
            <Link className="btn btn-accent" style={{ width: "100%", justifyContent: "center" }} href={`/tenants/${tenant.slug}/features`}>
              <Ic.Layers /> Open features editor
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- USAGE ---------- */
function UsagePanel({ tenant }: { tenant: TenantDetail }) {
  const limits = planLimits(tenant.planKey);
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">Usage · last 30 days</h3>
      </div>
      <div className="card-body" style={{ padding: 20 }}>
        <UsageBar label="Orders" used={Math.min(tenant.orders, limits.ordersPerMonth ?? tenant.orders)} cap={limits.ordersPerMonth} />
        <UsageBar label="Customers" used={tenant.visitors} cap={null} />
        <UsageBar label="Email sends" used={Math.round(tenant.orders * 2.4)} cap={limits.emailSends} />
        <UsageBar label="Staff seats" used={limits.staffSeats === null ? 9 : Math.min(3, limits.staffSeats)} cap={limits.staffSeats} />
        <UsageBar label="Storage" used={2.4} cap={limits.storageGb} unit="GB" />
        <UsageBar label="Bandwidth" used={184} cap={limits.bandwidthGb} unit="GB" />
      </div>
    </div>
  );
}

/* ---------- ORDERS ---------- */
function OrdersPanel({ tenant }: { tenant: TenantDetail }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">Order history</h3>
      </div>
      {tenant.recentOrders.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>No orders recorded for this tenant.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Items</th>
              <th style={{ textAlign: "right" }}>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tenant.recentOrders.map((o) => (
              <tr key={o.orderNumber} style={{ cursor: "default" }}>
                <td className="mono" style={{ fontSize: 12.5, color: "var(--ink-700)" }}>
                  {o.orderNumber}
                </td>
                <td className="muted">{o.date}</td>
                <td>{o.customer}</td>
                <td className="tnum muted">{o.items}</td>
                <td className="tnum" style={{ textAlign: "right", fontWeight: 500 }}>
                  ${(o.totalCents / 100).toFixed(0)}
                </td>
                <td>
                  <StatusBadge status={o.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------- BILLING ---------- */
function BillingPanel({ tenant }: { tenant: TenantDetail }) {
  const pm = planMeta(tenant.planKey);
  const priceCents = pm.priceCents;
  const now = new Date();
  const invoices = Array.from({ length: 6 }).map((_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 10);
    const failed = i === 0 && tenant.status === "past_due";
    return { id: `INV-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`, date: `${MONTHS[d.getMonth()]} 10`, amount: priceCents, failed };
  });
  return (
    <div className="grid-2">
      <div className="col" style={{ gap: 16 }}>
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">Subscription</h3>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}>{pm.label}</div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                  {tenant.status === "trial" ? "Free trial · 14 days" : `${formatPesos(priceCents)}/mo · billed monthly`}
                </div>
              </div>
              <Link className="btn" href={`/tenants/${tenant.slug}/settings`}>
                Change plan
              </Link>
            </div>
            <div className="divider" />
            <ReviewRow k="Status" v={<StatusBadge status={tenant.status} />} />
            <ReviewRow k="Billing email" v={tenant.email} />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3 className="card-title">Invoice history</h3>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} style={{ cursor: "default" }}>
                  <td className="mono" style={{ fontSize: 12.5 }}>
                    {inv.id}
                  </td>
                  <td className="muted">{inv.date}</td>
                  <td className="tnum">{formatPesos(inv.amount, { decimals: true })}</td>
                  <td>
                    <span className={"badge " + (inv.failed ? "badge-danger" : "badge-success")}>
                      <span className="bdot" />
                      {inv.failed ? "Failed" : "Paid"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="col" style={{ gap: 16 }}>
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">Lifetime metrics</h3>
          </div>
          <div className="card-body">
            <ReviewRow k="Lifetime revenue" v={<span className="tnum">${(tenant.revenueCents / 100 / 1000).toFixed(1)}k</span>} />
            <ReviewRow k="Total orders" v={<span className="tnum">{tenant.orders.toLocaleString()}</span>} />
            <ReviewRow k="Failed payments" v={tenant.status === "past_due" ? <span style={{ color: "var(--danger)" }}>1 · needs review</span> : "0"} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- AUDIT ---------- */
function AuditPanel({ tenant }: { tenant: TenantDetail }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">Audit log</h3>
      </div>
      <div style={{ padding: "8px 0 12px" }}>
        {tenant.audit.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>No audit entries recorded.</div>}
        {tenant.audit.map((e, i) => {
          const IconCmp = Ic[e.icon] || Ic.Activity;
          return (
            <div key={i} style={{ display: "flex", gap: 14, padding: "12px 20px" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div className="feed-dot" style={{ width: 26, height: 26 }}>
                  <IconCmp />
                </div>
                {i < tenant.audit.length - 1 && <div style={{ flex: 1, width: 1, background: "var(--border-soft)", minHeight: 14 }} />}
              </div>
              <div style={{ flex: 1, paddingBottom: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink-900)" }}>
                    <FeedText text={e.text} />
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-400)", whiteSpace: "nowrap" }}>{e.time}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
