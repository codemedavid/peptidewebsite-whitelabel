/**
 * Owner data export — the answer to "if I ever leave Pepweb, can I take my
 * products, customer data and order history with me?".
 *
 * Yes, and this module is what makes it true. It turns a tenant's live catalog
 * and order history into a small bundle of files the owner downloads from the
 * store admin: four CSVs another platform (or an accountant) can read directly,
 * plus one JSON dump a developer can migrate from without parsing spreadsheets.
 *
 * PURE — no DB, no React, no browser. The server action (actions/storefront-export)
 * loads the tenant-scoped data and feeds it here; the admin panel only turns the
 * returned files into downloads. Keeping the shaping here is what lets
 * scripts/test-data-export.ts prove the money in the export reconciles with the
 * money on screen, and that a hostile product name can't become a live formula
 * in the owner's spreadsheet.
 *
 * Two rules this file exists to hold:
 *   - LOSSLESS. Nothing is silently dropped: variations become their own rows,
 *     trashed orders are exported with a Deleted flag rather than omitted, and
 *     an empty store still yields header rows so the owner can see the shape.
 *   - SAFE IN EXCEL. Every cell goes through csvCell(), which both escapes CSV
 *     structure and neutralizes formula injection.
 */

import type { Order, Product } from "@/storefront/types";
import { orderTotal } from "./admin-dashboard";

export type CsvValue = string | number | null | undefined;
export type CsvRow = CsvValue[];

export type ExportFile = {
  filename: string;
  mime: string;
  content: string;
};

export type ExportStore = {
  name: string;
  slug: string;
  /** Display currency symbol, recorded in the files so prices aren't ambiguous. */
  currency: string;
};

export type DataExportInput = {
  store: ExportStore;
  products: readonly Product[];
  /** Live order history (the admin's Orders list). */
  orders: readonly Order[];
  /** Orders sitting in the owner's Trash. Exported too — see buildDataExport. */
  trashedOrders?: readonly Order[];
  /** ISO timestamp the export was taken at; stamps the filenames and the JSON. */
  generatedAt: string;
};

export type CustomerRecord = {
  name: string;
  email: string;
  phone: string;
  contactMethod: string;
  /** Most recent known shipping address. */
  address: string;
  city: string;
  province: string;
  country: string;
  /** Every order they ever placed, cancelled ones included. */
  orders: number;
  cancelledOrders: number;
  /** Units bought across non-cancelled orders. */
  units: number;
  /** Lifetime spend — cancelled orders excluded (no money changed hands). */
  totalSpent: number;
  firstOrderAt: string;
  lastOrderAt: string;
};

export type DataExportBundle = {
  files: ExportFile[];
  counts: { products: number; orders: number; orderItems: number; customers: number };
};

// ── CSV primitives ───────────────────────────────────────────────────────────

/** Characters a spreadsheet treats as the start of a formula, not text. */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * One CSV cell: escaped for CSV structure AND neutralized for spreadsheet
 * formula injection.
 *
 * The injection guard applies to STRINGS ONLY. A customer who types
 * `=HYPERLINK("http://evil","click")` as their name must land in the owner's
 * sheet as inert text — but a real negative number (a refunded fee, a negative
 * adjustment) is data, and quoting it with a leading apostrophe would corrupt
 * the very totals this export exists to preserve. Numbers therefore pass
 * through untouched; only text is prefixed.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";

  const raw = String(value);
  const guarded = FORMULA_PREFIXES.some((p) => raw.startsWith(p)) ? `'${raw}` : raw;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Rows → a CSV document. The first row is the header by convention. */
