import { Alert } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap } from "@/features/admin/bridge";
import { success } from "@/features/admin/setup/data";
import type { DashboardResult, GroupBuy, ListResult, ReportResult } from "./model";

/**
 * Group Buys through the admin bridge: every call runs the website's own
 * action from src/actions/group-buys.ts (requireGroupBuyAdmin re-checks the
 * module + each capability), so the app never decides what a round may do.
 *
 * Keys live under [scope, "admin"] so any admin save elsewhere refreshes them.
 */

export const gbKeys = {
  all: (scope: string) => [scope, "admin", "groupbuys"] as const,
  list: (scope: string) => [scope, "admin", "groupbuys", "list"] as const,
  dashboard: (scope: string, id: string) => [scope, "admin", "groupbuys", "dashboard", id] as const,
  report: (scope: string, id: string) => [scope, "admin", "groupbuys", "report", id] as const,
};

type Err = { error: string };

export function useGroupBuyList() {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: gbKeys.list(scope),
    queryFn: async () => unwrap(await adminBridge.call<ListResult | Err>("listGroupBuysAction")),
  });
}

/** One round's dashboard — uncached on the server, so a refetch picks up new orders. */
export function useGroupBuyDashboard(id: string) {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: gbKeys.dashboard(scope, id),
    enabled: !!id,
    queryFn: async () => unwrap(await adminBridge.call<DashboardResult | Err>("getGroupBuyDashboardAction", id)),
  });
}

export function useSupplierReport(id: string) {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: gbKeys.report(scope, id),
    enabled: !!id,
    queryFn: async () => unwrap(await adminBridge.call<ReportResult | Err>("getGroupBuySupplierReportAction", id)),
  });
}

/** Put a saved round into the cached list (new rounds first, like the website). */
export function useUpsertRound() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return (gb: GroupBuy) => {
    qc.setQueryData<ListResult>(gbKeys.list(scope), (cur) => {
      if (!cur) return cur;
      const exists = cur.groupBuys.some((x) => x.id === gb.id);
      return {
        ...cur,
        groupBuys: exists ? cur.groupBuys.map((x) => (x.id === gb.id ? gb : x)) : [gb, ...cur.groupBuys],
      };
    });
    // Row stats (orders, vials) are server-derived — refresh them in the background.
    void qc.invalidateQueries({ queryKey: gbKeys.all(scope) });
  };
}

/**
 * Run one round-level action (`saveGroupBuyAction`, `duplicateGroupBuyAction`,
 * `setGroupBuyArchivedAction`, `addOrderedProductsToRoundAction`) that answers
 * `{ ok, groupBuy }`, and fold the result into the list.
 */
export function useRoundAction(fn: string) {
  const upsert = useUpsertRound();
  return useMutation({
    mutationFn: async (args: unknown[]) =>
      unwrap(await adminBridge.call<{ ok: true; groupBuy: GroupBuy } | Err>(fn, ...args)).groupBuy,
    onSuccess: (gb) => {
      success();
      upsert(gb);
    },
  });
}

/** A store-wide Group Buy setting (on-hand toggle, ways to order, storefront copy). */
export function useGroupBuySetting<R>(fn: string) {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: unknown) => unwrap(await adminBridge.call<R | Err>(fn, payload)) as R,
    onSuccess: () => {
      success();
      // The brand carries these too (groupBuyAllowOnHand, twoWaysMode, groupBuyContent).
      void qc.invalidateQueries({ queryKey: [scope, "admin"] });
    },
    onError: (e) => Alert.alert("Couldn't save", e.message),
  });
}
