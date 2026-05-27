import { Check, DollarSign, CreditCard, TrendingUp } from "lucide-react";
import { requirePlatformUser } from "@/lib/auth/session";
import { getPlanDistribution } from "@/lib/admin/data";
import { PLAN_CARDS, formatPesos, formatPesosCompact } from "@/lib/admin/plans";

export const dynamic = "force-dynamic";

const money = formatPesosCompact;

export default async function PlansBillingPage() {
  await requirePlatformUser();
  const { rows, mrrCents, arrCents, activeCount } = await getPlanDistribution();
  const totalTenants = rows.reduce((s, r) => s + r.count, 0);

  const kpis = [
    { label: "MRR", value: money(mrrCents), icon: DollarSign },
    { label: "ARR", value: money(arrCents), icon: TrendingUp },
    { label: "Active subscriptions", value: activeCount.toLocaleString(), icon: CreditCard },
  ];

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Plans &amp; Billing</h1>
          <p className="page-sub">Subscription mix and recurring revenue across {totalTenants} tenants</p>
        </div>
      </div>

      <div className="grid-3 mb-4">
        {kpis.map((k) => (
          <div key={k.label} className="kpi">
            <div className="kpi-label">
              <k.icon /> {k.label}
            </div>
            <div className="kpi-value">{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }} className="grid-3">
        {PLAN_CARDS.map((p) => {
          const row = rows.find((r) => r.key === p.key);
          const share = totalTenants && row ? Math.round((row.count / totalTenants) * 100) : 0;
          return (
            <div key={p.key} className="card">
              <div className="card-body">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="plan-name" style={{ fontSize: 15 }}>
                    {p.name}
                  </div>
                  {"tag" in p && p.tag && <span className="badge badge-accent">{p.tag}</span>}
                </div>
                <div className="plan-price" style={{ fontSize: 24 }}>
                  {formatPesos(p.priceCents)}
                  <small>/mo</small>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 6, lineHeight: 1.4 }}>{p.blurb}</div>
                <div className="divider" />
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {row?.count ?? 0} tenants · {money(row?.mrrCents ?? 0)} MRR
                  </span>
                  <span className="tnum muted" style={{ fontSize: 12.5 }}>
                    {share}%
                  </span>
                </div>
                <div className="bar mb-3">
                  <span style={{ width: share + "%" }} />
                </div>
                <div className="plan-feats">
                  {p.feats.map((f, i) => (
                    <div key={i} className="plan-feat">
                      <Check /> {f}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
