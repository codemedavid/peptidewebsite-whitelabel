// Customers for the Pepweb Admin app, derived from the store's own orders — the
// platform has no separate customer table, so a "customer" is everyone who
// ordered under the same email (else phone, else name).
//
// Money follows the checkout formula (computeOrderTotals); cancelled orders
// never count toward orders or spend.
//
// Pure (npm run test:mobile-insights).

import { createHash } from "node:crypto";
import type { Order } from "../../storefront/types";
import { buildAddressLine, computeOrderTotals } from "../../storefront/admin/order-detail";
import { formatMoney } from "../storefront/currency";
import type {
  CustomerDetailResponse,
  CustomerListResponse,
  CustomerRow,
  CustomerSegment,
  CustomerSort,
} from "./contract";
import { toOrderSummary } from "./order-view";

const DAY = 24 * 60 * 60 * 1000;
const STORE_UTC_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Manila
const LAPSED_AFTER_DAYS = 60;
const LOYAL_ORDERS = 3;
const DETAIL_ORDERS = 50;
const FAVOURITES = 5;
const MIN_PHONE_DIGITS = 7;

/** Raw identity key: "e:<email>" → "p:<digits>" → "n:<name>"; null when anonymous. */
export function customerKeyOf(order: Pick<Order, "customer">): string | null {
  const email = (order.customer?.email ?? "").trim().toLowerCase();
  if (email) return `e:${email}`;
  const digits = (order.customer?.phone ?? "").replace(/\D/g, "");
  if (digits.length >= MIN_PHONE_DIGITS) return `p:${digits}`;
  const name = (order.customer?.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return name ? `n:${name}` : null;
}

/** Opaque, URL-safe id for a raw key — the app never sees the email in a path. */
export function customerId(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex").slice(0, 20);
}

function segmentFor(orders: number): CustomerSegment {
  if (orders >= LOYAL_ORDERS) return "loyal";
  return orders >= 2 ? "returning" : "new";
}

type Acc = {
  raw: string;
  latest: Order;
  orders: number;
  spent: number;
  first: number;
  last: number;
};

function accumulate(orders: Order[]): Map<string, Acc> {
  const map = new Map<string, Acc>();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const raw = customerKeyOf(o);
    const t = new Date(o.date).getTime();
    if (!raw || Number.isNaN(t)) continue;
    const total = computeOrderTotals(o).total;
    const prev = map.get(raw);
    map.set(raw, {
      raw,
      latest: !prev || t >= prev.last ? o : prev.latest,
      orders: (prev?.orders ?? 0) + 1,
      spent: (prev?.spent ?? 0) + total,
      first: Math.min(prev?.first ?? Infinity, t),
      last: Math.max(prev?.last ?? -Infinity, t),
    });
  }
  return map;
}

function toRow(a: Acc, now: Date, currency: unknown): CustomerRow {
  const c = a.latest.customer;
  return {
    key: customerId(a.raw),
    name: (c?.name ?? "").trim() || "Customer",
    email: (c?.email ?? "").trim(),
    phone: (c?.phone ?? "").trim(),
    orders: a.orders,
    spent: a.spent,
    spentLabel: formatMoney(Math.round(a.spent), currency, { decimals: false }),
    avgLabel: formatMoney(a.spent / a.orders, currency),
    firstAt: new Date(a.first).toISOString(),
    lastAt: new Date(a.last).toISOString(),
    segment: segmentFor(a.orders),
    lapsed: now.getTime() - a.last > LAPSED_AFTER_DAYS * DAY,
  };
}

export function aggregateCustomers(orders: Order[], opts: { now: Date; currency: unknown }): CustomerRow[] {
  return [...accumulate(orders).values()].map((a) => toRow(a, opts.now, opts.currency));
}

const SORTS: ReadonlyArray<CustomerSort> = ["spent", "recent", "orders"];
export function parseCustomerSort(v: unknown): CustomerSort {
  return SORTS.includes(v as CustomerSort) ? (v as CustomerSort) : "spent";
}

export type CustomerFilter = CustomerSegment | "lapsed";
const FILTERS: ReadonlyArray<CustomerFilter> = ["new", "returning", "loyal", "lapsed"];
export function parseCustomerFilter(v: unknown): CustomerFilter | null {
  return FILTERS.includes(v as CustomerFilter) ? (v as CustomerFilter) : null;
}

export function queryCustomers(
  rows: CustomerRow[],
  opts: { q?: string; sort?: CustomerSort; segment?: CustomerFilter | null },
): CustomerRow[] {
  const q = (opts.q ?? "").trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const matches = (r: CustomerRow) =>
    !q ||
    r.name.toLowerCase().includes(q) ||
    r.email.toLowerCase().includes(q) ||
    (qDigits.length > 0 && r.phone.replace(/\D/g, "").includes(qDigits));
  const inSegment = (r: CustomerRow) =>
    !opts.segment || (opts.segment === "lapsed" ? r.lapsed : r.segment === opts.segment);

  const sort = opts.sort ?? "spent";
  const byRecent = (a: CustomerRow, b: CustomerRow) => b.lastAt.localeCompare(a.lastAt);
  const compare =
    sort === "recent"
      ? byRecent
      : sort === "orders"
        ? (a: CustomerRow, b: CustomerRow) => b.orders - a.orders || byRecent(a, b)
        : (a: CustomerRow, b: CustomerRow) => b.spent - a.spent || byRecent(a, b);
  return rows.filter((r) => matches(r) && inSegment(r)).sort(compare);
}

export function summarizeCustomers(rows: CustomerRow[], now: Date): CustomerListResponse["summary"] {
  const local = new Date(now.getTime() + STORE_UTC_OFFSET_MS);
  const monthStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - STORE_UTC_OFFSET_MS;
  return {
    total: rows.length,
    returningRate: rows.length ? rows.filter((r) => r.orders >= 2).length / rows.length : 0,
    newThisMonth: rows.filter((r) => new Date(r.firstAt).getTime() >= monthStart).length,
    lapsed: rows.filter((r) => r.lapsed).length,
  };
}

/** One customer's profile, favourite products and order history (newest first). */
export function buildCustomerDetail(
  orders: Order[],
  key: string,
  opts: { now: Date; currency: unknown },
): CustomerDetailResponse | null {
  const acc = [...accumulate(orders).values()].find((a) => customerId(a.raw) === key);
  if (!acc) return null;

  const mine = orders
    .filter((o) => customerKeyOf(o) === acc.raw)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const units = new Map<string, { name: string; units: number }>();
  for (const o of mine) {
    if (o.status === "cancelled") continue;
    for (const it of o.items ?? []) {
      const name = (it.name || "").trim() || "Unnamed product";
      const k = name.toLowerCase();
      units.set(k, { name: units.get(k)?.name ?? name, units: (units.get(k)?.units ?? 0) + (it.qty || 1) });
    }
  }

  return {
    customer: {
      ...toRow(acc, opts.now, opts.currency),
      contactMethod: (acc.latest.customer?.contactMethod ?? "").trim(),
      lastAddress: buildAddressLine(acc.latest.shipping),
    },
    favourites: [...units.values()].sort((a, b) => b.units - a.units).slice(0, FAVOURITES),
    orders: mine.slice(0, DETAIL_ORDERS).map((o) => toOrderSummary(o, opts.currency)),
  };
}
