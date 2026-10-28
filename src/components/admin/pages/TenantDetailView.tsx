"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ic, StatusBadge, FeedText, tenantColor } from "@/components/admin/shell/primitives";
import { useAdminUI } from "@/components/admin/shell/AdminShell";
import { planMeta, formatPesos, formatPesosCompact } from "@/lib/admin/plans";
import { setTenantWhatsappAction, setSubscriptionWindowAction } from "@/actions/admin";
import { confirmSubscriptionPaymentAction, rejectSubscriptionPaymentAction } from "@/actions/subscription-payments";
import { ApplyTenantPresetCard } from "@/components/admin/tenant-presets/ApplyTenantPresetCard";
import {
  summarizeSubscriptionPayments,
  canConfirm,
  canReject,
  SUBSCRIPTION_PAYMENT_STATUS_LABELS,
  SUBSCRIPTION_PAYMENT_STATUS_TONE,
} from "@/lib/subscription/payments";
import {
  addBillingCycle,
  BILLING_CYCLES,
  BILLING_CYCLE_LABELS,
  type BillingCycle,
} from "@/lib/subscription/billing-cycle";
import { buildWaLink } from "@/lib/admin/whatsapp";
import { effectivePlanFeeCents } from "@/lib/subscription/plan-fee";
import type { TenantDetailTab } from "@/components/admin/pages/tenant-tabs";
import type {
  StoreAdminCredentialStatus,
  TenantDetail,
  TenantStoreSnapshot,
  TenantSubscriptionPayment,
} from "@/lib/admin/data";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "peptide.app").replace(/:\d+$/, "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format an ISO subscription end date for the tenant-detail Subscription card. */
function subEndLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

type TenantDetailViewProps = {
  tenant: TenantDetail;
  /** Store-owner `#admin` sign-in status; null when it can't be read. */
  signIn: StoreAdminCredentialStatus | null;
  /** Real 30-day store counts; null in demo mode or on a read failure. */
  snapshot: TenantStoreSnapshot | null;
  /** Which in-page tab to show, from ?tab= (see TENANT_DETAIL_TABS). */
  tab: TenantDetailTab;
};

export function TenantDetailView({ tenant, signIn, snapshot, tab }: TenantDetailViewProps) {
  // Identity, actions and the tab bar live in the shared tenant layout
  // (TenantWorkspaceHeader); this view only renders the selected in-page tab.
  const storefront = `https://${tenant.slug}.${ROOT}`;
  return (
    <>
      {tab === "overview" && <Overview tenant={tenant} storefront={storefront} signIn={signIn} snapshot={snapshot} />}
      {tab === "orders" && <OrdersPanel tenant={tenant} />}
      {tab === "billing" && <BillingPanel tenant={tenant} />}
      {tab === "activity" && <AuditPanel tenant={tenant} />}
    </>
  );
}

/** Headline numbers, shown at the top of Overview only. */
function OverviewStats({ tenant }: { tenant: TenantDetail }) {
  const pm = planMeta(tenant.planKey);
  const aov = tenant.orders > 0 ? Math.round(tenant.revenueCents / 100 / tenant.orders) : 0;
  const stats = [
    { label: "Lifetime revenue", v: formatPesosCompact(tenant.revenueCents), sub: "all orders" },
    { label: "Total orders", v: tenant.orders.toLocaleString(), sub: aov ? `₱${aov.toLocaleString("en-PH")} AOV` : "—" },
    {
      label: "Plan fee",
      v: tenant.status === "trial" ? "Trial" : formatPesos(effectivePlanFeeCents(tenant.subscriptionPriceCents, tenant.planPriceCents)),
      sub: `${pm.label} · ${tenant.subscriptionCycle ? BILLING_CYCLE_LABELS[tenant.subscriptionCycle].toLowerCase() : "one-time"}`,
    },
    { label: "Customers", v: tenant.visitors.toLocaleString(), sub: "lifetime contacts" },
  ];
  return (
    <div className="card td-stats-card">
      <div className="td-stats">
        {stats.map((m) => (
          <div key={m.label} className="td-stat">
            <div style={{ fontSize: 11, color: "var(--ink-400)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{m.label}</div>
            <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4, letterSpacing: "-0.02em" }} className="tnum">
              {m.v}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-400)", marginTop: 2 }}>{m.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */
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
type OverviewProps = {
  tenant: TenantDetail;
  storefront: string;
  signIn: StoreAdminCredentialStatus | null;
  snapshot: TenantStoreSnapshot | null;
};

function Overview({ tenant, storefront, signIn, snapshot }: OverviewProps) {
  return (
    <>
    <OverviewStats tenant={tenant} />
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
                      {formatPesos(o.totalCents)}
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
        <StoreSignInCard slug={tenant.slug} signIn={signIn} />

        <ApplyTenantPresetCard slug={tenant.slug} />

        <TenantWhatsappCard slug={tenant.slug} tenantName={tenant.name} current={tenant.ownerWhatsapp} />

        <StoreSnapshotCard tenant={tenant} snapshot={snapshot} />

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
    </>
  );
}

/** Read-only sign-in status. The credential itself is edited in exactly one
 *  place — Settings → Admin access — so there is no second password box here
 *  that writes a different (legacy /dashboard) credential. */
function StoreSignInCard({ slug, signIn }: { slug: string; signIn: StoreAdminCredentialStatus | null }) {
  const ready = !!signIn && signIn.hasPassword && !!signIn.email;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">Store admin sign-in</h3>
          <div className="card-sub">
            Owner signs in at <span className="mono">{slug}.{ROOT}/#admin</span>
          </div>
        </div>
        <span className={"badge " + (ready ? "badge-success" : "badge-warn")}>
          <span className="bdot" />
          {ready ? "Set" : "Not set"}
        </span>
      </div>
      <div className="card-body" style={{ display: "grid", gap: 10, padding: 16 }}>
        {signIn === null ? (
          <div className="muted" style={{ fontSize: 13 }}>Couldn&apos;t read the sign-in status.</div>
        ) : ready ? (
          <div style={{ fontSize: 13 }}>
            <span className="muted">Email · </span>
            <span className="mono">{signIn.email}</span>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--ink-700)" }}>
            Nobody can open this store&apos;s admin until both an email and a password are set.
          </div>
        )}
        <Link className="btn btn-sm" href={`/tenants/${slug}/settings#admin`} style={{ justifySelf: "start" }}>
          <Ic.Lock /> {ready ? "Change sign-in" : "Set up sign-in"}
        </Link>
      </div>
    </div>
  );
}

/** Real counts only. Plan "limits" were never enforced anywhere, so the old
 *  bars (and their storage/bandwidth/email figures) are gone rather than faked. */
function StoreSnapshotCard({ tenant, snapshot }: { tenant: TenantDetail; snapshot: TenantStoreSnapshot | null }) {
  const rows: { label: string; value: string; sub?: string }[] = [
    ...(snapshot ? [{ label: "Orders", value: snapshot.orders30d.toLocaleString(), sub: "last 30 days" }] : []),
    { label: "Orders", value: tenant.orders.toLocaleString(), sub: "all time" },
    { label: "Customers", value: tenant.visitors.toLocaleString(), sub: "lifetime contacts" },
    ...(snapshot
      ? [
          {
            label: "Staff accounts",
            value: snapshot.staffActive.toLocaleString(),
            sub: snapshot.staffTotal > snapshot.staffActive ? `${snapshot.staffTotal - snapshot.staffActive} suspended` : "active",
          },
        ]
      : []),
    { label: "Features on", value: `${tenant.enabledFeatures}`, sub: `of ${tenant.totalFeatures} available` },
  ];
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">Store snapshot</h3>
      </div>
      <dl className="td-snapshot">
        {rows.map((r, i) => (
          <div key={i} className="td-snapshot-row">
            <dt>
              {r.label}
              {r.sub && <span> · {r.sub}</span>}
            </dt>
            <dd className="tnum">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function TenantWhatsappCard({ slug, tenantName, current }: { slug: string; tenantName: string; current?: string }) {
  const { showToast } = useAdminUI();
  const [pending, startTransition] = useTransition();
  const [num, setNum] = useState(current ?? "");
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const save = () => {
    setErr(null);
    startTransition(async () => {
      const res = await setTenantWhatsappAction(slug, num);
      if ("error" in res) {
        setErr(res.error);
      } else {
        showToast(num.trim() ? "WhatsApp number connected." : "WhatsApp number cleared.");
        router.refresh();
      }
    });
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">WhatsApp follow-up</h3>
          <div className="card-sub">One-tap chat with the tenant owner. International format, digits only.</div>
        </div>
        {current && (
          <a
            className="btn btn-sm btn-accent"
            href={buildWaLink(current, `Hi ${tenantName}, `)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Ic.Send /> Message
          </a>
        )}
      </div>
      <div className="card-body" style={{ display: "grid", gap: 8, padding: 16 }}>
        <input
          type="tel"
          value={num}
          onChange={(e) => setNum(e.target.value)}
          placeholder="e.g. 639171234567"
          inputMode="tel"
          autoComplete="off"
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
          disabled={pending || num.trim() === (current ?? "")}
          style={{ justifySelf: "start" }}
        >
          {pending ? "Saving…" : current ? "Update number" : "Connect WhatsApp"}
        </button>
      </div>
    </div>
  );
}

/** Operator setter for the paid-subscription window: pick a billing cycle +
 *  start date and the due date auto-fills one calendar term on (addBillingCycle),
 *  overridable by hand. Mirrors TenantWhatsappCard's inline-action shape. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoToDateInput = (iso?: string): string => (iso ? iso.slice(0, 10) : "");
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-canvas)",
  fontSize: 13,
};

function SubscriptionWindowCard({ tenant }: { tenant: TenantDetail }) {
  const { showToast } = useAdminUI();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [cycle, setCycle] = useState<BillingCycle | "">(tenant.subscriptionCycle ?? "");
  const [startsAt, setStartsAt] = useState(isoToDateInput(tenant.subscriptionStartsAt));
  const [endsAt, setEndsAt] = useState(isoToDateInput(tenant.subscription?.endsAt));
  // Pesos the tenant paid for this term (e.g. the yearly price). Blank = unset.
  const [amount, setAmount] = useState(
    tenant.subscriptionAmountCents != null ? String(tenant.subscriptionAmountCents / 100) : "",
  );
  // The tenant's recurring price / monthly payment due (pesos). Blank = use the
  // plan's list price. 0 is a valid comped-tenant value.
  const [price, setPrice] = useState(
    tenant.subscriptionPriceCents != null ? String(tenant.subscriptionPriceCents / 100) : "",
  );
  // Once the operator hand-edits the due date we stop auto-recomputing it.
  const [overridden, setOverridden] = useState(false);

  /** The auto due date for a cycle + start, or "" when either is unusable. */
  const autoDue = (c: BillingCycle | "", start: string): string => {
    if (!c || !DATE_RE.test(start)) return "";
    return addBillingCycle(new Date(`${start}T00:00:00.000Z`), c).toISOString().slice(0, 10);
  };

  const handleCycle = (next: BillingCycle | "") => {
    setCycle(next);
    // Choosing a cycle is an explicit "recompute" intent — clear any override.
    setOverridden(false);
    setEndsAt(autoDue(next, startsAt));
  };

  const handleStart = (next: string) => {
    setStartsAt(next);
    if (!overridden) setEndsAt(autoDue(cycle, next));
  };

  const handleEnds = (next: string) => {
    setEndsAt(next);
    setOverridden(true);
  };

  const dueBeforeStart =
    DATE_RE.test(startsAt) && DATE_RE.test(endsAt) && endsAt <= startsAt;
  const amountInvalid = amount.trim() !== "" && !(Number.isFinite(Number(amount)) && Number(amount) >= 0);
  const priceInvalid = price.trim() !== "" && !(Number.isFinite(Number(price)) && Number(price) >= 0);
  const canSave =
    !!cycle && DATE_RE.test(startsAt) && DATE_RE.test(endsAt) && !dueBeforeStart && !amountInvalid && !priceInvalid;
  const hasWindow = !!tenant.subscriptionCycle;

  const save = () => {
    setErr(null);
    startTransition(async () => {
      const res = await setSubscriptionWindowAction(tenant.slug, {
        cycle: cycle || null,
        startsAt,
        endsAt,
        amountCents: amount.trim() === "" ? null : Math.round(Number(amount) * 100),
        priceCents: price.trim() === "" ? null : Math.round(Number(price) * 100),
      });
      if ("error" in res) setErr(res.error);
      else if (res.status === "without-price") {
        // Core window saved, but the price column isn't on the live DB yet —
        // tell the operator instead of silently dropping their figure.
        setErr(
          "Window saved — but the monthly price wasn't stored: the subscriptionPriceCents column is missing on the database (run db:push), then save again.",
        );
        showToast("Saved without the monthly price.");
        router.refresh();
      } else {
        showToast("Subscription window saved.");
        router.refresh();
      }
    });
  };

  const clear = () => {
    setErr(null);
    startTransition(async () => {
      const res = await setSubscriptionWindowAction(tenant.slug, { cycle: null });
      if ("error" in res) setErr(res.error);
      else {
        setCycle("");
        setStartsAt("");
        setEndsAt("");
        setAmount("");
        setPrice("");
        setOverridden(false);
        showToast("Subscription window cleared.");
        router.refresh();
      }
    });
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">Subscription window</h3>
          <div className="card-sub">
            Pick a billing cycle and start date — the due date fills in automatically and can be adjusted.
          </div>
        </div>
      </div>
      <div className="card-body" style={{ display: "grid", gap: 10, padding: 16 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--ink-400)" }}>
          Billing cycle
          <select value={cycle} onChange={(e) => handleCycle(e.target.value as BillingCycle | "")} style={inputStyle}>
            <option value="">— none —</option>
            {BILLING_CYCLES.map((c) => (
              <option key={c} value={c}>
                {BILLING_CYCLE_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--ink-400)" }}>
            Start date
            <input type="date" value={startsAt} onChange={(e) => handleStart(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--ink-400)" }}>
            Due date {overridden ? "(manual)" : "(auto)"}
            <input type="date" value={endsAt} onChange={(e) => handleEnds(e.target.value)} style={inputStyle} />
          </label>
        </div>
        <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--ink-400)" }}>
          Amount paid (₱) — what the tenant paid for this term
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 15000 for a yearly plan"
            style={inputStyle}
          />
        </label>
        {amountInvalid && (
          <div style={{ fontSize: 12, color: "var(--danger)" }}>Enter a valid amount (0 or more).</div>
        )}
        <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--ink-400)" }}>
          Monthly price due (₱) — the tenant's recurring monthly fee
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={`Defaults to the plan price (${formatPesos(tenant.planPriceCents)})`}
            style={inputStyle}
          />
        </label>
        {priceInvalid && (
          <div style={{ fontSize: 12, color: "var(--danger)" }}>Enter a valid price (0 or more).</div>
        )}
        {tenant.status === "trial" && (
          <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
            This tenant is on a trial — the window activates once they move to a paid plan.
          </div>
        )}
        {dueBeforeStart && (
          <div style={{ fontSize: 12, color: "var(--danger)" }}>The due date must be after the start date.</div>
        )}
        {err && <div style={{ fontSize: 12, color: "var(--danger)" }}>{err}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-sm" onClick={save} disabled={pending || !canSave}>
            {pending ? "Saving…" : hasWindow ? "Update window" : "Set window"}
          </button>
          {hasWindow && (
            <button type="button" className="btn btn-sm" onClick={clear} disabled={pending}>
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
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
                      <div style={{ fontSize: 10.5, fontWeight: 600, marginTop: 4 }}>₱{[89, 119, 64][i]}.00</div>
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
                  {formatPesos(o.totalCents)}
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

/** ISO string → "Aug 10, 2026 · 3:42 PM" for the payment drawer. */
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function BillingPanel({ tenant }: { tenant: TenantDetail }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const payments = tenant.subscriptionPayments;
  // Lifetime metrics come from the server, computed over the WHOLE ledger — the
  // `payments` array here is only the capped display slice.
  const summary = tenant.subscriptionPaymentSummary;
  const selected = payments.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="grid-2">
      <div className="col" style={{ gap: 16, minWidth: 0 }}>
        <SubscriptionWindowCard tenant={tenant} />
        <InvoiceHistoryCard payments={payments} selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      <div className="col" style={{ gap: 16 }}>
        <LifetimeMetricsCard tenant={tenant} summary={summary} />
      </div>

      {selected && <PaymentReviewDrawer key={selected.id} payment={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function InvoiceHistoryCard({
  payments,
  selectedId,
  onSelect,
}: {
  payments: TenantSubscriptionPayment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">Invoice history</h3>
          <div className="card-sub">Click an invoice to review its payment proof.</div>
        </div>
      </div>
      {payments.length === 0 ? (
        <div style={{ padding: 28, textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>
          No subscription payments filed yet. The tenant submits proof of payment from their store admin&apos;s Billing view.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Filed</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr
                key={p.id}
                onClick={() => onSelect(p.id)}
                style={{ cursor: "pointer", background: p.id === selectedId ? "var(--bg-canvas)" : undefined }}
              >
                <td className="mono" style={{ fontSize: 12.5, fontWeight: 500 }}>
                  {p.invoiceCode}
                </td>
                <td className="muted">{subEndLabel(p.submittedAt)}</td>
                <td className="tnum" style={{ textAlign: "right", fontWeight: 500 }}>
                  {formatPesos(p.amountCents, { decimals: true })}
                </td>
                <td>
                  <span className={"badge badge-" + SUBSCRIPTION_PAYMENT_STATUS_TONE[p.status]}>
                    <span className="bdot" />
                    {SUBSCRIPTION_PAYMENT_STATUS_LABELS[p.status]}
                  </span>
                </td>
                <td style={{ textAlign: "right", color: "var(--ink-300)" }}>
                  <Ic.ChevronRight style={{ width: 14, height: 14 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function LifetimeMetricsCard({
  tenant,
  summary,
}: {
  tenant: TenantDetail;
  summary: ReturnType<typeof summarizeSubscriptionPayments>;
}) {
  const rows: { color: string; label: string; value: React.ReactNode }[] = [
    { color: "var(--success)", label: "Confirmed payments", value: summary.confirmedCount },
    { color: "var(--warn, #b45309)", label: "Awaiting confirmation", value: summary.pendingCount },
    { color: "var(--danger)", label: "Failed payments", value: summary.failedCount },
    { color: "var(--ink-300)", label: "Store orders", value: tenant.orders.toLocaleString() },
  ];
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">Lifetime metrics</h3>
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 18, padding: 20 }}>
        <div>
          <div style={{ fontSize: 12.5, color: "var(--ink-400)" }}>Subscription revenue</div>
          <div className="tnum" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>
            {formatPesos(summary.lifetimeConfirmedCents)}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-400)" }}>from {summary.confirmedCount} confirmed payment{summary.confirmedCount === 1 ? "" : "s"}</div>
        </div>

        <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", background: "var(--bg-canvas)" }}>
          <span style={{ width: `${summary.paidPct}%`, background: "var(--success)" }} />
          <span style={{ width: `${summary.pendingPct}%`, background: "var(--warn, #f59e0b)" }} />
        </div>

        <div>
          {rows.map((r, i) => (
            <div
              key={r.label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 0",
                borderBottom: i < rows.length - 1 ? "1px solid var(--border-soft)" : "none",
                fontSize: 13,
              }}
            >
              <span className="row" style={{ gap: 8, color: "var(--ink-700)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: r.color }} />
                {r.label}
              </span>
              <span className="tnum" style={{ fontWeight: 600 }}>
                {r.value}
              </span>
            </div>
          ))}
        </div>

        <div style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-soft)", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: "var(--ink-400)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
            Avg. per confirmed payment
          </div>
          <div className="tnum" style={{ fontSize: 19, fontWeight: 700, marginTop: 4 }}>
            {formatPesos(summary.avgMonthlyCents)}
          </div>
        </div>
      </div>
    </div>
  );
}

function PaymentReviewDrawer({ payment, onClose }: { payment: TenantSubscriptionPayment; onClose: () => void }) {
  const { showToast } = useAdminUI();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [zoomed, setZoomed] = useState(false);
  const tone = SUBSCRIPTION_PAYMENT_STATUS_TONE[payment.status];

  const review = (action: "confirm" | "reject") =>
    startTransition(async () => {
      const fn = action === "confirm" ? confirmSubscriptionPaymentAction : rejectSubscriptionPaymentAction;
      const res = await fn(payment.id);
      if ("error" in res) showToast(res.error);
      else {
        showToast(action === "confirm" ? "Payment confirmed." : "Payment marked as failed.");
        router.refresh();
        onClose();
      }
    });

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", zIndex: 40 }}
      />
      <aside
        role="dialog"
        aria-label={`Review payment ${payment.invoiceCode}`}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(440px, 100vw)",
          background: "var(--bg-surface, #fff)",
          zIndex: 50,
          boxShadow: "-12px 0 40px rgba(15,23,42,0.15)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="card-head" style={{ borderBottom: "1px solid var(--border-soft)" }}>
          <div>
            <div className="mono" style={{ fontSize: 16, fontWeight: 700 }}>
              {payment.invoiceCode}
            </div>
            <div className="card-sub">
              Filed {subEndLabel(payment.submittedAt)} · {formatPesos(payment.amountCents, { decimals: true })}
            </div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
            <Ic.X />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-500)", marginBottom: 8 }}>Payment screenshot</div>
            {payment.proofUrl ? (
              <button
                type="button"
                onClick={() => setZoomed(true)}
                style={{ display: "block", width: "100%", padding: 0, border: "1px solid var(--border-soft)", borderRadius: 12, overflow: "hidden", cursor: "zoom-in", background: "var(--bg-canvas)" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={payment.proofUrl} alt="Payment proof" style={{ display: "block", width: "100%", maxHeight: 320, objectFit: "cover" }} />
              </button>
            ) : (
              <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: 24, textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>
                No screenshot uploaded — the tenant filed this payment without a proof image.
              </div>
            )}
          </div>

          <div style={{ border: "1px solid var(--border-soft)", borderRadius: 12, overflow: "hidden" }}>
            <DrawerRow k="Paid on" v={fmtDateTime(payment.paidAt)} />
            <DrawerRow k="Method" v={payment.method} />
            <DrawerRow k="Reference" v={payment.reference ? <span className="mono">{payment.reference}</span> : "—"} />
            <DrawerRow
              k="Status"
              last
              v={
                <span className={"badge badge-" + tone}>
                  <span className="bdot" />
                  {SUBSCRIPTION_PAYMENT_STATUS_LABELS[payment.status]}
                </span>
              }
            />
          </div>
        </div>

        <div style={{ padding: 18, borderTop: "1px solid var(--border-soft)", display: "flex", flexDirection: "column", gap: 10 }}>
          {payment.status === "confirmed" && (
            <div style={{ background: "var(--success-soft, #f0fdf4)", border: "1px solid var(--success)", color: "var(--success)", borderRadius: 10, padding: 12, fontSize: 13.5, fontWeight: 600, textAlign: "center" }}>
              ✓ Payment confirmed
            </div>
          )}
          {payment.status === "failed" && (
            <div style={{ background: "var(--danger-soft, #fef2f2)", border: "1px solid var(--danger)", color: "var(--danger)", borderRadius: 10, padding: 12, fontSize: 13.5, fontWeight: 600, textAlign: "center" }}>
              Payment marked as failed
            </div>
          )}
          {canConfirm(payment.status) && (
            <button className="btn btn-accent" style={{ justifyContent: "center", width: "100%" }} onClick={() => review("confirm")} disabled={pending}>
              <Ic.Check /> {payment.status === "failed" ? "Re-confirm as paid" : "Confirm payment received"}
            </button>
          )}
          {canReject(payment.status) && (
            <button className="btn" style={{ justifyContent: "center", width: "100%", color: "var(--danger)" }} onClick={() => review("reject")} disabled={pending}>
              Mark as failed
            </button>
          )}
        </div>
      </aside>

      {zoomed && payment.proofUrl && (
        <div
          onClick={() => setZoomed(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(4,7,15,0.85)", zIndex: 60, display: "grid", placeItems: "center", padding: 24, cursor: "zoom-out" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={payment.proofUrl} alt="Payment proof" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />
        </div>
      )}
    </>
  );
}

function DrawerRow({ k, v, last }: { k: string; v: React.ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "11px 14px",
        borderBottom: last ? "none" : "1px solid var(--border-soft)",
        fontSize: 13.5,
        gap: 12,
      }}
    >
      <span style={{ color: "var(--ink-500)" }}>{k}</span>
      <span style={{ color: "var(--ink-900)", fontWeight: 500, textAlign: "right" }}>{v}</span>
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
