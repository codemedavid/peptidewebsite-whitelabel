import type { LiveStage, Tone } from "@contract";
import type { IconName } from "@/ui/primitives";

/** How often the customer app checks in (the server's HEARTBEAT_MS). */
export const HEARTBEAT_MS = 30_000;

/** Where a shopper is in the customer app, from the current route. Pure. */
export function stageFromPath(pathname: string): { stage: LiveStage; productRef: string | null } {
  const path = pathname.split("?")[0] ?? "";
  if (path === "/checkout") return { stage: "checkout", productRef: null };
  if (path === "/cart") return { stage: "cart", productRef: null };
  const product = /^\/product\/([^/]+)/.exec(path);
  if (product?.[1]) {
    let ref = product[1];
    try {
      ref = decodeURIComponent(ref);
    } catch {
      /* keep the raw segment */
    }
    return { stage: "product", productRef: ref };
  }
  return { stage: "browsing", productRef: null };
}

export const STAGE_META: Record<LiveStage, { label: string; short: string; icon: IconName; tone: Tone }> = {
  browsing: { label: "Browsing", short: "Browsing", icon: "eye-outline", tone: "neutral" },
  product: { label: "Viewing a product", short: "Product", icon: "pricetag-outline", tone: "info" },
  cart: { label: "In the cart", short: "Cart", icon: "bag-handle-outline", tone: "warning" },
  checkout: { label: "Checking out", short: "Checkout", icon: "card-outline", tone: "success" },
};

/** "now", "45s", "3m", "2h" — compact elapsed time for live rows. */
export function shortAgo(secs: number): string {
  if (secs < 10) return "now";
  if (secs < 60) return `${Math.floor(secs)}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h`;
}
