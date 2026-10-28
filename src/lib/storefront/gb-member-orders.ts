// One consolidated order per MEMBER per group buy (mnm-pepsabuy, 2026-10-28).
//
// A member who tops up their group-buy order checks out more than once, and
// each checkout stays its own stored order: that keeps every payment proof and
// its "paid" mark on the checkout it belongs to, which is how the owner wants
// payments accounted ("retain the original payment record and separately
// account for any additional payment"). This module is the other half: it folds
// a round's orders into one row per member, with every product they bought
// merged, the order value, what has been paid, and what is still owed.
//
// "The same member" is the admin-fee rule's definition (admin-fee-once.ts): one
// account, email OR phone links two orders, and links chain (A shares an email
// with B, B a phone with C → one member). Cancelled orders don't count, exactly
// as everywhere else in the round report.
//
// Pure: the round dashboard, the customer workbook and the tests share it.

import { emailKey, phoneKey } from "./admin-fee-once";
import { orderCountsAsDemand, productLineKey } from "./group-buy";
import { formatShippingAddress, type ReportOrderItem, type ReportShipping } from "./group-buy-orders";
import { computeOrderTotals, type TotalsInput } from "@/storefront/admin/order-detail";

type ChargeLine = { label: string; amount: number };

/** A round order as the member view reads it (the round report's LinkableOrder
 *  fits as-is). */
export type MemberOrderInput = {
  orderNumber?: string;
  date: string;
  status: string;
  paymentStatus?: string;
  customerAccountId?: string | null;
  customer?: { name?: string; email?: string; phone?: string };
  shipping?: ReportShipping & { fee?: number };
  items: ReportOrderItem[];
  adminFee?: ChargeLine | null;
  paymentFee?: ChargeLine | null;
  discount?: (ChargeLine & { code: string }) | null;
};

/** The Orders screen's own total for one checkout (computeOrderTotals). */
function checkoutTotals(o: MemberOrderInput) {
  const input: TotalsInput = {
    items: o.items ?? [],
    shipping: { fee: Number(o.shipping?.fee) || 0 } as TotalsInput["shipping"],
    adminFee: o.adminFee ?? undefined,
    paymentFee: o.paymentFee ?? undefined,
    discount: o.discount ?? undefined,
  };
  return computeOrderTotals(input);
}

/** One checkout inside a member's consolidated order. */
export type MemberCheckout = {
  orderNumber: string;
  date: string;
  total: number;
  adminFee: number;
  paid: boolean;
};

/** Everything the member bought in the round, one line per product + size. */
export type MemberProductLine = {
  product: string;
  variation: string | null;
  qty: number;
  amount: number;
};

export type MemberOrder = {
  /** Stable for the round: the member's first order number. */
  id: string;
  name: string;
  email: string;
  contact: string;
  address: string;
  checkouts: MemberCheckout[];
  products: MemberProductLine[];
  /** Sum of the checkouts' totals (items − discount + shipping + fees). */
  total: number;
  /** Totals of the checkouts marked paid. */
  paid: number;
  /** What is still owed: total − paid, never below zero. */
  balance: number;
  adminFee: number;
};

function identityKeys(o: MemberOrderInput, index: number): string[] {
  const c = o.customer ?? {};
  const email = emailKey(c.email);
  const phone = phoneKey(c.phone);
  const keys = [
    o.customerAccountId ? `a:${o.customerAccountId}` : null,
    email ? `e:${email}` : null,
    phone ? `p:${phone}` : null,
  ].filter((k): k is string => k !== null);
  if (keys.length > 0) return keys;
  // No contact at all: only the exact same name links it, never a stranger's.
  const name = c.name?.trim().toLowerCase();
  return [name ? `n:${name}` : `o:${index}`];
}

/** Union-find over orders: two orders that share any identity key merge. */
function groupIndexes(orders: readonly MemberOrderInput[]): number[][] {
  const parent = orders.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    return root;
  };
  const owner = new Map<string, number>();
  orders.forEach((o, i) => {
    for (const key of identityKeys(o, i)) {
      const seen = owner.get(key);
      if (seen === undefined) owner.set(key, i);
      else parent[find(i)] = find(seen);
    }
  });
  const groups = new Map<number, number[]>();
  orders.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });
  return [...groups.values()];
}

function mergeProducts(orders: readonly MemberOrderInput[]): MemberProductLine[] {
  const byKey = new Map<string, MemberProductLine>();
  for (const it of orders.flatMap((o) => o.items ?? [])) {
    const key = productLineKey(it);
    const prev = byKey.get(key) ?? { product: it.name, variation: it.variation ?? null, qty: 0, amount: 0 };
    byKey.set(key, { ...prev, qty: prev.qty + it.qty, amount: prev.amount + it.qty * it.price });
  }
  return [...byKey.values()];
}

function buildMember(orders: readonly MemberOrderInput[]): MemberOrder {
  const sorted = [...orders].sort((a, b) => a.date.localeCompare(b.date));
  const checkouts: MemberCheckout[] = sorted.map((o) => {
    const totals = checkoutTotals(o);
    return {
      orderNumber: o.orderNumber ?? "—",
      date: o.date,
      total: totals.total,
      adminFee: totals.fee,
      paid: o.paymentStatus?.toLowerCase() === "paid",
    };
  });
  const total = checkouts.reduce((s, c) => s + c.total, 0);
  const paid = checkouts.filter((c) => c.paid).reduce((s, c) => s + c.total, 0);
  // The newest checkout carries the freshest name / address the member typed.
  const latest = [...sorted].reverse();
  const pick = (read: (o: MemberOrderInput) => string | undefined): string =>
    latest.map(read).find((v) => v && v.trim())?.trim() ?? "";
  const email = pick((o) => o.customer?.email);
  const phone = pick((o) => o.customer?.phone);
  return {
    id: checkouts[0]?.orderNumber ?? "—",
    name: pick((o) => o.customer?.name) || email || "Unknown",
    email,
    contact: phone || email || "—",
    address: latest.map((o) => formatShippingAddress(o.shipping)).find((a) => a !== "—") ?? "—",
    checkouts,
    products: mergeProducts(sorted),
    total,
    paid,
    balance: Math.max(0, total - paid),
    adminFee: checkouts.reduce((s, c) => s + c.adminFee, 0),
  };
}

/**
 * The round's orders as one consolidated order per member, biggest balance
 * first (who the owner needs to chase), then biggest order.
 */
export function buildMemberOrders(orders: readonly MemberOrderInput[]): MemberOrder[] {
  const counted = orders.filter((o) => orderCountsAsDemand(o.status));
  return groupIndexes(counted)
    .map((idx) => buildMember(idx.map((i) => counted[i])))
    .sort((a, b) => b.balance - a.balance || b.total - a.total || a.name.localeCompare(b.name));
}

/** Round-wide sums of the member rows, for the panel header and the sheet's total row. */
export function memberOrderTotals(
  members: readonly MemberOrder[],
): { total: number; paid: number; balance: number } {
  return members.reduce(
    (s, m) => ({ total: s.total + m.total, paid: s.paid + m.paid, balance: s.balance + m.balance }),
    { total: 0, paid: 0, balance: 0 },
  );
}
