"use client";

import type { Brand } from "../types";
import { buildStoreClosedNotice, isStoreClosed } from "@/lib/storefront/store-status";

/**
 * The banner a shopper sees while the owner has the shop closed
 * (store admin → Store Status).
 *
 * Deliberately a BANNER, not a takeover: the catalog below it stays browsable
 * with every price on show, so someone who arrives mid-restock can still see
 * what the store sells and decide to come back. Only the buying stops — every
 * buy control reads "Closed" (buildProductCta), the cart refuses the add
 * (store.addToCart) and the server refuses the order (placeStorefrontOrderAction).
 *
 * Not to be confused with ./StorePaused, which DOES replace the whole storefront
 * — that one is the operator's trial-expiry lever, not the owner's.
 *
 * Renders nothing at all when the store is open, so an open tenant's markup is
 * byte-identical to what it was before this feature existed.
 */
export function StoreClosedNotice({ brand }: { brand: Brand }) {
  if (!isStoreClosed(brand.storeStatus)) return null;

  // The headline names the business ("Hello — HP Glow is currently closed")
  // unless the owner wrote their own. The message is optional.
  const { headline, message } = buildStoreClosedNotice(brand.storeStatus, brand.name);

  return (
    // role="status" (not "alert"): this is a standing condition of the page, not
    // something that just happened to the shopper. Screen readers announce it
    // without interrupting.
    <aside className="sf-closed" role="status" aria-label="Store status">
      <div className="sf-closed__inner">
        <span className="sf-closed__badge" aria-hidden="true">
          Closed
        </span>
        <div className="sf-closed__copy">
          <p className="sf-closed__headline">{headline}</p>
          {message && <p className="sf-closed__message">{message}</p>}
        </div>
      </div>
    </aside>
  );
}
