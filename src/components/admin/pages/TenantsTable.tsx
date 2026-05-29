"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ic, StatusBadge, TenantAvatar } from "@/components/admin/shell/primitives";
import { useAdminUI } from "@/components/admin/shell/AdminShell";
import { planMeta } from "@/lib/admin/plans";
import { suspendTenantAction, deleteTenantAction } from "@/actions/admin";
import type { AdminTenantRow } from "@/lib/admin/data";

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "trial", label: "Trial" },
  { id: "suspended", label: "Suspended" },
  { id: "past_due", label: "Past due" },
];

type SortKey = "name" | "revenueCents" | "orders" | "createdAt";

export function TenantsTable({ tenants }: { tenants: AdminTenantRow[] }) {
  const router = useRouter();
  const { openCreate, showToast } = useAdminUI();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "revenueCents", dir: "desc" });
  const [menu, setMenu] = useState<string | null>(null);

  const filtered = tenants
    .filter((t) => (filter === "all" ? true : t.status === filter))
    .filter((t) => (planFilter === "all" ? true : planMeta(t.planKey).key === planFilter))
    .filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.slug.includes(q.toLowerCase()))
    .sort((a, b) => {
      const k = sort.key;
      const d = sort.dir === "asc" ? 1 : -1;
      const av = a[k];
      const bv = b[k];
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * d;
      return ((Number(av) || 0) - (Number(bv) || 0)) * d;
    });

  const sortHandle = (key: SortKey) => () =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  const sortMark = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : "");

  const totalRevenue = filtered.reduce((s, t) => s + t.revenueCents, 0);
  const totalOrders = filtered.reduce((s, t) => s + t.orders, 0);

  const suspend = (slug: string) => {
    setMenu(null);
    startTransition(async () => {
      const res = await suspendTenantAction(slug);
      if ("error" in res) showToast(res.error);
      else {
        showToast(`Tenant ${res.status === "suspended" ? "suspended" : "reactivated"}`);
        router.refresh();
      }
    });
  };
  const remove = (slug: string, name: string) => {
    setMenu(null);
    if (!window.confirm(`Delete "${name}"? This permanently removes the tenant and all its data.`)) return;
    startTransition(async () => {
      const res = await deleteTenantAction(slug);
      if ("error" in res) showToast(res.error);
      else {
        showToast("Tenant deleted");
        router.refresh();
      }
    });
  };

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Tenants</h1>
          <p className="page-sub">
            <span className="tnum">{filtered.length}</span> of <span className="tnum">{tenants.length}</span> tenants · ${(totalRevenue / 100 / 1000).toFixed(1)}k revenue ·{" "}
            {totalOrders.toLocaleString()} orders
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-accent btn-sm" onClick={openCreate}>
            <Ic.Plus /> New tenant
          </button>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        {STATUS_FILTERS.map((s) => {
          const count = s.id === "all" ? tenants.length : tenants.filter((t) => t.status === s.id).length;
          return (
            <div key={s.id} className={"tab" + (filter === s.id ? " active" : "")} onClick={() => setFilter(s.id)}>
              {s.label}
              <span className="tab-count tnum">{count}</span>
            </div>
          );
        })}
      </div>

      <div className="row mb-3" style={{ gap: 8 }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
          <Ic.Search style={{ position: "absolute", left: 10, top: 9, width: 14, height: 14, color: "var(--ink-400)" }} />
          <input className="input" placeholder="Search by name or subdomain…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 32, height: 32 }} />
        </div>
        <select className="input" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} style={{ width: 160, height: 32, fontSize: 13 }}>
          <option value="all">All plans</option>
          <option value="starter">Starter</option>
          <option value="pro">Professional</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={() => router.refresh()} disabled={pending}>
          <Ic.Refresh /> Refresh
        </button>
      </div>

      <div className="card" style={{ overflow: "visible" }}>
        <table className="table">
          <thead>
            <tr>
              <th onClick={sortHandle("name")} style={{ cursor: "pointer" }}>
                Business{sortMark("name")}
              </th>
              <th>Plan</th>
              <th>Status</th>
              <th>Active features</th>
              <th onClick={sortHandle("revenueCents")} style={{ cursor: "pointer", textAlign: "right" }}>
                Revenue{sortMark("revenueCents")}
              </th>
              <th onClick={sortHandle("orders")} style={{ cursor: "pointer", textAlign: "right" }}>
                Orders{sortMark("orders")}
              </th>
              <th onClick={sortHandle("createdAt")} style={{ cursor: "pointer" }}>
                Created{sortMark("createdAt")}
              </th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--ink-400)" }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-500)", marginBottom: 4 }}>No tenants match these filters</div>
                    <div style={{ fontSize: 12.5 }}>Try clearing your search or status.</div>
                  </div>
                </td>
              </tr>
            )}
            {filtered.map((t) => {
              const pm = planMeta(t.planKey);
              const planCls = pm.key === "enterprise" ? "badge-accent" : pm.key === "pro" ? "badge-info" : "badge-neutral";
              return (
                <tr key={t.id} onClick={() => router.push(`/tenants/${t.slug}`)}>
                  <td>
                    <div className="tenant-cell">
                      <TenantAvatar name={t.name} logoUrl={t.logoUrl} />
                      <div>
                        <div className="tenant-name">{t.name}</div>
                        <div className="tenant-domain">{t.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={"badge " + planCls}>{pm.label}</span>
                  </td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                  <td>
                    <span className="tag">
                      <Ic.Layers style={{ width: 11, height: 11 }} /> {t.features} enabled
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }} className="tnum">
                    ${(t.revenueCents / 100 / 1000).toFixed(1)}k
                  </td>
                  <td style={{ textAlign: "right" }} className="tnum muted">
                    {t.orders.toLocaleString()}
                  </td>
                  <td className="muted" style={{ fontSize: 12.5 }}>
                    {t.createdAt}
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ position: "relative" }}>
                    <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setMenu(menu === t.id ? null : t.id)}>
                      <Ic.Dots />
                    </button>
                    {menu === t.id && (
                      <>
                        <div style={{ position: "fixed", inset: 0, zIndex: 9 }} onClick={() => setMenu(null)} />
                        <div
                          style={{
                            position: "absolute",
                            right: 8,
                            top: 32,
                            background: "var(--bg)",
                            border: "1px solid var(--border-c)",
                            borderRadius: 10,
                            boxShadow: "var(--shadow-lg)",
                            padding: 4,
                            minWidth: 200,
                            zIndex: 10,
                          }}
                        >
                          <MenuLink icon="Eye" label="View tenant" href={`/tenants/${t.slug}`} />
                          <MenuLink icon="Edit" label="Edit settings" href={`/tenants/${t.slug}/settings`} />
                          <MenuLink icon="Layers" label="Manage features" href={`/tenants/${t.slug}/features`} />
                          <MenuLink icon="Image" label="Branding" href={`/tenants/${t.slug}/branding`} />
                          <div style={{ height: 1, background: "var(--border-soft)", margin: "4px 2px" }} />
                          <MenuButton icon="Lock" label={t.status === "suspended" ? "Reactivate" : "Suspend"} onClick={() => suspend(t.slug)} />
                          <MenuButton icon="Trash" label="Delete tenant" danger onClick={() => remove(t.slug, t.name)} />
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderTop: "1px solid var(--border-soft)" }}>
          <div style={{ fontSize: 12.5, color: "var(--ink-400)" }}>
            Showing <span className="tnum">{filtered.length === 0 ? 0 : 1}</span>–<span className="tnum">{filtered.length}</span> of <span className="tnum">{tenants.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MenuLink({ icon, label, href }: { icon: string; label: string; href: string }) {
  const IconCmp = Ic[icon];
  return (
    <Link href={href} className="row" style={{ padding: "7px 9px", borderRadius: 6, fontSize: 13, color: "var(--ink-700)", gap: 8 }}>
      <IconCmp style={{ width: 14, height: 14 }} />
      <span>{label}</span>
    </Link>
  );
}

function MenuButton({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  const IconCmp = Ic[icon];
  return (
    <div
      onClick={onClick}
      className="row"
      style={{ padding: "7px 9px", borderRadius: 6, fontSize: 13, cursor: "pointer", gap: 8, color: danger ? "var(--danger)" : "var(--ink-700)" }}
    >
      <IconCmp style={{ width: 14, height: 14 }} />
      <span>{label}</span>
    </div>
  );
}
