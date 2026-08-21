"use client";

// Group Buy Management — the store admin's manager for buying windows: list,
// create/edit, duplicate, archive and the per-run supplier report. Every action
// button is shown only when the matching groupbuy.* capability is granted
// (brand.groupBuyCaps, derived server-side), and the server actions re-check the
// same entitlements, so hiding here is UX — not the security boundary.

import { useEffect, useMemo, useState } from "react";
import type { RoundListRow } from "@/lib/storefront/group-buy-analytics";
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
  saveTwoWaysModeAction,
  saveGroupBuyContentAction,
  type GroupBuyCustomerLine,
} from "@/actions/group-buys";
import {
  normalizeTwoWaysMode,
  setWayAcceptOrders,
  setWayVisible,
  wayAcceptsOrders,
  wayIsVisible,
  type TwoWaysMode,
  type WayKey,
} from "@/lib/storefront/two-ways-mode";

// The two order paths, each paired with the OTHER one so the control can refuse
// the click that would leave the store with nothing to sell.
const WAY_ROWS: { key: WayKey; other: WayKey; label: string }[] = [
  { key: "onHand", other: "groupBuy", label: "On-Hand (ships now)" },
  { key: "groupBuy", other: "onHand", label: "Group Buy (ships after close)" },
];

// Each way is edited as TWO switches (see two-ways-mode: they're projections of
// one stored WayState, not separate fields). Visibility decides whether the
// section exists at all; Accept orders decides whether it sells. The pair is
// what lets an owner keep a group buy up as a pricing reference between rounds.
const VISIBILITY_CHOICES: { visible: boolean; label: string }[] = [
  { visible: true, label: "Visible" },
  { visible: false, label: "Hidden" },
];
const ACCEPT_CHOICES: { accept: boolean; label: string }[] = [
  { accept: true, label: "Enabled" },
  { accept: false, label: "Disabled" },
];
import {
  GB_CONTENT_LIMITS,
  normalizeGroupBuyContent,
  renderGbCopy,
  type GroupBuyContent,
} from "@/lib/storefront/gb-content";
import { AdminGroupBuyPricing } from "./AdminGroupBuyPricing";
import {
  downloadCustomerWorkbook,
  downloadSupplierWorkbook,
} from "@/storefront/admin/supplier-workbook";
import { ProofLightbox, PaymentBadge } from "./gb-proof-lightbox";
import {
  roundsAwaitingReport,
  type ReportPrep,
} from "@/lib/storefront/group-buy-report";

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
  cancelled: "red",
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
      slotGoal: 0,
      batchNumber: "",
      minVials: null as number | null,
      maxVials: null as number | null,
      closedAt: null as string | null,
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
  // Storefront slot-goal for the progress bar. 0 = off (no bar) — the owner can
  // clear the number to hide the progress bar for this round entirely.
  const [slotGoal, setSlotGoal] = useState<number>(seed.slotGoal ?? 0);
  const [batchNumber, setBatchNumber] = useState<string>(seed.batchNumber ?? "");
  const [minVials, setMinVials] = useState<number>(seed.minVials ?? 0);
  const [maxVials, setMaxVials] = useState<number>(seed.maxVials ?? 0);

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

        <div className="admin-modal__row">
          <label className="admin-field__label">Slot goal</label>
          <input
            className="admin-input"
            type="number"
            min={0}
            step={1}
            value={slotGoal || ""}
            placeholder="Off — leave blank to hide the progress bar"
            onChange={(e) => setSlotGoal(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
          <div className="admin-field__hint">
            {slotGoal > 0
              ? `Storefront shows “${slotGoal} slots” with a fill bar as orders come in.`
              : "Off — no progress bar shows for this group buy."}
          </div>
        </div>

        {/* Owner-facing planning fields. These drive the round's dashboard only —
            unlike Slot goal above, nothing here changes what shoppers see. */}
        <div className="admin-modal__row">
          <label className="admin-field__label">Batch number</label>
          <input
            className="admin-input"
            maxLength={64}
            value={batchNumber}
            placeholder={`Blank uses the name — “${name || "this round"}”`}
            onChange={(e) => setBatchNumber(e.target.value)}
          />
          <div className="admin-field__hint">
            Your label for this run, e.g. “TR30-B1”. Shown on the dashboard and in every export.
          </div>
        </div>

        <div className="admin-modal__row" style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label className="admin-field__label">Minimum vials</label>
            <input
              className="admin-input"
              type="number"
              min={0}
              step={1}
              value={minVials || ""}
              placeholder="Not set"
              onChange={(e) => setMinVials(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            />
            <div className="admin-field__hint">Needed for the run to be viable.</div>
          </div>
          <div style={{ flex: 1 }}>
            <label className="admin-field__label">Maximum vials</label>
            <input
              className="admin-input"
              type="number"
              min={0}
              step={1}
              value={maxVials || ""}
              placeholder="Not set"
              onChange={(e) => setMaxVials(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            />
            <div className="admin-field__hint">Progress and completion % measure against this.</div>
          </div>
        </div>
        {minVials > 0 && maxVials > 0 && minVials > maxVials && (
          <div className="admin-modal__row" style={{ color: "#d33", fontSize: 12 }}>
            The minimum can&rsquo;t be higher than the maximum.
          </div>
        )}

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
                slotGoal,
                batchNumber,
                // 0 from the number input means "cleared" — send null so
                // normalizeGroupBuy stores "not configured" rather than a real 0.
                minVials: minVials || null,
                maxVials: maxVials || null,
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
  const [unlinked, setUnlinked] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** The proof-of-payment image being inspected full-size, or null. */
  const [proofPreview, setProofPreview] = useState<{ url: string; order: string } | null>(null);

  useEffect(() => {
    let alive = true;
    getGroupBuySupplierReportAction(groupBuy.id).then((res) => {
      if (!alive) return;
      if ("error" in res) setError(res.error);
      else {
        setReport(res.report);
        setCustomers(res.customers);
        setPrep(res.prep);
        setUnlinked(res.unlinked);
      }
    });
    return () => {
      alive = false;
    };
  }, [groupBuy.id]);

  // Esc closes the proof lightbox before the report modal, so one keypress never
  // dismisses both.
  useEffect(() => {
    if (!proofPreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProofPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [proofPreview]);

  const counts = prep?.counts ?? null;
  const orderRows = prep?.orderLines ?? [];
  const productsToOrder = prep?.productsToOrder ?? [];
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
  };

  const money = (n: number) => `${currency}${n.toLocaleString()}`;

  const fileStem = `group-buy-${groupBuy.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-report`;

  /** Shared HTML table markup for the Excel (.xls) and PDF (print) exports. */
  const reportHtml = (): string => {
    if (!report || !counts) return "";
    const esc = (v: string | number) =>
      String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const supplierRows = productsToOrder
      .map(
        (l) =>
          `<tr><td>${esc(l.product)}</td><td style="text-align:right">${l.vials}</td><td style="text-align:right">${l.orders}</td></tr>`,
      )
      .join("");
    const supplierTable = `
      <h3>Products to order</h3>
      <table>
        <thead><tr><th>Product</th><th style="text-align:right">Vials to order</th><th style="text-align:right">Orders</th></tr></thead>
        <tbody>${supplierRows}
          <tr style="font-weight:bold;border-top:2px solid #000">
            <td>TOTAL</td><td style="text-align:right">${counts.totalVials}</td><td></td>
          </tr>
        </tbody>
      </table>
      <h3>Orders</h3>
      <table>
        <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Contact</th><th>Address</th><th>Batch</th><th>Product</th><th style="text-align:right">Vials</th><th>Payment</th><th>Pay status</th><th>Order status</th></tr></thead>
        <tbody>${orderRows
          .map(
            (l) =>
              `<tr${l.counted ? "" : ' style="opacity:.55;text-decoration:line-through"'}><td>${esc(l.orderNumber)}</td><td>${esc(
                fmtDate(l.orderDate),
              )}</td><td>${esc(l.customer)}</td><td>${esc(l.contact)}</td><td>${esc(l.address)}</td><td>${esc(
                l.batch,
              )}</td><td>${esc(l.product)}</td><td style="text-align:right">${l.vials}</td><td>${esc(
                l.paymentMethod,
              )}</td><td>${esc(l.paymentStatus)}</td><td>${esc(l.orderStatus)}</td></tr>`,
          )
          .join("")}</tbody>
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
      <h1>Group Buy Report — ${esc(groupBuy.name)}</h1>
      <p>${counts.totalOrders} order(s) · ${counts.activeOrders} active · ${counts.confirmedOrders} confirmed · ${counts.pendingOrders} pending · ${counts.cancelledOrders} cancelled<br/>
         ${counts.totalVials} vials · ${esc(money(counts.totalSales))} in sales <em>(cancelled orders excluded)</em></p>
      ${supplierTable}
      ${customerTable}`;
  };

  // Two .xlsx downloads, not one. The supplier file is product quantities only
  // so the owner can forward it untouched; the customer file keeps the buyers,
  // their addresses, the payment proofs and the money. exceljs is lazy-loaded
  // inside each download so it never enters the storefront bundle; the data
  // shaping is the unit-tested prepareReport (server-side).
  const downloadSupplierExcel = async () => {
    if (!prep) return;
    await downloadSupplierWorkbook(prep);
  };

  const downloadCustomerExcel = async () => {
    if (!prep) return;
    await downloadCustomerWorkbook(prep);
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
    if (!report || !counts) return;
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    // Same three blocks the screen shows, in the same order: what to order, the
    // headline counts, then every order line (cancelled included but flagged).
    const rows: (string | number)[][] = [
      ["Product", "Total Vials to Order", "Orders"],
      ...productsToOrder.map((l) => [l.product, l.vials, l.orders]),
      ["TOTAL", counts.totalVials, counts.activeOrders],
      [],
      ["Total Orders", counts.totalOrders],
      ["Total Active Orders", counts.activeOrders],
      ["Total Confirmed Orders", counts.confirmedOrders],
      ["Total Pending Orders", counts.pendingOrders],
      ["Total Cancelled Orders", counts.cancelledOrders],
      ["Total Vials Ordered", counts.totalVials],
      ["Total Sales", counts.totalSales],
      [],
      [
        "Order",
        "Order Date",
        "Customer",
        "Contact Number",
        "Shipping Address",
        "Batch",
        "Product",
        "Vials",
        "Price",
        "Payment Method",
        "Payment Status",
        "Order Status",
        "Counted",
        "Proof of Payment",
      ],
      ...orderRows.map((l) => [
        l.orderNumber,
        fmtDate(l.orderDate),
        l.customer,
        l.contact,
        l.address,
        l.batch,
        l.product,
        l.vials,
        l.price,
        l.paymentMethod,
        l.paymentStatus,
        l.orderStatus,
        l.counted ? "Yes" : "No",
        l.proofUrl ?? "",
      ]),
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

        {report && counts && (
          <>
            {/* Summary — cancelled orders never feed vials or sales. */}
            <div
              className="admin-modal__row"
              style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(104px,1fr))", gap: 8 }}
            >
              {[
                { label: "Total Orders", value: counts.totalOrders },
                { label: "Active", value: counts.activeOrders },
                { label: "Confirmed", value: counts.confirmedOrders },
                { label: "Pending", value: counts.pendingOrders },
                { label: "Cancelled", value: counts.cancelledOrders },
                { label: "Vials Ordered", value: counts.totalVials },
                { label: "Total Sales", value: money(counts.totalSales) },
              ].map((tile) => (
                <div
                  key={tile.label}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "rgba(0,0,0,.04)",
                    border: "1px solid rgba(0,0,0,.08)",
                  }}
                >
                  <div style={{ fontSize: 11, opacity: 0.65, textTransform: "uppercase", letterSpacing: ".04em" }}>
                    {tile.label}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.3 }}>{tile.value}</div>
                </div>
              ))}
            </div>

            {unlinked > 0 && (
              <div className="admin-modal__row" style={{ fontSize: 12, opacity: 0.75 }}>
                {unlinked} other order{unlinked === 1 ? " was" : "s were"} placed outside every group
                buy&rsquo;s date range, so {unlinked === 1 ? "it isn't" : "they aren't"} counted here.
                Adjust this round&rsquo;s open/close dates to include {unlinked === 1 ? "it" : "them"}.
              </div>
            )}

            {productsToOrder.length === 0 ? (
              <div className="admin-empty-set">No orders were placed under this group buy yet.</div>
            ) : (
              <div className="admin-modal__row">
                <label className="admin-field__label">Products to order</label>
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", opacity: 0.7 }}>
                      <th style={{ padding: "4px 0" }}>Product</th>
                      <th style={{ textAlign: "right" }}>Vials to order</th>
                      <th style={{ textAlign: "right" }}>Orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productsToOrder.map((l) => (
                      <tr key={l.productId ?? l.product} style={{ borderTop: "1px solid rgba(0,0,0,.08)" }}>
                        <td style={{ padding: "6px 0" }}>{l.product}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{l.vials}</td>
                        <td style={{ textAlign: "right", opacity: 0.7 }}>{l.orders}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: "2px solid rgba(0,0,0,.25)", fontWeight: 700 }}>
                      <td style={{ padding: "6px 0" }}>TOTAL</td>
                      <td style={{ textAlign: "right" }}>{counts.totalVials}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {orderRows.length > 0 && (
              <div className="admin-modal__row">
                <label className="admin-field__label">Orders ({counts.totalOrders})</label>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 900 }}>
                    <thead>
                      <tr style={{ textAlign: "left", opacity: 0.7 }}>
                        <th style={{ padding: "4px 6px 4px 0" }}>Order</th>
                        <th style={{ padding: "4px 6px" }}>Date</th>
                        <th style={{ padding: "4px 6px" }}>Customer</th>
                        <th style={{ padding: "4px 6px" }}>Contact</th>
                        <th style={{ padding: "4px 6px" }}>Shipping address</th>
                        <th style={{ padding: "4px 6px" }}>Batch</th>
                        <th style={{ padding: "4px 6px" }}>Product</th>
                        <th style={{ padding: "4px 6px", textAlign: "right" }}>Vials</th>
                        <th style={{ padding: "4px 6px" }}>Payment</th>
                        <th style={{ padding: "4px 6px" }}>Pay status</th>
                        <th style={{ padding: "4px 6px" }}>Order status</th>
                        <th style={{ padding: "4px 6px" }}>Proof</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderRows.map((l, i) => (
                        <tr
                          key={`${l.orderNumber}-${l.productId ?? l.product}-${i}`}
                          style={{
                            borderTop: "1px solid rgba(0,0,0,.08)",
                            opacity: l.counted ? 1 : 0.5,
                            textDecoration: l.counted ? "none" : "line-through",
                          }}
                        >
                          <td style={{ padding: "6px 6px 6px 0", whiteSpace: "nowrap" }}>{l.orderNumber}</td>
                          <td style={{ padding: "6px", whiteSpace: "nowrap" }}>{fmtDate(l.orderDate)}</td>
                          <td style={{ padding: "6px" }}>{l.customer}</td>
                          <td style={{ padding: "6px", whiteSpace: "nowrap" }}>{l.contact}</td>
                          <td style={{ padding: "6px", maxWidth: 220 }}>{l.address}</td>
                          <td style={{ padding: "6px" }}>{l.batch}</td>
                          <td style={{ padding: "6px" }}>{l.product}</td>
                          <td style={{ padding: "6px", textAlign: "right", fontWeight: 600 }}>{l.vials}</td>
                          <td style={{ padding: "6px" }}>{l.paymentMethod}</td>
                          <td style={{ padding: "6px" }}>
                            <PaymentBadge status={l.paymentStatus} />
                          </td>
                          <td style={{ padding: "6px" }}>{l.orderStatus}</td>
                          <td style={{ padding: "6px" }}>
                            {l.proofUrl ? (
                              <button
                                type="button"
                                onClick={() => setProofPreview({ url: l.proofUrl!, order: l.orderNumber })}
                                title="Click to view the payment proof full size"
                                style={{
                                  padding: 0,
                                  border: "1px solid rgba(0,0,0,.15)",
                                  borderRadius: 4,
                                  background: "none",
                                  cursor: "zoom-in",
                                  lineHeight: 0,
                                }}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={l.proofUrl}
                                  alt={`Payment proof for order ${l.orderNumber}`}
                                  width={44}
                                  height={44}
                                  style={{ width: 44, height: 44, objectFit: "cover", display: "block", borderRadius: 3 }}
                                />
                              </button>
                            ) : (
                              <span style={{ opacity: 0.5 }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
          {productsToOrder.length > 0 && caps.reports.csv && (
            <button className="admin-btn admin-btn--ghost" onClick={downloadCsv}>
              CSV
            </button>
          )}
          {productsToOrder.length > 0 && caps.reports.excel && (
            <button
              className="admin-btn admin-btn--ghost"
              onClick={downloadSupplierExcel}
              title="Product quantities only — safe to send to the supplier"
            >
              Supplier .xlsx
            </button>
          )}
          {productsToOrder.length > 0 && caps.reports.excel && caps.reports.customerBreakdown && (
            <button
              className="admin-btn admin-btn--ghost"
              onClick={downloadCustomerExcel}
              title="Customers, orders and totals — your copy, do not send to the supplier"
            >
              Customers .xlsx
            </button>
          )}
          {productsToOrder.length > 0 && caps.reports.pdf && (
            <button className="admin-btn admin-btn--ghost" onClick={downloadPdf}>
              PDF
            </button>
          )}
          <button className="admin-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {proofPreview && (
        <ProofLightbox
          url={proofPreview.url}
          label={proofPreview.order}
          onClose={() => setProofPreview(null)}
        />
      )}
    </div>
  );
}

// ── StorefrontCopyModal ───────────────────────────────────────────────────────

/**
 * Editor for the owner-facing Group Buy storefront copy: the "How group buys
 * work" section (title + steps) and the live-round terms line. What's saved is
 * rendered verbatim on BOTH the two-ways home and the group-buy page; `{eta}`
 * anywhere in the text becomes the live round's delivery ETA. Clearing a field
 * resets it to the built-in default (per-field fallback in the normalizer).
 */
function StorefrontCopyModal({
  initial,
  busy,
  error,
  onCancel,
  onSave,
}: {
  initial: GroupBuyContent;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (content: GroupBuyContent) => void;
}) {
  const [howTitle, setHowTitle] = useState(initial.howTitle);
  const [steps, setSteps] = useState<string[]>(initial.steps);
  const [terms, setTerms] = useState(initial.terms);

  const setStep = (i: number, value: string) =>
    setSteps((cur) => cur.map((s, j) => (j === i ? value : s)));
  const removeStep = (i: number) => setSteps((cur) => cur.filter((_, j) => j !== i));
  const addStep = () => setSteps((cur) => (cur.length >= GB_CONTENT_LIMITS.maxSteps ? cur : [...cur, ""]));

  // Live example of the terms line as the storefront would show it.
  const termsPreview = renderGbCopy(
    terms.trim() || normalizeGroupBuyContent(undefined).terms,
    "3–4 weeks after the group buy closes",
  );

  return (
    <div className="admin-modal" onClick={onCancel}>
      <div
        className="admin-modal__card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "86vh", overflowY: "auto" }}
      >
        <h2 className="admin-modal__title">Storefront copy</h2>
        <p className="admin-field__hint" style={{ marginTop: -6 }}>
          Shown on the store home and the group-buy page. Use <code>{"{eta}"}</code> anywhere
          to insert the live round&apos;s delivery ETA. Clear a field to reset it to the
          default copy.
        </p>

        <div className="admin-modal__row">
          <label className="admin-field__label">Section title</label>
          <input
            className="admin-input"
            value={howTitle}
            maxLength={GB_CONTENT_LIMITS.maxTitleLen}
            placeholder="How group buys work"
            onChange={(e) => setHowTitle(e.target.value)}
          />
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Steps</label>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 6 }}>
              <span className="admin-field__hint" style={{ marginTop: 8, minWidth: 16 }}>{i + 1}.</span>
              <textarea
                className="admin-input"
                rows={2}
                value={s}
                maxLength={GB_CONTENT_LIMITS.maxTextLen}
                onChange={(e) => setStep(i, e.target.value)}
              />
              <button
                className="admin-btn admin-btn--ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}
                aria-label={`Remove step ${i + 1}`}
                onClick={() => removeStep(i)}
              >
                ✕
              </button>
            </div>
          ))}
          {steps.length < GB_CONTENT_LIMITS.maxSteps && (
            <button
              className="admin-btn admin-btn--ghost"
              style={{ padding: "4px 10px", fontSize: 12 }}
              onClick={addStep}
            >
              + Add step
            </button>
          )}
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Live-round terms line</label>
          <textarea
            className="admin-input"
            rows={2}
            value={terms}
            maxLength={GB_CONTENT_LIMITS.maxTextLen}
            placeholder="Pay now to lock your slot. Ships {eta}. COA posted before shipping."
            onChange={(e) => setTerms(e.target.value)}
          />
          <span className="admin-field__hint">Preview: {termsPreview}</span>
        </div>

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
            disabled={busy}
            onClick={() => onSave(normalizeGroupBuyContent({ howTitle, steps, terms }))}
          >
            {busy ? "Saving…" : "Save copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AdminGroupBuys ────────────────────────────────────────────────────────────

export function AdminGroupBuys({
  brand,
  onBack,
  onOpen,
}: {
  brand: Brand;
  onBack: () => void;
  /** Open one round's dedicated dashboard. */
  onOpen: (gb: GroupBuy) => void;
}) {
  const { toast } = useStore();
  const caps = brand.groupBuyCaps ?? GROUP_BUY_CAPS_OFF;
  const money = (n: number) => `${brand.currency || "₱"}${n.toLocaleString()}`;

  const [rows, setRows] = useState<RoundListRow[]>([]);
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

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

  // Per-way management: which of the two order paths this store actually sells.
  // brand.twoWaysMode carries the EFFECTIVE states (already folded with the live
  // round), so re-normalize the raw pair here — the owner is editing their own
  // setting, not the round's side effect on it.
  const [ways, setWays] = useState<TwoWaysMode>(() =>
    normalizeTwoWaysMode(brand.twoWaysMode),
  );
  const [savingWays, setSavingWays] = useState(false);

  // Owner-editable storefront copy ("How group buys work" + live-round terms) —
  // loaded with the list, saved via saveGroupBuyContentAction into
  // branding.config.groupBuyContent.
  const [content, setContent] = useState<GroupBuyContent>(() =>
    normalizeGroupBuyContent(brand.groupBuyContent),
  );
  const [editingContent, setEditingContent] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  // Two tabs: the rounds themselves, and the per-product group-buy pricing.
  // Pricing is a separate panel component — this file is already long, and the
  // two views share only the loaded rounds.
  const [tab, setTab] = useState<"rounds" | "pricing">("rounds");

  const [editing, setEditing] = useState<GroupBuy | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<GroupBuy | null>(null);

  // Auto report on close (groupbuy.reports.auto_on_close): pop the report open
  // for a run that has effectively just closed. There's no server cron, so "on
  // close" is detected here on the first load after the window lapsed.
  //
  // This is the paid extra and it fires at most once per page load. The badge
  // below is the part every store gets: it stays on the row until the round is
  // archived, so a manager on another device — or a staff account that never
  // saw the popup — still cannot miss that a finished round needs its reports.
  const maybeAutoReport = (list: GroupBuy[]) => {
    if (!caps.reports.autoOnClose || !caps.supplierReports) return;
    const [closed] = roundsAwaitingReport(list, caps.scheduled);
    if (closed) setReporting(closed);
  };

  useEffect(() => {
    let alive = true;
    listGroupBuysAction().then((res) => {
      if (!alive) return;
      if ("error" in res) setLoadError(res.error);
      else {
        setGroupBuys(res.groupBuys);
        setRows(res.rows);
        setSettings(res.settings);
        setContent(res.content);
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
  // Finished-but-unarchived rounds. Derived on every render (a round can lapse
  // while the panel is open) and shared by the banner and the per-row badge.
  const awaitingReport = new Set(
    caps.supplierReports
      ? roundsAwaitingReport(groupBuys, caps.scheduled).map((gb) => gb.id)
      : [],
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

  const saveWays = async (next: TwoWaysMode) => {
    const prev = ways;
    setWays(next); // optimistic
    setSavingWays(true);
    const res = await saveTwoWaysModeAction(next);
    setSavingWays(false);
    if ("error" in res) {
      setWays(prev); // revert
      return toast(res.error);
    }
    // The server re-normalizes, so a combination it refuses (hiding both ways)
    // comes back corrected rather than silently diverging from what's stored.
    setWays(res.mode);
    toast("Ways to order saved.");
  };

  const saveContent = async (next: GroupBuyContent) => {
    setSavingContent(true);
    setContentError(null);
    const res = await saveGroupBuyContentAction(next);
    setSavingContent(false);
    if ("error" in res) {
      setContentError(res.error);
      return;
    }
    setContent(res.content);
    setEditingContent(false);
    toast("Storefront copy saved.");
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
            {tab === "rounds" && archivedCount > 0 && (
              <button
                className="admin-btn admin-btn--ghost"
                onClick={() => setShowArchived((v) => !v)}
              >
                {showArchived ? "Back to list" : `Archived (${archivedCount})`}
              </button>
            )}
            {tab === "rounds" && caps.canCreate && !showArchived && (
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

        <div className="gbtabs" role="tablist" aria-label="Group buy sections">
          <button
            type="button"
            role="tab"
            id="gbtab-rounds"
            aria-selected={tab === "rounds"}
            aria-controls="gbpanel-rounds"
            className={`gbtabs__tab${tab === "rounds" ? " is-active" : ""}`}
            onClick={() => setTab("rounds")}
          >
            Rounds
          </button>
          <button
            type="button"
            role="tab"
            id="gbtab-pricing"
            aria-selected={tab === "pricing"}
            aria-controls="gbpanel-pricing"
            className={`gbtabs__tab${tab === "pricing" ? " is-active" : ""}`}
            onClick={() => setTab("pricing")}
          >
            Pricing
          </button>
        </div>

        {tab === "pricing" && (
          <div id="gbpanel-pricing" role="tabpanel" aria-labelledby="gbtab-pricing">
            <AdminGroupBuyPricing
              brand={brand}
              caps={caps}
              groupBuys={groupBuys}
              onGroupBuysChange={setGroupBuys}
            />
          </div>
        )}

        {tab === "rounds" && (
          <div
            style={{
              margin: "4px 0 14px",
              padding: "12px 14px",
              border: "1px solid var(--brand-border, rgba(0,0,0,.12))",
              borderRadius: 10,
            }}
          >
            <div style={{ fontWeight: 600 }}>Ways to order</div>
            <div className="admin-field__hint" style={{ marginTop: 2 }}>
              Two separate switches per order path. <strong>Visibility</strong> decides whether
              customers see the section at all — <strong>Hidden</strong> takes it off the
              storefront entirely and the store reads as a one-way store (you can’t hide both).{" "}
              <strong>Accept orders</strong> decides whether they can buy: turn it{" "}
              <strong>Disabled</strong> to keep the products and prices on show for reference while
              nothing can be added to cart or checked out.
            </div>
            {WAY_ROWS.map((row) => {
              const state = ways[row.key];
              const visible = wayIsVisible(state);
              // Never offer the click that would remove the last way — the
              // server refuses it anyway, so the button would just bounce.
              const wouldEmptyStore = !wayIsVisible(ways[row.other]);
              return (
                <div
                  key={row.key}
                  style={{
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop: "1px solid var(--brand-border, rgba(0,0,0,.08))",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{row.label}</div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                      marginTop: 8,
                    }}
                  >
                    <span className="admin-field__hint">Visibility</span>
                    <div
                      role="group"
                      aria-label={`${row.label} visibility`}
                      style={{ display: "flex", gap: 6 }}
                    >
                      {VISIBILITY_CHOICES.map((choice) => {
                        const active = visible === choice.visible;
                        const blocked = !choice.visible && wouldEmptyStore;
                        return (
                          <button
                            key={choice.label}
                            type="button"
                            className={`admin-btn${active ? "" : " admin-btn--ghost"}`}
                            style={{ padding: "4px 10px", fontSize: 12 }}
                            aria-pressed={active}
                            disabled={savingWays || blocked}
                            title={
                              blocked ? "Your store needs at least one way to order." : undefined
                            }
                            onClick={() =>
                              saveWays({ ...ways, [row.key]: setWayVisible(state, choice.visible) })
                            }
                          >
                            {choice.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                      marginTop: 8,
                    }}
                  >
                    <span className="admin-field__hint">Accept orders</span>
                    <div
                      role="group"
                      aria-label={`${row.label} accept orders`}
                      style={{ display: "flex", gap: 6 }}
                    >
                      {ACCEPT_CHOICES.map((choice) => {
                        const active = wayAcceptsOrders(state) === choice.accept;
                        return (
                          <button
                            key={choice.label}
                            type="button"
                            className={`admin-btn${active ? "" : " admin-btn--ghost"}`}
                            style={{ padding: "4px 10px", fontSize: 12 }}
                            aria-pressed={active}
                            // A hidden way sells nothing by definition, so the
                            // switch is moot until it's visible again.
                            disabled={savingWays || !visible}
                            title={!visible ? "Make this way visible first." : undefined}
                            onClick={() =>
                              saveWays({
                                ...ways,
                                [row.key]: setWayAcceptOrders(state, choice.accept),
                              })
                            }
                          >
                            {choice.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {row.key === "groupBuy" && visible && !wayAcceptsOrders(state) && (
                    <div className="admin-field__hint" style={{ marginTop: 8 }}>
                      Customers can browse the group buy products and prices, and see a “Group Buy
                      Currently Closed” notice. Nothing can be added to cart.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === "rounds" && caps.productAssignment && ways.onHand === "open" && (
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

        {/* Owner-editable storefront copy — the "How group buys work" section and
            the live-round terms line, shared by the store home + group-buy page. */}
        {tab === "rounds" && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
            margin: "4px 0 14px",
            padding: "12px 14px",
            border: "1px solid var(--brand-border, rgba(0,0,0,.12))",
            borderRadius: 10,
          }}
        >
          <span>
            <span style={{ fontWeight: 600 }}>Storefront copy</span>
            <span className="admin-field__hint" style={{ display: "block", marginTop: 2 }}>
              “{content.howTitle}” — {content.steps.length} step
              {content.steps.length === 1 ? "" : "s"} and the live-round terms line, shown on
              the store home and the group-buy page.
            </span>
          </span>
          <button
            className="admin-btn admin-btn--ghost"
            style={{ padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" }}
            onClick={() => {
              setContentError(null);
              setEditingContent(true);
            }}
          >
            Edit copy
          </button>
        </div>
        )}

        {!loaded && <div className="admin-empty-set">Loading group buys…</div>}
        {loadError && (
          <div className="admin-empty-set" role="alert">
            {loadError}
          </div>
        )}

        {tab === "rounds" && loaded && !loadError && (
          <div className="admin-ship-list" id="gbpanel-rounds" role="tabpanel" aria-labelledby="gbtab-rounds">
            {visible.map((gb) => {
              const eff = effectiveGroupBuyStatus(gb, caps.scheduled);
              const row = rowsById.get(gb.id);
              return (
                <div key={gb.id} className="admin-ship-row">
                  {/* The whole row summary is the link into the round's own
                      dashboard — a button (not a div with onClick) so it is
                      keyboard reachable and announced as an action. */}
                  <button
                    type="button"
                    className="admin-ship-row__info"
                    onClick={() => onOpen(gb)}
                    aria-label={`Open the dashboard for ${gb.name}`}
                    style={{
                      background: "none",
                      border: 0,
                      padding: 0,
                      font: "inherit",
                      color: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                      flex: 1,
                    }}
                  >
                    <div className="admin-ship-row__name" style={{ fontWeight: 600 }}>
                      {gb.name} <StatusChip status={eff} />
                    </div>
                    <div className="admin-field__hint">
                      {row ? `${row.productName} · Batch ${row.batchNumber}` : fmtDate(gb.startsAt)}
                      {gb.deliveryEta ? ` · ETA: ${gb.deliveryEta}` : ""}
                    </div>
                    {row && (
                      <div className="admin-field__hint">
                        {row.maxVials === null
                          ? `${row.currentVials} vials`
                          : `${row.currentVials}/${row.maxVials} vials`}{" "}
                        · {row.totalOrders} order{row.totalOrders === 1 ? "" : "s"} ·{" "}
                        {row.participants} participant{row.participants === 1 ? "" : "s"} ·{" "}
                        {money(row.grossIncome)} · created {fmtDate(row.createdAt)}
                      </div>
                    )}
                  </button>
                  <div className="admin-ship-row__actions" style={{ display: "inline-flex", gap: 6 }}>
                    {caps.supplierReports && (
                      // A finished round promotes its own Report button rather
                      // than relying on a one-shot popup: the prompt stays put
                      // until the owner archives the round, so it survives a
                      // different device, a staff login and a cleared browser.
                      <button
                        className={`admin-btn ${awaitingReport.has(gb.id) ? "" : "admin-btn--ghost"}`}
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => setReporting(gb)}
                        title={
                          awaitingReport.has(gb.id)
                            ? "This round has finished — download the supplier and customer reports"
                            : "Supplier and customer reports for this round"
                        }
                      >
                        {awaitingReport.has(gb.id) ? "Reports ready" : "Report"}
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

        {editingContent && (
          <StorefrontCopyModal
            initial={content}
            busy={savingContent}
            error={contentError}
            onCancel={() => setEditingContent(false)}
            onSave={saveContent}
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
