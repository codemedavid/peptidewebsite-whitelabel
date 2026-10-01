import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap, type AdminBrand } from "@/features/admin/bridge";
import { brandSymbol, type CatalogProduct } from "./model";

/**
 * Catalog data through the admin bridge: the website's own `brand` projection
 * and its own product list (listProductsAction), so every screen here starts
 * from exactly what the website admin would render.
 */

export const catalogKeys = {
  /** Everything the website-admin bridge caches for a store. */
  admin: (scope: string) => [scope, "admin"] as const,
  brand: (scope: string) => [scope, "admin", "brand"] as const,
  products: (scope: string, symbol: string) => [scope, "admin", "products", symbol] as const,
};

export function useAdminBrand() {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: catalogKeys.brand(scope),
    queryFn: async () => (await adminBridge.brand()).brand,
  });
}

type ListResult = { ok: true; products: CatalogProduct[] } | { error: string };

/** listProductsAction(brand.currency || "₱") — waits for the brand, like the website. */
export function useCatalogProducts(brand: AdminBrand | undefined) {
  const { scope } = useSignedIn();
  const symbol = brand ? brandSymbol(brand) : "";
  return useQuery({
    queryKey: catalogKeys.products(scope, symbol),
    enabled: !!brand,
    queryFn: async () => unwrap(await adminBridge.call<ListResult>("listProductsAction", symbol)).products,
  });
}

/**
 * After a catalog write: refetch the bridge caches (brand, products) and the
 * app's own catalog, dashboard and insights, which read the same rows.
 */
export function useCatalogRefresh() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return (opts?: { everything?: boolean }) => {
    if (opts?.everything) return void qc.invalidateQueries({ queryKey: qk.scope(scope) });
    void qc.invalidateQueries({ queryKey: catalogKeys.admin(scope) });
    void qc.invalidateQueries({ queryKey: qk.products(scope) });
    void qc.invalidateQueries({ queryKey: qk.dashboard(scope) });
    void qc.invalidateQueries({ queryKey: qk.insightsAll(scope) });
  };
}
