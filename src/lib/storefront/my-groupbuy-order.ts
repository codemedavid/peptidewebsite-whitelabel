// "My Group Buy Order" — the BUYER's own view of a group-buy round
// (FEATURES.STORE_MY_GROUPBUY_ORDER; mnm-pepsabuy, 2026-10-29).
//
// A group-buy-only store has no customer accounts and no Track page, and its
// members top up their round order with several checkouts. This page lets a
// buyer type the email AND the phone they checked out with and see, per round:
// every checkout (number, date, status, payment), one merged item list, and the
// money — items, admin fee, shipping, discount, total, paid and balance.
//
// The privacy bar is BOTH fields. Either one alone is often known to other
// people (a group chat full of members knows each other's numbers), so an order
// matches only when its email AND its phone agree with what was typed. The keys
// are the admin-fee rule's (admin-fee-once.ts: lower-cased email, last 10 phone
// digits), so "the same buyer" means one thing for the fee and for this page.
//
// Merged lines key on productLineKey (productId + variation): variations share
// a productId, and keying on the id alone folds 5ml and 10ml into one wrong
// line. Money per checkout is computeOrderTotals — the Orders screen's own math,
// Ligwak re-totals included — so the buyer and the owner can never disagree.
//
// Pure: no React, no Prisma. The server action loads rows and calls in; the
// test (npm run test:my-groupbuy-order) runs with nothing but tsx.

import { emailKey, phoneKey } from "./admin-fee-once";
import { productLineKey } from "./group-buy";
import { computeOrderTotals, type TotalsInput } from "@/storefront/admin/order-detail";
import { sortRounds, toShopOrderRound, type RoundRow } from "@/lib/mobile/order-rounds";
import type { Order } from "@/storefront/types";

// ── Input ─────────────────────────────────────────────────────────────────────

/** What the buyer typed, reduced to the comparable keys. */
export type BuyerKeys = { email: string; phone: string };

/** Longest raw value accepted per field — anything longer is not a contact. */
const MAX_FIELD = 200;

/** Shown for malformed input. Says nothing about whether any order exists. */
export const LOOKUP_INPUT_ERROR = "Enter the email and phone number you used at checkout.";

/** Shown on a miss. Deliberately the same whichever field was wrong. */
export const LOOKUP_NO_MATCH = "No group buy orders found for that email and phone.";

/**
 * Validate the untrusted `{ email, phone }` payload into match keys. BOTH must
 * be usable — a lookup with only one of them is refused before any read.
 */
export function parseBuyerLookup(input: unknown): { ok: true; keys: BuyerKeys } | { ok: false; error: string } {
  const x = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rawEmail = typeof x.email === "string" ? x.email.slice(0, MAX_FIELD) : "";
  const rawPhone = typeof x.phone === "string" ? x.phone.slice(0, MAX_FIELD) : "";
  const email = emailKey(rawEmail);
  const phone = phoneKey(rawPhone);
  if (!email || !phone) return { ok: false, error: LOOKUP_INPUT_ERROR };
  return { ok: true, keys: { email, phone } };
}

/** Does a stored order's `customer` blob belong to this buyer? Email AND phone. */
export function matchesBuyer(customer: unknown, keys: BuyerKeys): boolean {
  const c = (customer && typeof customer === "object" ? customer : {}) as Record<string, unknown>;
  return emailKey(c.email) === keys.email && phoneKey(c.phone) === keys.phone;
}

/** An order as this view reads it — the storefront Order (dbOrderToStorefront). */
export type BuyerOrder = Pick<
  Order,
  "orderNumber" | "id" | "date" | "status" | "paymentStatus" | "customer" | "groupBuyId" | "groupBuyName" | "deletedAt"
> &
  TotalsInput;

// ── Output ────────────────────────────────────────────────────────────────────

export type MyGbCheckout = {
  orderNumber: string;
  date: string;
  status: Order["status"];
  paymentStatus: "paid" | "pending";
  total: number;
};

export type MyGbLine = {
  key: string;
  name: string;
  /** The variation, only when the stored name doesn't already say it. */
  variation: string | null;
  qty: number;
  amount: number;
};

export type MyGbTotals = {
  subtotal: number;
  adminFee: number;
  paymentFee: number;
  shipping: number;
  discount: number;
  total: number;
  /** Totals of the (non-cancelled) checkouts marked paid. */
  paid: number;
  /** total − paid, never below zero. */
  balance: number;
};

export type MyGbRound = {
  id: string;
  name: string;
  /** Owner's batch label; "" when unset or the same as the name. */
  batch: string;
  state: "live" | "upcoming" | "closed";
  /** "Open" | "Bunuan time" | "Closed" | "Payment time" | "Upcoming". */
  stateLabel: string;
  deliveryEta: string;
  /** ISO — only set when the owner set a payment due date. */
  paymentDueAt: string | null;
  /** Newest first. Cancelled checkouts are listed but never counted. */
  checkouts: MyGbCheckout[];
  items: MyGbLine[];
  totals: MyGbTotals;
};

// ── Build ─────────────────────────────────────────────────────────────────────

const FALLBACK_NAME = "Group buy";
const STATE_FALLBACK_LABEL: Record<MyGbRound["state"], string> = {
  live: "Open",
  upcoming: "Upcoming",
  closed: "Closed",
};

