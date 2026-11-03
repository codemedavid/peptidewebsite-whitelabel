/**
 * One buyer's order history, as the store admin sees it — the shared core of
 * the customer profile (website AdminCustomerProfile, app customer-account
 * screen) and the dashboard's Top customers panel.
 *
 * A "customer" is either a store ACCOUNT (StorefrontCustomer — orders linked by
 * customerAccountId) or, for guest checkout, everyone who ordered under the
 * same email (else phone, else name) — the same identity rule the app's
 * Customers list has always used.
 *
 * Pure: no DB, no React, no Node built-ins, so the dashboard can import it.
 * Covered by scripts/test-customer-profile.ts.
 */

import type { Order } from "@/storefront/types";

const MIN_PHONE_DIGITS = 7;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** StorefrontCustomer ids are cuids. */
const ACCOUNT_ID_RE = /^[a-z0-9]{10,40}$/i;

// ── Identity ────────────────────────────────────────────────────────────────

/** Raw identity key: "e:<email>" → "p:<digits>" → "n:<name>"; null when anonymous. */
export function customerKeyOf(order: Pick<Order, "customer">): string | null {
  const email = (order.customer?.email ?? "").trim().toLowerCase();
  if (email) return `e:${email}`;
  const digits = (order.customer?.phone ?? "").replace(/\D/g, "");
  if (digits.length >= MIN_PHONE_DIGITS) return `p:${digits}`;
  const name = (order.customer?.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return name ? `n:${name}` : null;
}

/** A comparable email, or null when it isn't one. */
export function normalizeLookupEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const email = v.trim().toLowerCase();
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(email) ? email : null;
}

/** How the admin points at a customer: their account, or the email they buy with. */
export type CustomerLookup = { kind: "account"; id: string } | { kind: "email"; email: string };

/** Untrusted input (a server-action argument) → a lookup, or null. */
export function parseCustomerLookup(v: unknown): CustomerLookup | null {
  if (!v || typeof v !== "object") return null;
  const { kind, id, email } = v as Record<string, unknown>;
  if (kind === "account") {
    return typeof id === "string" && ACCOUNT_ID_RE.test(id) ? { kind, id } : null;
  }
  if (kind === "email") {
    const normalized = normalizeLookupEmail(email);
    return normalized ? { kind, email: normalized } : null;
  }
  return null;
}

// ── Stats ───────────────────────────────────────────────────────────────────

export type CustomerOrderStats = {
  /** Orders that count — everything but cancelled. */
  orders: number;
  cancelled: number;
  spent: number;
  avg: number;
  firstAt: string | null;
  lastAt: string | null;
};

function timeOf(o: Order): number {
  return new Date(o.date).getTime();
}

/** Totals for one customer's orders. Cancelled orders never count as spend. */
export function summarizeCustomerOrders(orders: Order[], totalOf: (o: Order) => number): CustomerOrderStats {
  let count = 0;
  let cancelled = 0;
  let spent = 0;
  let first = Infinity;
  let last = -Infinity;
  for (const o of orders) {
    if (o.status === "cancelled") {
      cancelled++;
      continue;
    }
    count++;
    spent += totalOf(o);
    const t = timeOf(o);
    if (!Number.isNaN(t)) {
      first = Math.min(first, t);
      last = Math.max(last, t);
    }
  }
  return {
    orders: count,
    cancelled,
    spent,
    avg: count > 0 ? spent / count : 0,
    firstAt: Number.isFinite(first) ? new Date(first).toISOString() : null,
    lastAt: Number.isFinite(last) ? new Date(last).toISOString() : null,
  };
}

// ── Top customers ───────────────────────────────────────────────────────────

export type TopCustomerRow = {
  /** The raw identity key (customerKeyOf) — stable per buyer. */
  key: string;
  name: string;
  /** Lower-cased; "" when they ordered without one (not openable as a profile). */
  email: string;
  orders: number;
  spent: number;
  lastAt: string;
};

export type TopCustomerRanking = "spent" | "orders";

/**
 * The store's best buyers, best first. "spent" ranks by money (ties → more
 * orders); "orders" ranks by order count (ties → most recent) — the ranking a
 * store without Sales Analytics gets, since it must not be ordered by revenue.
 */
export function rankTopCustomers(
  orders: Order[],
  opts: { by: TopCustomerRanking; limit: number; totalOf: (o: Order) => number },
): TopCustomerRow[] {
  const byKey = new Map<string, { row: TopCustomerRow; latest: number }>();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const key = customerKeyOf(o);
    const t = timeOf(o);
    if (!key || Number.isNaN(t)) continue;
    const prev = byKey.get(key);
    const isLatest = !prev || t >= prev.latest;
    const latest = isLatest ? t : prev.latest;
    const name = (o.customer?.name ?? "").trim();
    byKey.set(key, {
      latest,
      row: {
        key,
        // The newest order's name wins — it's what they go by now.
        name: (isLatest && name) || prev?.row.name || name || "Customer",
        email: key.startsWith("e:") ? key.slice(2) : "",
        orders: (prev?.row.orders ?? 0) + 1,
        spent: (prev?.row.spent ?? 0) + opts.totalOf(o),
        lastAt: new Date(latest).toISOString(),
      },
    });
  }
  const byRecent = (a: TopCustomerRow, b: TopCustomerRow) => b.lastAt.localeCompare(a.lastAt);
  return [...byKey.values()]
    .map((v) => v.row)
    .sort((a, b) =>
      opts.by === "spent"
        ? b.spent - a.spent || b.orders - a.orders || byRecent(a, b)
        : b.orders - a.orders || byRecent(a, b),
    )
    .slice(0, Math.max(0, opts.limit));
}
