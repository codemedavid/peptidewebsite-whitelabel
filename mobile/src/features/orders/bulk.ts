import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { OrderFilterKey, OrderStatus } from "@contract";
import { ordersApi, qk, type OrderListView } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap } from "@/features/admin/bridge";

/**
 * The web Orders screen's bulk actions, run through the admin bridge so the
 * website's own actions decide: bulkUpdateStorefrontOrderStatusAction (the
 * same per-order status engine — stock moves once, a journey event only on a
 * real change) and trashStorefrontOrdersAction (soft delete, restorable).
 * Both servers cap one call at 1000 ids, so bigger selections go in batches.
 */

/** cleanIdList / MAX_TRASH_IDS on the server. */
export const BULK_BATCH = 1000;
/** The list endpoint's largest page — used when collecting every id in a view. */
const COLLECT_PAGE = 50;

function batches<T>(list: readonly T[], size = BULK_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Every order id in a view (status tab + payment chip + folder + search),
 * page by page — for Select all and Move ALL, which must reach orders not
 * scrolled into the list yet.
 */
export async function collectOrderIds(filter: OrderFilterKey, q: string, view: OrderListView): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await ordersApi.list(filter, q, cursor, { ...view, limit: COLLECT_PAGE });
    ids.push(...page.orders.map((o) => o.id));
    cursor = page.nextCursor;
  } while (cursor);
  return ids;
}

type BulkStatusResult = { ok: true; changed: number } | { error: string };
type TrashResult = { ok: true } | { error: string };

function useRefreshOrders() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.ordersAll(scope) });
    void qc.invalidateQueries({ queryKey: qk.dashboard(scope) });
  };
}

/** Move many orders to one status. Resolves with how many really changed. */
export function useBulkStatus() {
  const refresh = useRefreshOrders();
  return useMutation({
    mutationFn: async ({ ids, status }: { ids: readonly string[]; status: OrderStatus }) => {
      let changed = 0;
      for (const chunk of batches(ids)) {
        const res = unwrap(await adminBridge.call<BulkStatusResult>("bulkUpdateStorefrontOrderStatusAction", chunk, status));
        changed += res.changed;
      }
      return changed;
    },
    // Earlier batches may have landed even when a later one failed — refresh either way.
    onSettled: refresh,
  });
}

/** Move many orders to the trash (Restore brings them back from Trash). */
export function useBulkTrash() {
  const refresh = useRefreshOrders();
  return useMutation({
    mutationFn: async (ids: readonly string[]) => {
      for (const chunk of batches(ids)) unwrap(await adminBridge.call<TrashResult>("trashStorefrontOrdersAction", chunk));
      return ids.length;
    },
    onSettled: refresh,
  });
}
