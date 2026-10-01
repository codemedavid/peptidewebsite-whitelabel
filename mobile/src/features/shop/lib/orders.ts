import type { ShopOrder, ShopOrderStatus } from "@shop-contract";
import type { Tone } from "@contract";

/**
 * A shopper's words for the website's seven order statuses (the admin app's
 * copy in features/orders/status.ts speaks to the seller). Pure.
 */

type Meta = { label: string; tone: Tone; icon: string; help: string };

export const SHOP_STATUS: Record<ShopOrderStatus, Meta> = {
  new: { label: "Placed", tone: "info", icon: "receipt-outline", help: "The store has your order and will confirm it soon." },
  confirmed: { label: "Confirmed", tone: "neutral", icon: "checkmark-circle-outline", help: "The store accepted your order." },
  processing: { label: "Preparing", tone: "neutral", icon: "construct-outline", help: "Your order is being prepared." },
  ready: { label: "Ready to ship", tone: "neutral", icon: "cube-outline", help: "Packed and waiting for the courier." },
  shipped: { label: "Shipped", tone: "info", icon: "paper-plane-outline", help: "On its way to you." },
  delivered: { label: "Delivered", tone: "success", icon: "checkmark-done-circle-outline", help: "Delivered. Enjoy!" },
  cancelled: { label: "Cancelled", tone: "danger", icon: "close-circle-outline", help: "This order was cancelled." },
};

/** The happy path, in order — the timeline shows where the order is on it. */
export const SHOP_FLOW: readonly ShopOrderStatus[] = ["new", "confirmed", "processing", "ready", "shipped", "delivered"];

export type TimelineStep = { status: ShopOrderStatus; label: string; at: string | null; state: "done" | "current" | "upcoming" };

/**
 * Timeline steps: every status the order has been through (from its history,
 * earliest time per status), the current one highlighted, and — unless it was
 * cancelled — the steps still to come.
 */
export function orderTimeline(order: Pick<ShopOrder, "status" | "statusHistory" | "placedAt">): TimelineStep[] {
  const firstAt = new Map<ShopOrderStatus, string>();
  firstAt.set("new", order.placedAt);
  for (const h of order.statusHistory) {
    if (!firstAt.has(h.status)) firstAt.set(h.status, h.at);
  }
  if (order.status === "cancelled") {
    const reached = SHOP_FLOW.filter((s) => firstAt.has(s));
    return [
      ...reached.map((s) => ({ status: s, label: SHOP_STATUS[s].label, at: firstAt.get(s) ?? null, state: "done" as const })),
      { status: "cancelled", label: SHOP_STATUS.cancelled.label, at: firstAt.get("cancelled") ?? null, state: "current" },
    ];
  }
  const currentIdx = Math.max(0, SHOP_FLOW.indexOf(order.status));
  return SHOP_FLOW.map((s, i) => ({
    status: s,
    label: SHOP_STATUS[s].label,
    at: i <= currentIdx ? firstAt.get(s) ?? null : null,
    state: i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming",
  }));
}

export function orderItemCount(order: Pick<ShopOrder, "items">): number {
  return order.items.reduce((n, i) => n + i.qty, 0);
}

export function orderSubtotal(order: Pick<ShopOrder, "items">): number {
  return order.items.reduce((n, i) => n + i.price * i.qty, 0);
}

export function itemsLabel(count: number): string {
  return `${count} item${count === 1 ? "" : "s"}`;
}

const TZ = "Asia/Manila";

/** "Sep 30, 2026" in the store's timezone. */
export function orderDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }).format(d);
}

/** "Sep 30, 2:14 PM". */
export function orderMoment(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

/** "#1042" — order numbers are shown with one leading "#", never two. */
export function orderLabel(orderNumber: string): string {
  const n = orderNumber.trim();
  return n.startsWith("#") ? n : `#${n}`;
}
