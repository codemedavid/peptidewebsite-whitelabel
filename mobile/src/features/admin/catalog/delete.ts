import { Alert } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { adminBridge, unwrap } from "@/features/admin/bridge";
import { useOnline } from "@/ui/feedback";
import { successTap } from "./components";
import { useAdminBrand, useCatalogRefresh } from "./hooks";
import { brandSymbol } from "./model";

/**
 * Delete one product, behind a confirm — the website's deleteProductsAction,
 * the same call Manage Products' trash button makes. The server refuses a
 * product linked to an order and that message is shown as-is.
 */
export function useDeleteProduct() {
  const online = useOnline();
  const brand = useAdminBrand().data;
  const refresh = useCatalogRefresh();
  const symbol = brand ? brandSymbol(brand) : "₱";

  const del = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await adminBridge.call<{ ok: true } | { error: string }>("deleteProductsAction", [id], symbol)),
    onSuccess: () => {
      successTap();
      refresh();
    },
    onError: (e) => Alert.alert("Couldn't delete", e.message),
  });

  function confirmDelete(id: string, name: string) {
    if (del.isPending) return;
    if (!online) {
      Alert.alert("You're offline", "Reconnect to delete. Nothing was changed.");
      return;
    }
    Alert.alert(`Delete “${name}”?`, "This removes it from your shop. It can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => del.mutate(id) },
    ]);
  }

  return { confirmDelete, isDeleting: del.isPending };
}
