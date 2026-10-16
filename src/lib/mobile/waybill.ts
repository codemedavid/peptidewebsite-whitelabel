// Waybills — one printable shipping label per order, so the owner can pack a
// whole group-buy round from a stack of paper instead of a phone screen.
//
// The lines mirror the group-buy invoice the store already sends (name,
// address, contact, courier, fee, round, the list of orders), but per ORDER,
// not merged per customer: each parcel carries exactly what is inside it.
//
// Pure (npm run test:waybills).

import type { Order } from "../../storefront/types";
import type { OrderFilterKey, Waybill } from "./contract";

/** One print run — a busy round is a few hundred orders, never thousands. */
export const WAYBILL_LIMIT = 500;

const SHORT_ID_LENGTH = 6;
const FILTERS: readonly OrderFilterKey[] = ["new", "to-fulfil", "shipped", "all"];
const MAX_QUERY = 80;
const MAX_ID = 64;

const trim = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "2 vials", "1 vial", "2 pcs"; a blank unit prints the bare number. */
function qtyLabel(qty: number, unit: string): string {
  if (!unit) return String(qty);
  const plural = qty === 1 || /s$/i.test(unit) ? unit : `${unit}s`;
  return `${qty} ${plural}`;
}

function addressOf(s: Order["shipping"] | undefined): string {
  if (!s) return "";
  return [s.address, s.barangay, s.city, s.province, s.postal].map(trim).filter(Boolean).join(", ");
}

export function toWaybill(order: Order, opts: { money: (amount: number) => string; unit: string }): Waybill {
  const number = trim(order.orderNumber);
  return {
    id: order.id,
    orderNumber: number || `#${order.id.slice(-SHORT_ID_LENGTH)}`,
    name: trim(order.customer?.name),
    address: addressOf(order.shipping),
    phone: trim(order.customer?.phone),
    courier: trim(order.courier),
    shippingFee: opts.money(order.shipping?.fee || 0),
    roundName: trim(order.groupBuyName),
    items: (order.items ?? []).flatMap((i) => {
      const name = trim(i.name);
      // A missing qty is how legacy rows store "one" (order-view reads it the same way).
      const qty = i.qty === undefined || i.qty === null ? 1 : Math.floor(Number(i.qty) || 0);
      return name && qty > 0 ? [{ name, qty, qtyLabel: qtyLabel(qty, opts.unit) }] : [];
    }),
  };
}

export type WaybillQuery =
  | { kind: "one"; id: string }
  | { kind: "list"; round: string; filter: OrderFilterKey; q: string };

/**
 * What to print: one order (`id`), or a round's orders under the current status
 * + search. A bare request is refused (null) — printing every order the store
 * ever took is never one tap.
 */
export function waybillQuery(params: URLSearchParams): WaybillQuery | null {
  const id = trim(params.get("id")).slice(0, MAX_ID);
  if (id) return { kind: "one", id };
  const round = trim(params.get("round")).slice(0, MAX_ID);
  if (!round || round === "all") return null;
  const raw = params.get("filter") as OrderFilterKey;
  return {
    kind: "list",
    round,
    filter: FILTERS.includes(raw) ? raw : "all",
    q: trim(params.get("q")).slice(0, MAX_QUERY),
  };
}
