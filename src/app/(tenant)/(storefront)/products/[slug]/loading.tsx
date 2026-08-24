import { BrandPageLoader } from "@/storefront/components/BrandPageLoader";

/** Streamed fallback while the product row resolves — the tenant's own loading
 *  screen rather than a generic skeleton. See ../../loading.tsx. */
export default function ProductLoading() {
  return <BrandPageLoader />;
}