export function toCsv(rows: readonly CsvRow[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

// ── Products ─────────────────────────────────────────────────────────────────

export const PRODUCT_COLUMNS: readonly string[] = [
  "Product ID",
  "Name",
  "Variation",
  "Category",
  "Sort Category",
  "Price",
  "Discount Price",
  "Currency",
  "Stock",
  "Featured",
  "Available",
  "Description",
  "Purity",
  "CAS",
  "Molecular Weight",
  "Sequence",
  "Storage",
  "Image",
  "Created",
];

/**
 * The catalog, ONE ROW PER SELLABLE OPTION. A product with variations produces a
 * row per variation carrying that option's own price and stock (falling back to
 * the base column when the option doesn't track its own) — a single row per
 * product would throw away the per-size prices the store actually sells at, and
 * the importing platform needs each option as its own line.
 */
export function buildProductRows(products: readonly Product[], currency: string): CsvRow[] {
  const rows: CsvRow[] = [];

  for (const p of products) {
    const variations = p.variations ?? [];
    const options = variations.length
      ? variations.map((v) => ({
          label: v.name,
          price: v.price,
          stock: typeof v.stock === "number" ? v.stock : p.stock ?? 0,
        }))
      : [{ label: "", price: p.price, stock: p.stock ?? 0 }];

    for (const opt of options) {
      rows.push([
        p.id,
        p.name,
        opt.label,
        p.category,
        p.sortCategory ?? "",
        opt.price,
        p.discountEnabled ? p.discountPrice ?? "" : "",
        p.currency || currency,
        opt.stock,
        p.featured ? "Yes" : "No",
        p.available === false ? "No" : "Yes",
        p.description,
        p.purity ?? "",
        p.cas ?? "",
        p.molecularWeight ?? "",
        p.sequence ?? "",
        p.storage ?? "",
        p.image ?? "",
        p.createdAt ?? "",
      ]);
    }
  }

  return rows;
}

// ── Orders ───────────────────────────────────────────────────────────────────

export const ORDER_COLUMNS: readonly string[] = [
  "Order Number",
  "Order ID",
  "Date",
  "Status",
  "Payment Status",
  "Payment Method",
  "Customer Name",
  "Email",
  "Phone",
  "Contact Method",
  "Address",
  "Barangay",
  "City",
  "Province",
  "Postal",
  "Region",
  "Country",
  "Items Subtotal",
  "Discount Code",
  "Discount Amount",
  "Shipping Fee",
  "Admin Fee Label",
  "Admin Fee",
  "Total",
  "Items",
  "Courier",
  "Tracking Number",
  "Shipping Note",
  "Customer Note",
  "Group Buy",
  "Imported",
  "Deleted",
  "Payment Proof",
];

function itemsSubtotal(o: Order): number {
  return (o.items || []).reduce((sum, i) => sum + (i.price || 0) * (i.qty || 1), 0);
}

/** "BPC-157 x2; TB-500 x1" — the order at a glance, on the order row itself. */
function itemsSummary(o: Order): string {
  return (o.items || []).map((i) => `${i.name} x${i.qty || 1}`).join("; ");
}

/**
 * Order history, one row per order. `Total` is computed with the SHARED
 * orderTotal() the admin screens use, so an exported file can never disagree
 * with what the owner saw on the dashboard.
 */
export function buildOrderRows(orders: readonly Order[]): CsvRow[] {
  return orders.map((o) => [
    o.orderNumber ?? "",
    o.id,
    o.date,
    o.status,
    o.paymentStatus,
    o.paymentMethod,
    o.customer?.name ?? "",
    o.customer?.email ?? "",
    o.customer?.phone ?? "",
    o.customer?.contactMethod ?? "",
    o.shipping?.address ?? "",
    o.shipping?.barangay ?? "",
    o.shipping?.city ?? "",
    o.shipping?.province ?? "",
    o.shipping?.postal ?? "",
    o.shipping?.region ?? "",
    o.shipping?.country ?? "",
    itemsSubtotal(o),
    o.discount?.code ?? "",
    o.discount?.amount ?? "",
    o.shipping?.fee ?? 0,
    o.adminFee?.label ?? "",
    o.adminFee?.amount ?? "",
    orderTotal(o),
    itemsSummary(o),
    o.courier,
    o.trackingNumber,
    o.shippingNote,
    o.customerNote ?? "",
    o.groupBuyName ?? "",
    o.imported ? "Yes" : "No",
    o.deletedAt ? "Yes" : "No",
    o.paymentProof ?? "",
  ]);
}

export const ORDER_ITEM_COLUMNS: readonly string[] = [
  "Order Number",
  "Date",
  "Customer Name",
  "Email",
  "Product",
  "Variation",
  "Product ID",
  "Qty",
  "Unit Price",
  "Line Total",
  "Order Status",
  "Deleted",
];

/** One row per order LINE — the shape a stock/sales importer wants. */
export function buildOrderItemRows(orders: readonly Order[]): CsvRow[] {
  const rows: CsvRow[] = [];
  for (const o of orders) {
    for (const item of o.items || []) {
      const qty = item.qty || 1;
      rows.push([
        o.orderNumber ?? "",
        o.date,
        o.customer?.name ?? "",
        o.customer?.email ?? "",
        item.name,
        item.variation ?? "",
        item.productId ?? "",
        qty,
        item.price || 0,
        (item.price || 0) * qty,
        o.status,
        o.deletedAt ? "Yes" : "No",
      ]);
    }
  }
  return rows;
}

// ── Customers ────────────────────────────────────────────────────────────────

export const CUSTOMER_COLUMNS: readonly string[] = [
  "Name",
  "Email",
  "Phone",
  "Contact Method",
  "Address",
  "City",
  "Province",
  "Country",
  "Orders",
  "Cancelled Orders",
  "Units",
  "Total Spent",
  "First Order",
  "Last Order",
];

/**
 * Identity for the rollup, most reliable signal first: email, then phone with
 * punctuation stripped, then the name. Checkout does not require every field, so
 * a store that sells over Messenger may have phone-only or name-only buyers —
 * falling back keeps their history together instead of exploding one person into
 * one "customer" per order. Returns null when there is nothing to key on at all.
 */
function customerKey(o: Order): string | null {
  const email = (o.customer?.email ?? "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = (o.customer?.phone ?? "").replace(/[^0-9+]/g, "");
  if (phone) return `phone:${phone}`;
  const name = (o.customer?.name ?? "").trim().toLowerCase();
  if (name) return `name:${name}`;
  return null;
}

function orderUnits(o: Order): number {
  return (o.items || []).reduce((sum, i) => sum + (i.qty || 1), 0);
}

/**
 * The customer list, deduplicated across repeat orders.
 *
 * Cancelled orders stay in the `orders` count (they are part of the
 * relationship, and a cancellation pattern is worth seeing) but contribute no
 * money or units — otherwise lifetime spend would advertise revenue the store
 * never took.
 *
 * Contact details and address come from the customer's MOST RECENT order, since
 * that is the one worth mailing to.
 */
export function buildCustomerRecords(orders: readonly Order[]): CustomerRecord[] {
  const byKey = new Map<string, CustomerRecord>();

  // Oldest first, so "latest wins" for contact details is a plain overwrite and
  // first/last dates fall out of the iteration order.
  const sorted = [...orders].sort((a, b) => a.date.localeCompare(b.date));

  for (const o of sorted) {
    const key = customerKey(o);
    if (!key) continue;

    const counted = o.status !== "cancelled";
    const existing = byKey.get(key);

    const latest = {
      name: o.customer?.name || existing?.name || "",
      email: o.customer?.email || existing?.email || "",
      phone: o.customer?.phone || existing?.phone || "",
      contactMethod: o.customer?.contactMethod || existing?.contactMethod || "",
      address: o.shipping?.address || existing?.address || "",
      city: o.shipping?.city || existing?.city || "",
      province: o.shipping?.province || existing?.province || "",
      country: o.shipping?.country || existing?.country || "",
    };

    byKey.set(key, {
      ...latest,
      orders: (existing?.orders ?? 0) + 1,
      cancelledOrders: (existing?.cancelledOrders ?? 0) + (counted ? 0 : 1),
      units: (existing?.units ?? 0) + (counted ? orderUnits(o) : 0),
      totalSpent: (existing?.totalSpent ?? 0) + (counted ? orderTotal(o) : 0),
      firstOrderAt: existing?.firstOrderAt ?? o.date,
      lastOrderAt: o.date,
    });
  }

  return [...byKey.values()];
}

export function buildCustomerRows(records: readonly CustomerRecord[]): CsvRow[] {
  return records.map((c) => [
    c.name,
    c.email,
    c.phone,
    c.contactMethod,
    c.address,
    c.city,
    c.province,
    c.country,
    c.orders,
    c.cancelledOrders,
    c.units,
    c.totalSpent,
    c.firstOrderAt,
    c.lastOrderAt,
  ]);
}

// ── The bundle ───────────────────────────────────────────────────────────────

/** `hpglow-orders-2026-08-19.csv` — the store and the date, so downloads from
 *  two stores (or two dates) never collide in the owner's Downloads folder. */
export function exportFilename(slug: string, part: string, generatedAt: string, ext: string): string {
  const safeSlug = (slug || "store").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const day = (generatedAt || "").slice(0, 10) || "export";
  return `${safeSlug}-${part}-${day}.${ext}`;
}

const CSV_MIME = "text/csv;charset=utf-8";

/**
 * The downloadable bundle: four CSVs plus one JSON dump.
 *
 * Trashed orders are appended to the SAME orders file rather than left out. The
 * owner deleted them from their working view, but an export taken to leave the
 * platform is the last chance to keep them — so they ride along with
 * `Deleted = Yes` and are excluded from nothing except the owner's attention.
 */
export function buildDataExport(input: DataExportInput): DataExportBundle {
  const { store, generatedAt } = input;
  const orders = [...input.orders, ...(input.trashedOrders ?? [])];
  const customers = buildCustomerRecords(orders);

  const productRows = buildProductRows(input.products, store.currency);
  const orderRows = buildOrderRows(orders);
  const itemRows = buildOrderItemRows(orders);
  const customerRows = buildCustomerRows(customers);

  const csv = (part: string, header: readonly string[], rows: CsvRow[]): ExportFile => ({
    filename: exportFilename(store.slug, part, generatedAt, "csv"),
    mime: CSV_MIME,
    content: toCsv([[...header], ...rows]),
  });

  const json: ExportFile = {
    filename: exportFilename(store.slug, "store-data", generatedAt, "json"),
    mime: "application/json",
    content: JSON.stringify(
      {
        exportedAt: generatedAt,
        store,
        products: input.products,
        orders,
        customers,
      },
      null,
      2,
    ),
  };

  return {
    files: [
      csv("products", PRODUCT_COLUMNS, productRows),
      csv("orders", ORDER_COLUMNS, orderRows),
      csv("order-items", ORDER_ITEM_COLUMNS, itemRows),
      csv("customers", CUSTOMER_COLUMNS, customerRows),
      json,
    ],
    counts: {
      products: input.products.length,
      orders: orders.length,
      orderItems: itemRows.length,
      customers: customers.length,
    },
  };
}
