"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ic } from "@/components/admin/shell/primitives";
import type { OnboardingSummary } from "@/lib/admin/onboarding-types";
import { ONBOARDING_STATUS_LABELS } from "@/lib/admin/onboarding-types";

/* ── helpers ── */

function humanDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const STATUS_BADGE: Record<string, string> = {
  payment_received: "badge-warn",
  tenant_created: "badge-info",
  customizing: "badge-accent",
  revision: "badge-warn",
  completed: "badge-success",
};

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "payment_received", label: "Payment Received" },
  { id: "tenant_created", label: "Tenant Created" },
  { id: "customizing", label: "Customizing" },
  { id: "revision", label: "Revision" },
  { id: "completed", label: "Completed" },
];

/* ── component ── */

export function OnboardingList({ submissions }: { submissions: OnboardingSummary[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");

  const filtered = submissions
    .filter((s) => filter === "all" || s.setupStatus === filter)
    .filter(
      (s) =>
        !q ||
        s.businessName.toLowerCase().includes(q.toLowerCase()) ||
        s.email.toLowerCase().includes(q.toLowerCase()) ||
        // Digits-only compare so "0917 123 4567" finds "639171234567". Guarded
        // on the query having digits — otherwise every row would match "".
        (/\d/.test(q) && s.whatsapp.replace(/\D/g, "").includes(q.replace(/\D/g, ""))) ||
        s.contactPerson.toLowerCase().includes(q.toLowerCase()),
    );

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Onboarding</h1>
          <p className="page-sub">
            <span className="tnum">{filtered.length}</span> of{" "}
            <span className="tnum">{submissions.length}</span> sign-ups ·{" "}
            <span className="tnum">{submissions.filter((s) => s.setupStatus !== "completed").length}</span> pending
          </p>
        </div>
      </div>

      {/* Status tabs */}
      <div className="tabs" style={{ marginBottom: 16 }}>
        {STATUS_FILTERS.map((sf) => {
          const count =
            sf.id === "all"
              ? submissions.length
              : submissions.filter((s) => s.setupStatus === sf.id).length;
          return (
            <div
              key={sf.id}
              className={"tab" + (filter === sf.id ? " active" : "")}
              onClick={() => setFilter(sf.id)}
            >
              {sf.label}
              <span className="tab-count tnum">{count}</span>
            </div>
          );
        })}
      </div>

      {/* Search row */}
      <div className="row mb-3" style={{ gap: 8 }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
          <Ic.Search
            style={{ position: "absolute", left: 10, top: 9, width: 14, height: 14, color: "var(--ink-400)" }}
          />
          <input
            className="input"
            placeholder="Search by business, email, contact…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ paddingLeft: 32, height: 32 }}
            aria-label="Search submissions"
          />
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={() => router.refresh()}>
          <Ic.Refresh /> Refresh
        </button>
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: "visible" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Business</th>
              <th>Package</th>
              <th>Setup status</th>
              <th>Store</th>
              <th style={{ textAlign: "right" }}>Products</th>
              <th>Proof</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div
                    style={{
                      padding: "48px 16px",
                      textAlign: "center",
                      color: "var(--ink-400)",
                    }}
                  >
                    {submissions.length === 0 ? (
                      <>
                        <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: "var(--ink-500)",
                            marginBottom: 4,
                          }}
                        >
                          No sign-ups yet
                        </div>
                        <div style={{ fontSize: 12.5 }}>
                          Self-serve onboarding submissions will appear here.
                        </div>
                      </>
                    ) : (
                      <>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: "var(--ink-500)",
                            marginBottom: 4,
                          }}
                        >
                          No submissions match these filters
                        </div>
                        <div style={{ fontSize: 12.5 }}>Try clearing your search or status filter.</div>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )}
            {filtered.map((s) => {
              const statusCls = STATUS_BADGE[s.setupStatus] ?? "badge-neutral";
              const packageCls =
                s.packageKey === "enterprise"
                  ? "badge-accent"
                  : s.packageKey === "pro"
                    ? "badge-info"
                    : "badge-neutral";
              return (
                <tr key={s.id} onClick={() => router.push(`/onboarding/${s.id}`)}>
                  <td>
                    <div className="tenant-cell">
                      <BusinessAvatar name={s.businessName} />
                      <div>
                        <div className="tenant-name">{s.businessName}</div>
                        <div className="tenant-domain">{s.whatsapp || s.email || "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      className={"badge " + packageCls}
                      title={
                        s.trial && s.trialStartsAt && s.trialEndsAt
                          ? `Trial ${humanDate(s.trialStartsAt)} → ${humanDate(s.trialEndsAt)}`
                          : undefined
                      }
                    >
                      {s.packageLabel}
                      {s.trial && " · Trial"}
                    </span>
                  </td>
                  <td>
                    <span className={"badge " + statusCls}>
                      <span className="bdot" />
                      {s.setupStatusLabel}
                    </span>
                  </td>
                  <td>
                    {s.published ? (
                      <span className="badge badge-success">
                        <span className="bdot" />
                        Live
                      </span>
                    ) : (
                      <span className="badge badge-neutral">
                        <span className="bdot" />
                        Hidden
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }} className="tnum muted">
                    {s.productCount}
                  </td>
                  <td>
                    {s.paymentProofUrl ? (
                      <span className="badge badge-success">
                        <Ic.CheckCircle style={{ width: 10, height: 10 }} /> Attached
                      </span>
                    ) : (
                      <span className="badge badge-neutral muted">None</span>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 12.5 }}>
                    {humanDate(s.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            borderTop: "1px solid var(--border-soft)",
          }}
        >
          <div style={{ fontSize: 12.5, color: "var(--ink-400)" }}>
            Showing <span className="tnum">{filtered.length === 0 ? 0 : 1}</span>–
            <span className="tnum">{filtered.length}</span> of{" "}
            <span className="tnum">{submissions.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Small gradient avatar for a business name — reuses the same palette/hash as TenantAvatar */
const BIZ_COLORS: [string, string][] = [
  ["#2f62f5", "#1b3fa8"],
  ["#16a34a", "#0e7a36"],
  ["#d97706", "#9a5709"],
  ["#7c3aed", "#5b21b6"],
  ["#dc2626", "#991b1b"],
  ["#0891b2", "#155e75"],
  ["#db2777", "#9d174d"],
  ["#65a30d", "#3f6212"],
];
function bizColor(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return BIZ_COLORS[h % BIZ_COLORS.length];
}
function bizInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function BusinessAvatar({ name }: { name: string }) {
  const [c1, c2] = bizColor(name);
  return (
    <div
      className="tenant-avatar"
      style={{
        width: 32,
        height: 32,
        background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
        fontSize: 11,
        borderRadius: 8,
      }}
    >
      {bizInitials(name)}
    </div>
  );
}
