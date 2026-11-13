"use client";

import { useEffect, useState } from "react";
import type { Product } from "../types";
import { findProductByLinkKey, parseProductHash, productHash } from "@/lib/storefront/product-link";

/**
 * The quick-view modal's open product + its shareable link, shared by every
 * catalog view (the classic grid and the category-sections page).
 *
 * Seeded on the FIRST render, not in an effect: effects don't run during SSR, so
 * resolving a shared /p/<slug> link there would ship the bare catalog and pop
 * the modal only after hydration. An unmatched key is a no-op — a link to a
 * since-hidden product just shows the catalog.
 */
export function useProductDetail(
  products: readonly Product[],
  openProductSlug: string | null | undefined,
): { selected: Product | null; openDetail: (p: Product) => void; closeDetail: () => void } {
  const [selected, setSelected] = useState<Product | null>(() =>
    openProductSlug ? findProductByLinkKey(products, openProductSlug) : null,
  );

  // Keeps the modal in step AFTER that first render: navigating from one product
  // link to another swaps it, and a `products` list that arrives later resolves.
  useEffect(() => {
    if (!openProductSlug) return;
    const target = findProductByLinkKey(products, openProductSlug);
    if (target) setSelected(target);
  }, [openProductSlug, products]);

  // `replaceState` rather than a hash assignment: assigning would push an entry
  // and fire `hashchange`, which the SPA router would treat as a navigation.
  const openDetail = (p: Product) => {
    setSelected(p);
    if (typeof window !== "undefined") window.history.replaceState(null, "", productHash(p));
  };
  const closeDetail = () => {
    setSelected(null);
    if (typeof window !== "undefined" && parseProductHash(window.location.hash)) {
      // Keep path + query so the catalog does not jump or reload.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  };

  return { selected, openDetail, closeDetail };
}
