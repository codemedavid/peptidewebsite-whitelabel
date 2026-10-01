import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ordersApi, productsApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge } from "./bridge";
import { setupKeys } from "./setup/data";

/** Wait before warming the other tabs, so the first screen's own requests go first. */
const WARM_DELAY_MS = 600;

/**
 * Warms the tabs a store admin opens next (Orders, Products, More and the
 * store settings) right after sign-in or launch, so switching tabs shows data
 * instead of a skeleton. Only what this account may open; fresh cache
 * entries (staleTime) are not refetched.
 */
export function usePrefetchAdmin() {
  const qc = useQueryClient();
  const { me, scope } = useSignedIn();
  const { orders, products, inventory } = me.can;

  useEffect(() => {
    if (me.mode !== "admin") return;
    const id = setTimeout(() => {
      if (orders) {
        void qc.prefetchInfiniteQuery({
          queryKey: qk.orders(scope, "new", ""),
          queryFn: ({ pageParam }) => ordersApi.list("new", "", pageParam),
          initialPageParam: null as string | null,
        });
      }
      if (products || inventory) void qc.prefetchQuery({ queryKey: qk.products(scope), queryFn: productsApi.list });
      void qc.prefetchQuery({ queryKey: [scope, "admin", "menu"], queryFn: adminBridge.menu });
      void qc.prefetchQuery({ queryKey: setupKeys.brand(scope), queryFn: async () => (await adminBridge.brand()).brand });
    }, WARM_DELAY_MS);
    return () => clearTimeout(id);
  }, [qc, scope, me.mode, orders, products, inventory]);
}
