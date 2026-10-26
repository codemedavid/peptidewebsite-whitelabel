import { revalidateTag } from "next/cache";

/**
 * Per-tenant cache tag for everything derived from the tenant's orders: the
 * admin order lists, the app Home order stats, the best-seller tally.
 *
 * Order lists were one of the largest sources of Supabase egress — every open
 * of the web dashboard, Orders or Analytics screen re-pulled EVERY order row
 * (~1.5 kB each, hundreds per store), and the app's Home re-read its stats on a
 * 20 s poll. Caching them is only safe because every order writer calls
 * `revalidateOrders` — a new writer that forgets it serves a stale list.
 */
export function ordersTag(tenantId: string): string {
  return `tenant:${tenantId}:orders`;
}

/** Call after ANY write to a tenant's storefront_orders rows. */
export function revalidateOrders(tenantId: string): void {
  revalidateTag(ordersTag(tenantId));
}
