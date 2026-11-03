import { useMemo, useRef } from "react";
import { Alert } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap } from "@/features/admin/bridge";
import { useOnline } from "@/ui/feedback";
import { catalogKeys, useAdminBrand, useCatalogProducts } from "./hooks";
import { brandSymbol, moveProduct, moveStaysInCategory, productsFollowCategories, type CatalogProduct } from "./model";

/**
 * The shop's product order — the website's Admin → Products ↑/↓ arrangement.
 * Reads it from listProductsAction (already in the owner's order) and saves
 * with saveProductOrderAction into branding.config.productOrder, so the
 * website, the app and the storefront all show one order.
 *
 * Moves are optimistic and saved one after another (fast taps land in order);
 * a failed save re-reads the server's order instead of guessing a rollback.
 */
export function useProductArrangement() {
  const { scope } = useSignedIn();
  const online = useOnline();
  const qc = useQueryClient();
  const brand = useAdminBrand().data;
  const q = useCatalogProducts(brand);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const key = catalogKeys.products(scope, brand ? brandSymbol(brand) : "");

  const list = q.data;
  const rank = useMemo(() => new Map((list ?? []).map((p, i) => [p.id, i])), [list]);

  const follows = brand ? productsFollowCategories(brand) : false;

  function save(next: CatalogProduct[], ids: string[], reread = false) {
    qc.setQueryData(key, next);
    chain.current = chain.current
      .then(async () => {
        unwrap(await adminBridge.call<{ ok: true } | { error: string }>("saveProductOrderAction", ids));
        void qc.invalidateQueries({ queryKey: qk.products(scope) });
        // A reset under "Products follow this order" comes back grouped by
        // category from the server — re-read rather than re-derive it here.
        if (reread) void qc.invalidateQueries({ queryKey: key });
      })
      .catch((e: unknown) => {
        void qc.invalidateQueries({ queryKey: key });
        Alert.alert("Couldn't save the order", e instanceof Error ? e.message : "Please try again.");
      });
  }

  function move(id: string, delta: number) {
    if (!list) return;
    if (!online) {
      Alert.alert("You're offline", "Reconnect to arrange. Nothing was changed.");
      return;
    }
    if (follows && !moveStaysInCategory(list, id, delta)) {
      Alert.alert("Stays in its category", "Your products follow the category order. To move a whole category, change the order in Categories.");
      return;
    }
    const byId = new Map(list.map((p) => [p.id, p]));
    const ids = moveProduct(list.map((p) => p.id), id, delta);
    save(ids.map((x) => byId.get(x)).filter((p): p is CatalogProduct => !!p), ids);
  }

  function confirmReset() {
    if (!list || !online) return;
    Alert.alert("Reset to A–Z?", "Your shop goes back to alphabetical order.", [
      { text: "Cancel", style: "cancel" },
      { text: "Reset", style: "destructive", onPress: () => save([...list].sort((a, b) => a.name.localeCompare(b.name)), [], follows) },
    ]);
  }

  return { ready: !!list, count: list?.length ?? 0, rank, move, confirmReset };
}