/** A cancelled checkout stays on the list (the buyer should see it was
 *  cancelled) but adds nothing to the items or the money — the round report's rule. */
function counts(o: BuyerOrder): boolean {
  return o.status !== "cancelled";
}

function variationLabel(name: string, variation: string | undefined): string | null {
  const v = (variation ?? "").trim();
  if (!v) return null;
  return name.toLowerCase().includes(v.toLowerCase()) ? null : v;
}

/** Every counted checkout's lines folded by product + variation, biggest first. */
export function mergeBuyerLines(orders: readonly BuyerOrder[]): MyGbLine[] {
  const byKey = new Map<string, MyGbLine>();
  for (const it of orders.filter(counts).flatMap((o) => o.items ?? [])) {
    const key = productLineKey(it);
    const prev = byKey.get(key);
    const qty = Math.max(0, it.qty || 0);
    const amount = qty * Math.max(0, it.price || 0);
    byKey.set(
      key,
      prev
        ? { ...prev, qty: prev.qty + qty, amount: prev.amount + amount }
        : { key, name: it.name, variation: variationLabel(it.name, it.variation), qty, amount },
    );
  }
  return [...byKey.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
}

/** The round's money, summed checkout by checkout with computeOrderTotals. */
export function sumBuyerTotals(orders: readonly BuyerOrder[]): MyGbTotals {
  const zero: MyGbTotals = { subtotal: 0, adminFee: 0, paymentFee: 0, shipping: 0, discount: 0, total: 0, paid: 0, balance: 0 };
  const sum = orders.filter(counts).reduce((s, o) => {
    const t = computeOrderTotals(o);
    return {
      ...s,
      subtotal: s.subtotal + t.subtotal,
      adminFee: s.adminFee + t.fee,
      paymentFee: s.paymentFee + t.paymentFee,
      shipping: s.shipping + t.shipping,
      discount: s.discount + t.discount,
      total: s.total + t.total,
      paid: s.paid + (o.paymentStatus === "paid" ? t.total : 0),
    };
  }, zero);
  return { ...sum, balance: Math.max(0, sum.total - sum.paid) };
}

function toCheckout(o: BuyerOrder): MyGbCheckout {
  return {
    orderNumber: o.orderNumber || o.id,
    date: o.date,
    status: o.status,
    paymentStatus: o.paymentStatus === "paid" ? "paid" : "pending",
    total: counts(o) ? computeOrderTotals(o).total : 0,
  };
}

function byNewest(a: BuyerOrder, b: BuyerOrder): number {
  return b.date.localeCompare(a.date);
}

function buildRound(
  id: string,
  orders: readonly BuyerOrder[],
  row: RoundRow | undefined,
  scheduledEnabled: boolean,
  now: Date,
): MyGbRound {
  const sorted = [...orders].sort(byNewest);
  const shop = row ? toShopOrderRound(row, scheduledEnabled, now) : null;
  // A round whose row is gone keeps the name its orders were stamped with.
  const snapshot = sorted.map((o) => o.groupBuyName?.trim()).find(Boolean);
  const name = shop?.name || snapshot || FALLBACK_NAME;
  const state = shop?.state ?? "closed";
  const batch = shop?.batch && shop.batch !== name ? shop.batch : "";
  return {
    id,
    name,
    batch,
    state,
    stateLabel: shop?.stageLabel ?? STATE_FALLBACK_LABEL[state],
    deliveryEta: shop?.deliveryEta ?? "",
    paymentDueAt: shop?.paymentDueAt ?? null,
    checkouts: sorted.map(toCheckout),
    items: mergeBuyerLines(sorted),
    totals: sumBuyerTotals(sorted),
  };
}

/**
 * The buyer's group-buy rounds: only orders that are group-buy orders, not in
 * the trash, and whose email AND phone match. Live round first, then newest
 * (sortRounds); rounds whose row no longer exists come last, newest first.
 */
export function buildMyGroupBuyOrder(
  orders: readonly BuyerOrder[],
  rounds: readonly RoundRow[],
  keys: BuyerKeys,
  opts: { scheduledEnabled?: boolean; now?: Date } = {},
): MyGbRound[] {
  const now = opts.now ?? new Date();
  const scheduled = opts.scheduledEnabled === true;
  const byRound = new Map<string, BuyerOrder[]>();
  for (const o of orders) {
    if (!o.groupBuyId || o.deletedAt || !matchesBuyer(o.customer, keys)) continue;
    byRound.set(o.groupBuyId, [...(byRound.get(o.groupBuyId) ?? []), o]);
  }
  if (byRound.size === 0) return [];

  const rowById = new Map(rounds.map((r) => [r.id, r]));
  const known = sortRounds(
    rounds.filter((r) => byRound.has(r.id)),
    scheduled,
    now,
  ).map((r) => buildRound(r.id, byRound.get(r.id) ?? [], r, scheduled, now));
  const orphans = [...byRound.entries()]
    .filter(([id]) => !rowById.has(id))
    .map(([id, list]) => buildRound(id, list, undefined, scheduled, now))
    .sort((a, b) => (b.checkouts[0]?.date ?? "").localeCompare(a.checkouts[0]?.date ?? ""));
  return [...known, ...orphans];
}
