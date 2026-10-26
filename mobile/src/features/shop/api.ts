import type {
  GroupBuyJoinState,
  PlaceShopOrderRequest,
  PlaceShopOrderResponse,
  ShopCatalog,
  ShopOrdersResponse,
  ShopProofResponse,
  ShopQuote,
  ShopQuoteRequest,
} from "@shop-contract";
import { api, apiUpload, type UploadFile } from "@/api/client";

/**
 * /api/mobile/v1/shop/* (docs/mobile-admin/SHOP.md).
 *
 * `guest` = a signed-out phone browsing its linked store: the call goes out
 * WITHOUT a bearer token and names the store instead. Signed in, the session's
 * store wins and `store` is ignored by the server. `preview` = the store team
 * viewing their own shop (/admin/storefront — same catalog, admin session).
 */

export type ShopWho = { guest: true; store: string } | { guest: false; preview?: boolean };

export const shopApi = {
  catalog: (who: ShopWho) =>
    who.guest
      ? api<ShopCatalog>(`/shop/catalog?store=${encodeURIComponent(who.store)}`, { auth: false })
      : who.preview
        ? api<ShopCatalog>("/admin/storefront")
        : api<ShopCatalog>("/shop/catalog"),
  /** A quote writes nothing, so it's safe to retry on a dropped connection. */
  quote: (who: ShopWho, body: ShopQuoteRequest) =>
    who.guest
      ? api<ShopQuote>("/shop/quote", { method: "POST", body: { ...body, store: who.store }, auth: false, retryable: true })
      : api<ShopQuote>("/shop/quote", { method: "POST", body, retryable: true }),
  uploadProof: (file: UploadFile, signal?: AbortSignal) => apiUpload<ShopProofResponse>("/shop/proof", "file", file, signal),
  /** Idempotent on body.id, so a retry of the same attempt can't double-order. */
  placeOrder: (body: PlaceShopOrderRequest) =>
    api<PlaceShopOrderResponse>("/shop/orders", { method: "POST", body, retryable: true }),
  myOrders: () => api<ShopOrdersResponse>("/shop/orders"),
  /** Paid group-buy join (signed-in customers only). The fee is the server's. */
  groupBuyJoin: (roundId: string) => api<GroupBuyJoinState>(`/shop/group-buy/join?round=${encodeURIComponent(roundId)}`),
  /** Idempotent server-side: a live request comes back, never a second one. */
  startGroupBuyJoin: (roundId: string) => api<GroupBuyJoinState>("/shop/group-buy/join", { method: "POST", body: { roundId } }),
  sendGroupBuyReceipt: (roundId: string, fields: { reference: string; method: string }, file: UploadFile, signal?: AbortSignal) =>
    apiUpload<GroupBuyJoinState>("/shop/group-buy/receipt", "file", file, signal, { roundId, ...fields }),
  /** A 10-minute link to the shopper's own receipt. */
  groupBuyReceiptUrl: (roundId: string) => api<{ url: string }>(`/shop/group-buy/receipt?round=${encodeURIComponent(roundId)}`),
};

export const shopKeys = {
  all: (scope: string) => [scope, "shop"] as const,
  catalog: (scope: string) => [scope, "shop", "catalog"] as const,
  quote: (scope: string, body: ShopQuoteRequest) => [scope, "shop", "quote", JSON.stringify(body)] as const,
  myOrders: (scope: string) => [scope, "shop", "my-orders"] as const,
  groupBuyJoin: (scope: string, roundId: string) => [scope, "shop", "gb-join", roundId] as const,
};
