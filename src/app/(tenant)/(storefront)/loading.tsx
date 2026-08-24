import { BrandPageLoader } from "@/storefront/components/BrandPageLoader";

/**
 * Shown while the tenant's home/catalog data resolves (Suspense fallback).
 *
 * This used to be a grey skeleton — the exact generic chrome the brand splash
 * was built to replace, reappearing on every navigation after the first render.
 * BrandPageLoader takes no props by design: it inherits the tenant's mark and
 * colors from the --splash-* vars the storefront layout paints on its root,
 * which is the only channel a Suspense fallback has.
 */
export default function StorefrontLoading() {
  return <BrandPageLoader />;
}
