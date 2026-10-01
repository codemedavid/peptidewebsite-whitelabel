import type { OrderStatus, StockMove, Tone } from "@contract";
import type { IconName } from "@/ui/primitives";

/**
 * Presentation for the website's seven REAL order statuses — nothing invented.
 * Order matters: it is the fulfilment sequence shown in the status sheet.
 */
export const STATUS_ORDER: readonly OrderStatus[] = [
  "new",
  "confirmed",
  "processing",
  "ready",
  "shipped",
  "delivered",
  "cancelled",
];

export const STATUS_META: Record<OrderStatus, { label: string; icon: IconName; tone: Tone; help: string }> = {
  new: { label: "New", icon: "flash", tone: "info", help: "Just placed — waiting for you to confirm." },
  confirmed: { label: "Confirmed", icon: "checkmark-circle", tone: "neutral", help: "Accepted. Stock has been set aside." },
  processing: { label: "Processing", icon: "construct-outline", tone: "neutral", help: "Being prepared." },
  ready: { label: "Ready to ship", icon: "cube-outline", tone: "neutral", help: "Packed and waiting for the courier." },
  shipped: { label: "Shipped", icon: "paper-plane-outline", tone: "info", help: "On its way to the customer." },
  delivered: { label: "Delivered", icon: "checkmark-done-circle", tone: "success", help: "Received by the customer." },
  cancelled: { label: "Cancelled", icon: "close-circle", tone: "danger", help: "Won't be fulfilled." },
};

/** Words for what a status change does to inventory, for the confirm dialog. */
export function stockEffectCopy(move: StockMove): string | null {
  if (move === "deduct") return "This takes the items out of your stock.";
  if (move === "restock") return "This puts the items back into your stock.";
  return null;
}

// ── time, in the store's timezone (the web admin renders Asia/Manila too) ──

const TZ = "Asia/Manila";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const time = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d);

/** "Just now", "12 min ago", "Today 2:14 PM", "Yesterday 9:03 AM", "Sep 12". */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = now.getTime() - d.getTime();
  if (diff >= 0 && diff < MINUTE) return "Just now";
  if (diff >= 0 && diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (dayKey(d) === dayKey(now)) return `Today ${time(d)}`;
  if (dayKey(d) === dayKey(new Date(now.getTime() - 24 * HOUR))) return `Yesterday ${time(d)}`;
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(d);
}

/** Full timestamp for the detail header and timeline. */
export function formatFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
