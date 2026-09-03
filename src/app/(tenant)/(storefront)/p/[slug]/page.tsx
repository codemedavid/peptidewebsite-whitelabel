// Per-product share link: https://<tenant-host>/p/<slug>
//
// This route exists for ONE reason a hash link cannot serve: a URL fragment is
// never sent to the server, so `#p/<slug>` pasted into Messenger/Viber previews
// as the bare store name with no photo. A real route can answer the crawler with
// the product's own image, name and price — which is the entire point of a link
// an owner sends to a customer.
//
// It deliberately does NOT render a product page of its own. The body is the
// real storefront home, handed the product key so the quick-view opens on the
// first paint. That keeps a shared link on the tenant's own design, header,
// cart and home layout, and means this route can never drift from the catalog
// the way the legacy /products/[slug] page did.
//
// Covered by scripts/test-product-link.ts.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getTenantId, getTenantIdOrNull } from "@/lib/tenant/headers";
import { getTenantContext } from "@/lib/tenant/context";
import { withTenant } from "@/lib/db/tenant-client";
import { isDemoMode, findDemoProduct } from "@/lib/demo/fixtures";
import { imageUrl } from "@/lib/media/image-url";
import {
  normalizeDefaultProductImage,
  resolveProductImage,
} from "@/lib/storefront/product-image";
import { formatPrice } from "@/lib/utils";
import { StorefrontHome } from "../../storefront-home";

/** Facebook/WhatsApp render link previews around a 1.91:1 card. */
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

/** The columns the preview needs — deliberately not the whole row. */
type PreviewProduct = {
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  images: unknown;
};

/**
 * Resolve the link key to a product, tenant-scoped.
 *
 * Matched on slug OR id, in that order, because `Product.slug` is nullable and
 * is only generated on the create path — a bulk-imported catalog links by id
 * until the backfill runs, and those links must keep working afterwards.
 */
async function loadProduct(
  tenantId: string,
  key: string,
): Promise<PreviewProduct | null> {
  if (isDemoMode()) {
    return (findDemoProduct(tenantId, key) as PreviewProduct | null) ?? null;
  }
  // withTenant sets the RLS GUC so this read works under the app role; the
  // tenant-scoped client forces tenantId, so neither leg can cross tenants.
  return withTenant(tenantId, (db) =>
    db.product.findFirst({
      where: { status: "active", OR: [{ slug: key }, { id: key }] },
      select: {
        name: true,
        description: true,
        priceCents: true,
        currency: true,
        images: true,
      },
    }),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return { title: "Store not found" };

  const product = await loadProduct(tenantId, decodeURIComponent(slug));
  // No product: say nothing specific and let the page's notFound() answer. A
  // fabricated title here would preview a product that isn't there.
  if (!product) return {};

  const { tenant, branding, settings } = await getTenantContext(tenantId);
  const storeName = settings?.storeName ?? tenant.name;
  const config = (branding?.config ?? {}) as { defaultProductImage?: unknown };
  const defaultImage = normalizeDefaultProductImage(config.defaultProductImage);

  const images = Array.isArray(product.images) ? (product.images as string[]) : [];
  const photo = resolveProductImage(images[0], defaultImage);

  // Price leads the description: it is the question a customer opens the link
  // to answer, and the preview card is often all they read.
  const price = formatPrice(product.priceCents, product.currency);
  const blurb = (product.description ?? "").trim().replace(/\s+/g, " ");
  const description = blurb ? `${price} · ${blurb}` : `${price} · ${storeName}`;

  return {
    // The layout's template appends the store name, so the tab and the preview
    // both read "<product> · <store>".
    title: product.name,
    description,
    openGraph: {
      title: `${product.name} · ${storeName}`,
      description,
      type: "website",
      siteName: storeName,
      // Sized through ImageKit rather than shipping the original: a 2000px
      // product photo is refused outright by some scrapers, and every one of
      // them re-fetches this URL on each share.
      images: photo
        ? [{ url: imageUrl(photo, { width: OG_WIDTH }), width: OG_WIDTH, height: OG_HEIGHT, alt: product.name }]
        : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: `${product.name} · ${storeName}`,
      description,
      images: photo ? [imageUrl(photo, { width: OG_WIDTH })] : undefined,
    },
  };
}

export default async function SharedProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const key = decodeURIComponent(slug);
  const tenantId = await getTenantId();

  // 404 an unknown product rather than silently serving the plain home: a dead
  // link should tell the owner it is dead, not look like it worked.
  //
  // Deliberately NOT behind requireFeaturePage(SITE_PRODUCTS). That entitlement
  // gates the legacy catalog pages; every storefront has products, and gating
  // share links on it would 404 them for most tenants.
  const product = await loadProduct(tenantId, key);
  if (!product) notFound();

  return <StorefrontHome initialProduct={key} />;
}
