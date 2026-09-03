// Legacy product URL — retired in favour of the canonical share link /p/<slug>.
//
// This route used to render its own product page in the PRE-PORT design
// (`container` / `font-heading` / `text-accent`), which is nothing like the
// white-label storefront the tenant actually ships. Leaving it live meant two
// different-looking pages for the same product, and a customer sent the wrong
// one would see a store that isn't the store.
//
// It stays as a permanent redirect rather than being deleted so any link
// already in the wild — and anything a crawler indexed — still lands on the
// product. See scripts/test-product-link.ts.

import { permanentRedirect } from "next/navigation";

export default async function LegacyProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Re-encoded on the way out: `slug` arrives decoded, and the canonical route
  // parses its own segment with decodeURIComponent.
  permanentRedirect(`/p/${encodeURIComponent(slug)}`);
}
