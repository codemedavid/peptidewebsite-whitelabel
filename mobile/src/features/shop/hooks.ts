import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlaceShopOrderRequest, ShopCatalog, ShopOrdersResponse, ShopQuoteRequest } from "@shop-contract";
import type { UploadFile } from "@/api/client";
import { shopApi, shopKeys } from "./api";
import { reconcileCart, type CartRow } from "./lib/cart";
import { useShop } from "./ShopProvider";

const CATALOG_STALE_MS = 60_000;
const QUOTE_DEBOUNCE_MS = 450;

/** The shop's catalog for whoever is shopping (guest → ?store=, customer → session). */
export function useCatalog() {
  const { scope, who, mode } = useShop();
  return useQuery({
    queryKey: shopKeys.catalog(scope),
    queryFn: () => shopApi.catalog(who),
    enabled: mode !== "off",
    staleTime: CATALOG_STALE_MS,
  });
}

/**
 * The cart matched to the catalog. Lines over the stock left are shown (and
 * sent) clamped, with a note; the saved cart keeps what the shopper chose, so
 * a restock doesn't silently lose their quantity.
 */
export function useCartRows(catalog: ShopCatalog | undefined): CartRow[] {
  const { lines } = useShop();
  return useMemo(() => (catalog ? reconcileCart(lines, catalog).rows : []), [catalog, lines]);
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * The server's live quote for a request (debounced while the shopper taps a
 * stepper). Keeps showing the last good quote while the next one loads;
 * `isStale` says the numbers on screen are for an older request.
 */
export function useQuote(body: ShopQuoteRequest | null) {
  const { scope, who, mode } = useShop();
  const key = body ? JSON.stringify(body) : "";
  const debouncedKey = useDebounced(key, QUOTE_DEBOUNCE_MS);
  const request = useMemo(() => (debouncedKey ? (JSON.parse(debouncedKey) as ShopQuoteRequest) : null), [debouncedKey]);
  const q = useQuery({
    queryKey: shopKeys.quote(scope, request ?? { lines: [] }),
    queryFn: () => shopApi.quote(who, request as ShopQuoteRequest),
    enabled: mode !== "off" && !!request && request.lines.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 60_000,
  });
  const isStale = key !== debouncedKey || q.isFetching || q.isPlaceholderData;
  return { ...q, isStale };
}

export function useMyOrders() {
  const { scope, mode } = useShop();
  return useQuery({
    queryKey: shopKeys.myOrders(scope),
    queryFn: shopApi.myOrders,
    enabled: mode === "customer",
  });
}

export function usePlaceOrder() {
  const { scope } = useShop();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PlaceShopOrderRequest) => shopApi.placeOrder(body),
    onSuccess: ({ order }) => {
      // Show it in My orders straight away (the refetch confirms it).
      qc.setQueryData<ShopOrdersResponse>(shopKeys.myOrders(scope), (prev) => ({
        orders: [order, ...(prev?.orders ?? []).filter((o) => o.orderNumber !== order.orderNumber)],
      }));
      void qc.invalidateQueries({ queryKey: shopKeys.myOrders(scope) });
      // Stock just moved.
      void qc.invalidateQueries({ queryKey: shopKeys.catalog(scope) });
    },
  });
}

export function useUploadProof() {
  return useMutation({
    mutationFn: ({ file, signal }: { file: UploadFile; signal?: AbortSignal }) => shopApi.uploadProof(file, signal),
  });
}
