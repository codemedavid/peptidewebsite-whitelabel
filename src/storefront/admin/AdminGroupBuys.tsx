"use client";

// Group Buy Management — the store admin's manager for buying windows: list,
// create/edit, duplicate, archive and the per-run supplier report. Every action
// button is shown only when the matching groupbuy.* capability is granted
// (brand.groupBuyCaps, derived server-side), and the server actions re-check the
// same entitlements, so hiding here is UX — not the security boundary.

import { useEffect, useMemo, useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import {
  effectiveGroupBuyStatus,
  GROUP_BUY_CAPS_OFF,
  GROUP_BUY_SETTINGS_DEFAULTS,
  type GroupBuy,
  type GroupBuyCapabilities,
  type GroupBuySettings,
  type GroupBuyStatus,
  type SupplierReport,
} from "@/lib/storefront/group-buy";
import {
  listGroupBuysAction,
  saveGroupBuyAction,
  duplicateGroupBuyAction,
  setGroupBuyArchivedAction,
  getGroupBuySupplierReportAction,
  saveGroupBuyAllowOnHandAction,
  type GroupBuyCustomerLine,
} from "@/actions/group-buys";
import { downloadSupplierWorkbook } from "@/storefront/admin/supplier-workbook";
import type { ReportPrep } from "@/lib/storefront/group-buy-report";

// ── helpers ──────────────────────────────────────────────────────────────────

/** ISO ⇄ <input type="datetime-local"> value (which is timezone-naive). */
function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const STATUS_TINT: Record<GroupBuyStatus, string> = {
  draft: "orange",
  scheduled: "cyan",
  active: "green",
  closed: "yellow",
  archived: "red",
};

function StatusChip({ status }: { status: GroupBuyStatus }) {
  return (
    <span className="admin-cat__count" data-tint={STATUS_TINT[status]} style={{ textTransform: "capitalize" }}>
      {status}
    </span>
  );
}

// ── Edit / create modal ───────────────────────────────────────────────────────

function GroupBuyModal({
  initial,
  caps,
  settings,
  busy,
  error,
  onCancel,
  onSave,
}: {
  initial: GroupBuy | null; // null = new
  caps: GroupBuyCapabilities;
  settings: GroupBuySettings;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (gb: Partial<GroupBuy>) => void;
}) {
  const { products } = useStore();
  const isNew = !initial;

  // Prefill a new run from the tenant's defaults (Features page → Group Buy
  // Settings): status, window = now → now + duration, delivery ETA.
  const seed = useMemo(() => {
    if (initial) return initial;
    const startsAt =
      settings.defaultStatus === "draft" ? null : new Date().toISOString();
    const endsAt = startsAt
      ? new Date(Date.now() + settings.defaultDurationDays * 86_400_000).toISOString()
      : null;
    return {
      id: "",
      name: "",
      description: "",
      status: (settings.defaultStatus === "scheduled" && !caps.scheduled
        ? "draft"
        : settings.defaultStatus) as GroupBuyStatus,
      startsAt,
      endsAt,
      deliveryEta: settings.defaultDeliveryEta,
      productIds: [] as string[],
      createdAt: "",
      updatedAt: "",
    };
  }, [initial, settings, caps.scheduled]);

  const [name, setName] = useState(seed.name);
  const [description, setDescription] = useState(seed.description);
  const [status, setStatus] = useState<GroupBuyStatus>(seed.status);
  const [startsAt, setStartsAt] = useState(isoToLocal(seed.startsAt));
  const [endsAt, setEndsAt] = useState(isoToLocal(seed.endsAt));
  const [deliveryEta, setDeliveryEta] = useState(seed.deliveryEta);
  const [productIds, setProductIds] = useState<string[]>(seed.productIds);

  const statusOptions: GroupBuyStatus[] = caps.scheduled
    ? ["draft", "scheduled", "active", "closed"]
    : ["draft", "active", "closed"];

  const toggleProduct = (id: string) =>
    setProductIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div className="admin-modal" onClick={onCancel}>
      <div
        className="admin-modal__card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "86vh", overflowY: "auto" }}
      >
        <h2 className="admin-modal__title">{isNew ? "New Group Buy" : "Edit Group Buy"}</h2>

        <div className="admin-modal__row">
          <label className="admin-field__label">
            Name<span className="req" style={{ color: "var(--brand-accent)" }}>*</span>
          </label>
          <input
            className="admin-input"
            value={name}
            placeholder="e.g., June Group Buy"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Description</label>
          <textarea
            className="admin-input"
            rows={2}
            value={description}
            placeholder="Optional note shown only to you"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Status</label>
          <select
            className="admin-input"
            value={status}
            onChange={(e) => setStatus(e.target.value as GroupBuyStatus)}
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          {status === "scheduled" && (
            <div className="admin-field__hint">
              Goes live automatically once the start date passes.
            </div>
          )}
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Starts</label>
          <input
            className="admin-input"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Ends</label>
          <input
            className="admin-input"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
          <div className="admin-field__hint">
            Orders placed inside the window are attributed to this group buy. Leave
            blank to close it manually.
          </div>
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Delivery ETA</label>
          <input
            className="admin-input"
            value={deliveryEta}
            placeholder={GROUP_BUY_SETTINGS_DEFAULTS.defaultDeliveryEta}
            onChange={(e) => setDeliveryEta(e.target.value)}
          />
        </div>

        {caps.productAssignment && (
          <div className="admin-modal__row">
            <label className="admin-field__label">Products</label>
            <div className="admin-field__hint" style={{ marginBottom: 6 }}>
              {productIds.length === 0
                ? "No selection — the group buy covers the whole catalog."
                : `${productIds.length} product${productIds.length === 1 ? "" : "s"} assigned.`}
            </div>
            <div
              style={{
                maxHeight: 180,
                overflowY: "auto",
                display: "grid",
                gap: 4,
                border: "1px solid var(--brand-border, rgba(0,0,0,.12))",
                borderRadius: 8,
                padding: 8,
              }}
            >
              {products.map((p) => (
                <label key={p.id} className="admin-check">
                  <input
                    type="checkbox"
                    checked={productIds.includes(p.id)}
                    onChange={() => toggleProduct(p.id)}
                  />
                  <span>{p.name}</span>
                </label>
              ))}
              {products.length === 0 && (
                <span className="admin-field__hint">No products yet.</span>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="admin-modal__row" role="alert" style={{ color: "#d33", fontSize: 13 }}>
            {error}
          </div>
        )}

        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="admin-btn"
            disabled={busy || !name.trim()}
            onClick={() =>
              onSave({
                id: initial?.id ?? "",
                name,
                description,
                status,
                startsAt: localToIso(startsAt),
                endsAt: localToIso(endsAt),
                deliveryEta,
                productIds,
              })
            }
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Supplier report modal ─────────────────────────────────────────────────────

function ReportModal({
  groupBuy,
  caps,
  currency,
  onClose,
}: {
  groupBuy: GroupBuy;
  caps: GroupBuyCapabilities;
  currency: string;
  onClose: () => void;
}) {
  const [report, setReport] = useState<SupplierReport | null>(null);
  const [customers, setCustomers] = useState<GroupBuyCustomerLine[] | null>(null);
  const [prep, setPrep] = useState<ReportPrep | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getGroupBuySupplierReportAction(groupBuy.id).then((res) => {
      if (!alive) return;
      if ("error" in res) setError(res.error);
      else {
        setReport(res.report);
        setCustomers(res.customers);
        setPrep(res.prep);
      }
    });
    return () => {
      alive = false;
    };
  }, [groupBuy.id]);

  const money = (n: number) => `${currency}${n.toLocaleString()}`;

  const fileStem = `group-buy-${groupBuy.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-report`;

  /** Shared HTML table markup for the Excel (.xls) and PDF (print) exports. */
  const reportHtml = (): string => {
    if (!report) return "";
    const esc = (v: string | number) =>
      String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const supplierRows = report.lines
      .map(
        (l) =>
          `<tr><td>${esc(l.name)}</td><td style="text-align:right">${l.qty}</td><td style="text-align:right">${esc(
            money(l.revenue),
          )}</td></tr>`,
      )
      .join("");
    const supplierTable = `
      <h3>Supplier order list</h3>
      <table>
        <thead><tr><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Revenue</th></tr></thead>
        <tbody>${supplierRows}
          <tr style="font-weight:bold;border-top:2px solid #000">
            <td>TOTAL</td><td style="text-align:right">${report.totalQty}</td><td style="text-align:right">${esc(
              money(report.totalRevenue),
            )}</td>
          </tr>
        </tbody>
      </table>`;
    const customerTable =
      customers && customers.length
        ? `
      <h3>Per customer</h3>
      <table>
        <thead><tr><th>Customer</th><th>Email</th><th style="text-align:right">Orders</th><th style="text-align:right">Qty</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${customers
          .map(
            (c) =>
              `<tr><td>${esc(c.name)}</td><td>${esc(c.email)}</td><td style="text-align:right">${c.orders}</td><td style="text-align:right">${c.qty}</td><td style="text-align:right">${esc(
                money(c.total),
              )}</td></tr>`,
          )
          .join("")}</tbody>
      </table>`
        : "";
    return `
      <h1>Supplier Report — ${esc(groupBuy.name)}</h1>
      <p>${report.orderCount} order(s) · ${report.totalQty} units · ${esc(money(report.totalRevenue))} in items</p>
      ${supplierTable}
      ${customerTable}`;
  };

  const downloadExcel = async () => {
    if (!prep) return;
    // Real 3-sheet .xlsx (Totals / Product Summary / Orders). exceljs is lazy-
    // loaded inside downloadSupplierWorkbook so it never enters the storefront
    // bundle. Data shaping is the unit-tested prepareReport (server-side).
    await downloadSupplierWorkbook(prep);
  };

  const downloadPdf = () => {
    if (!report) return;
    // No PDF library: open the report in a print window and let the browser's
    // "Save as PDF" handle it (same approach as the Sales Analytics PDF export).
    const w = window.open("", "_blank", "width=800,height=600");
    if (!w) return;
    w.document.write(
      `<html><head><title>${fileStem}</title><style>
        body{font:14px/1.5 system-ui,sans-serif;padding:32px;color:#111}
        h1{font-size:20px;margin:0 0 4px} h3{margin:24px 0 8px}
        table{border-collapse:collapse;width:100%} td,th{border:1px solid #ccc;padding:6px 10px;text-align:left}
      </style></head><body>${reportHtml()}</body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

  const downloadCsv = () => {
    if (!report) return;
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [
      ["Product", "Quantity", "Revenue"],
      ...report.lines.map((l) => [l.name, l.qty, l.revenue]),
      ["TOTAL", report.totalQty, report.totalRevenue],
    ];
    if (customers && customers.length) {
      rows.push([], ["Customer", "Orders", "Quantity"], ...customers.map((c) => [
        c.email ? `${c.name} <${c.email}>` : c.name,
        c.orders,
        c.qty,
      ]));
    }
    const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], {
      type: "text/csv",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `group-buy-${groupBuy.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-report.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="admin-modal" onClick={onClose}>
      <div
        className="admin-modal__card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "86vh", overflowY: "auto" }}
      >
        <h2 className="admin-modal__title">Supplier Report — {groupBuy.name}</h2>

        {error && (
          <div className="admin-modal__row" role="alert" style={{ color: "#d33", fontSize: 13 }}>
            {error}
          </div>
        )}
        {!report && !error && <div className="admin-modal__row">Building the report…</div>}

        {report && (
          <>
            <div className="admin-modal__row" style={{ fontSize: 13, opacity: 0.8 }}>
              {report.orderCount} order{report.orderCount === 1 ? "" : "s"} · {report.totalQty}{" "}
              units · {money(report.totalRevenue)} in items
            </div>

            {report.lines.length === 0 ? (
              <div className="admin-empty-set">No orders were placed under this group buy yet.</div>
            ) : (
              <div className="admin-modal__row">
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", opacity: 0.7 }}>
                      <th style={{ padding: "4px 0" }}>Product</th>
                      <th style={{ textAlign: "right" }}>Qty</th>
                      <th style={{ textAlign: "right" }}>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.lines.map((l) => (
                      <tr key={l.productId ?? l.name} style={{ borderTop: "1px solid rgba(0,0,0,.08)" }}>
                        <td style={{ padding: "6px 0" }}>{l.name}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{l.qty}</td>
                        <td style={{ textAlign: "right" }}>{money(l.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {customers && customers.length > 0 && (
              <div className="admin-modal__row">
                <label className="admin-field__label">Per customer</label>
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", opacity: 0.7 }}>
                      <th style={{ padding: "4px 0" }}>Customer</th>
                      <th style={{ textAlign: "right" }}>Orders</th>
                      <th style={{ textAlign: "right" }}>Qty</th>
                      <th style={{ textAlign: "right" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c) => (
                      <tr key={c.email || c.name} style={{ borderTop: "1px solid rgba(0,0,0,.08)" }}>
                        <td style={{ padding: "6px 0" }}>{c.name}</td>
                        <td style={{ textAlign: "right" }}>{c.orders}</td>
                        <td style={{ textAlign: "right" }}>{c.qty}</td>
                        <td style={{ textAlign: "right" }}>{money(c.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <div className="admin-modal__actions">
          {report && report.lines.length > 0 && caps.reports.csv && (
            <button className="admin-btn admin-btn--ghost" onClick={downloadCsv}>
              CSV
            </button>
          )}
          {report && report.lines.length > 0 && caps.reports.excel && (
            <button className="admin-btn admin-btn--ghost" onClick={downloadExcel}>
              Excel
            </button>
          )}
          {report && report.lines.length > 0 && caps.reports.pdf && (
            <button className="admin-btn admin-btn--ghost" onClick={downloadPdf}>
              PDF
            </button>
          )}
          <button className="admin-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AdminGroupBuys ────────────────────────────────────────────────────────────

export function AdminGroupBuys({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { toast } = useStore();
  const caps = brand.groupBuyCaps ?? GROUP_BUY_CAPS_OFF;

  const [groupBuys, setGroupBuys] = useState<GroupBuy[]>([]);
  const [settings, setSettings] = useState<GroupBuySettings>(GROUP_BUY_SETTINGS_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // Store-owner toggle: while a run is live, may customers still buy on-hand
  // (non-group-buy) products? Persisted in branding.config.groupBuyAllowOnHand
  // (default on). Only meaningful with product assignment — otherwise every live
  // run covers the whole catalog, so there are no on-hand products to gate.
  const [allowOnHand, setAllowOnHand] = useState(brand.groupBuyAllowOnHand !== false);
  const [savingOnHand, setSavingOnHand] = useState(false);

  const [editing, setEditing] = useState<GroupBuy | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<GroupBuy | null>(null);

  // Auto report on close (groupbuy.reports.auto_on_close): when the manager
  // opens, surface the supplier report for any run that has effectively just
  // closed. There's no server cron, so "on close" is detected here on the first
  // load after the window lapsed; localStorage dedups so each run pops once.
  const maybeAutoReport = (list: GroupBuy[]) => {
    if (!caps.reports.autoOnClose || !caps.supplierReports) return;
    if (typeof window === "undefined") return;
    const closed = list.find(
      (gb) =>
        gb.status !== "archived" &&
        effectiveGroupBuyStatus(gb, caps.scheduled) === "closed",
    );
    if (!closed) return;
    const seenKey = `gb-autoreport:${closed.id}:${closed.updatedAt}`;
    try {
      if (localStorage.getItem(seenKey)) return;
      localStorage.setItem(seenKey, "1");
    } catch {
      // private mode / storage disabled — fall through and just show it
    }
    setReporting(closed);
  };

  useEffect(() => {
    let alive = true;
    listGroupBuysAction().then((res) => {
      if (!alive) return;
      if ("error" in res) setLoadError(res.error);
      else {
        setGroupBuys(res.groupBuys);
        setSettings(res.settings);
        maybeAutoReport(res.groupBuys);
      }
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = groupBuys.filter((gb) =>
    showArchived ? gb.status === "archived" : gb.status !== "archived",
  );
  const archivedCount = groupBuys.length - groupBuys.filter((g) => g.status !== "archived").length;

  const upsertLocal = (gb: GroupBuy) =>
    setGroupBuys((cur) => {
      const i = cur.findIndex((x) => x.id === gb.id);
      return i < 0 ? [gb, ...cur] : cur.map((x) => (x.id === gb.id ? gb : x));
    });

  const save = async (patch: Partial<GroupBuy>) => {
    setSaving(true);
    setSaveError(null);
    const res = await saveGroupBuyAction(patch);
    setSaving(false);
    if ("error" in res) {
      setSaveError(res.error);
      return;
    }
    upsertLocal(res.groupBuy);
    setEditing(null);
    setCreating(false);
    toast(`Saved "${res.groupBuy.name}"`);
  };

  const duplicate = async (gb: GroupBuy) => {
    const res = await duplicateGroupBuyAction(gb.id);
    if ("error" in res) return toast(res.error);
    upsertLocal(res.groupBuy);
    toast(`Created "${res.groupBuy.name}"`);
  };

  const toggleOnHand = async (next: boolean) => {
    setAllowOnHand(next); // optimistic
    setSavingOnHand(true);
    const res = await saveGroupBuyAllowOnHandAction(next);
    setSavingOnHand(false);
    if ("error" in res) {
      setAllowOnHand(!next); // revert
      return toast(res.error);
    }
    toast(
      next
        ? "On-hand products stay buyable during group buys."
        : "On-hand products are paused while a group buy is live.",
    );
  };

  const setArchived = async (gb: GroupBuy, archived: boolean) => {
    if (archived && !confirm(`Archive "${gb.name}"? Its orders and reports are kept.`)) return;
    const res = await setGroupBuyArchivedAction(gb.id, archived);
    if ("error" in res) return toast(res.error);
    upsertLocal(res.groupBuy);
    toast(archived ? "Archived." : "Restored to draft.");
  };

  return (
    <div className="admin">
      <main className="admin__inner">
        <div className="admin-table__head">
          <h1 className="admin-table__title">
            <a
              className="admin-table__title-back"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onBack();
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Dashboard
            </a>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Group Buys
            </span>
          </h1>
          <span style={{ display: "inline-flex", gap: 8 }}>
            {archivedCount > 0 && (
              <button
                className="admin-btn admin-btn--ghost"
                onClick={() => setShowArchived((v) => !v)}
              >
                {showArchived ? "Back to list" : `Archived (${archivedCount})`}
              </button>
            )}
            {caps.canCreate && !showArchived && (
              <button
                className="admin-btn"
                onClick={() => {
                  setSaveError(null);
                  setCreating(true);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Group Buy
              </button>
            )}
          </span>
        </div>

        {caps.productAssignment && (
          <label
            className="admin-check"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              margin: "4px 0 14px",
              padding: "12px 14px",
              border: "1px solid var(--brand-border, rgba(0,0,0,.12))",
              borderRadius: 10,
            }}
          >
            <input
              type="checkbox"
              checked={allowOnHand}
              disabled={savingOnHand}
              onChange={(e) => toggleOnHand(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              <span style={{ fontWeight: 600 }}>
                Allow on-hand purchases during an active group buy
              </span>
              <span className="admin-field__hint" style={{ display: "block", marginTop: 2 }}>
                When a group buy is live, products that aren’t assigned to it stay on the
                storefront. With this off, customers can only buy the group-buy products —
                everything else shows “Available after group buy” and can’t be added to cart.
              </span>
            </span>
          </label>
        )}

        {!loaded && <div className="admin-empty-set">Loading group buys…</div>}
        {loadError && (
          <div className="admin-empty-set" role="alert">
            {loadError}
          </div>
        )}

        {loaded && !loadError && (
          <div className="admin-ship-list">
            {visible.map((gb) => {
              const eff = effectiveGroupBuyStatus(gb, caps.scheduled);
              return (
                <div key={gb.id} className="admin-ship-row">
                  <div className="admin-ship-row__info">
                    <div className="admin-ship-row__name" style={{ fontWeight: 600 }}>
                      {gb.name} <StatusChip status={eff} />
                    </div>
                    <div className="admin-field__hint">
                      {fmtDate(gb.startsAt)} → {fmtDate(gb.endsAt)}
                      {gb.deliveryEta ? ` · ETA: ${gb.deliveryEta}` : ""}
                      {caps.productAssignment
                        ? ` · ${gb.productIds.length === 0 ? "All products" : `${gb.productIds.length} product${gb.productIds.length === 1 ? "" : "s"}`}`
                        : ""}
                    </div>
                  </div>
                  <div className="admin-ship-row__actions" style={{ display: "inline-flex", gap: 6 }}>
                    {caps.supplierReports && (
                      <button
                        className="admin-btn admin-btn--ghost"
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => setReporting(gb)}
                      >
                        Report
                      </button>
                    )}
                    {caps.canDuplicate && (
                      <button
                        className="admin-btn admin-btn--ghost"
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => duplicate(gb)}
                      >
                        Duplicate
                      </button>
                    )}
                    {caps.canEdit && gb.status !== "archived" && (
                      <button
                        className="admin-btn admin-btn--ghost"
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => {
                          setSaveError(null);
                          setEditing(gb);
                        }}
                      >
                        Edit
                      </button>
                    )}
                    {caps.canArchive && (
                      <button
                        className="admin-btn admin-btn--ghost"
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => setArchived(gb, gb.status !== "archived")}
                      >
                        {gb.status === "archived" ? "Restore" : "Archive"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {visible.length === 0 && (
              <div className="admin-empty-set">
                {showArchived ? "Nothing archived." : "No group buys yet."}
                {caps.canCreate && !showArchived && (
                  <button className="admin-empty-set__cta" onClick={() => setCreating(true)}>
                    + Open your first group buy
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {(creating || editing) && (
          <GroupBuyModal
            initial={editing}
            caps={caps}
            settings={settings}
            busy={saving}
            error={saveError}
            onCancel={() => {
              setEditing(null);
              setCreating(false);
            }}
            onSave={save}
          />
        )}

        {reporting && (
          <ReportModal
            groupBuy={reporting}
            caps={caps}
            currency={brand.currency ?? "₱"}
            onClose={() => setReporting(null)}
          />
        )}
      </main>
    </div>
  );
}
