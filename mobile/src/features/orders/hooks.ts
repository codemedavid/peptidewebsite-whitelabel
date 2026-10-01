import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderDetail, OrderFilterKey, OrderUpdateRequest } from "@contract";
import { ApiError } from "@/api/client";
import { ordersApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";

/**
 * Order data for the signed-in store. Every key is prefixed with the session
 * scope, so a cached order can never surface under another store or account.
 *
 * Status changes are NOT optimistic: confirming or cancelling moves stock and
 * emails the customer, so the screen waits for the server's answer and shows
 * a clear pending state instead of pretending it already happened.
 */

export function useOrderList(filter: OrderFilterKey, q: string) {
  const { scope } = useSignedIn();
  return useInfiniteQuery({
    queryKey: qk.orders(scope, filter, q),
    queryFn: ({ pageParam }) => ordersApi.list(filter, q, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useOrder(id: string) {
  const { scope } = useSignedIn();
  return useQuery({ queryKey: qk.order(scope, id), queryFn: () => ordersApi.get(id), enabled: !!id });
}

/** A write the server refused because the order moved on — carries the latest version. */
export class OrderConflict extends Error {
  constructor(readonly current: OrderDetail, message: string) {
    super(message);
  }
}

export function useUpdateOrder(id: string) {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Omit<OrderUpdateRequest, "expectedUpdatedAt">) => {
      const current = qc.getQueryData<OrderDetail>(qk.order(scope, id));
      if (!current) throw new Error("Reload the order and try again.");
      try {
        return await ordersApi.update(id, { ...patch, expectedUpdatedAt: current.updatedAt });
      } catch (e) {
        if (e instanceof ApiError && e.code === "conflict" && e.details.current) {
          throw new OrderConflict(e.details.current as OrderDetail, e.message);
        }
        throw e;
      }
    },
    onSuccess: (order) => qc.setQueryData(qk.order(scope, id), order),
    onError: (e) => {
      // Show the admin what actually happened instead of their stale copy.
      if (e instanceof OrderConflict) qc.setQueryData(qk.order(scope, id), e.current);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.ordersAll(scope) });
      void qc.invalidateQueries({ queryKey: qk.dashboard(scope) });
    },
  });
}

export function useTrashOrder(id: string) {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.ordersAll(scope) });
    void qc.invalidateQueries({ queryKey: qk.dashboard(scope) });
  };
  const trash = useMutation({ mutationFn: () => ordersApi.trash(id), onSettled: invalidate });
  const restore = useMutation({
    mutationFn: () => ordersApi.restore(id),
    onSettled: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: qk.order(scope, id) });
    },
  });
  return { trash, restore };
}
