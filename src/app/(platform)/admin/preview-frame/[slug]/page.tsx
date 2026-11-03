// The branding editor's LIVE PREVIEW frame: the tenant's real storefront,
// rendered inside an <iframe> and fed the editor's unsaved draft by
// postMessage (components/admin/preview/PreviewFrame).
//
// Why a frame and not an in-page render: inside an iframe the storefront gets
// its own viewport (every @media / @container breakpoint fires at the device
// width the operator picked), its own hash router (any page can be browsed),
// and none of the admin's styles. It starts from the SAME server-resolved
// Brand + catalog the live site renders (loadStorefrontBrand), so what the
// operator sees is the store, plus their edits.
//
// Operator-only. Read-only: nothing here writes, and the frame's checkout is
// switched off (Brand.checkoutPreviewOnly).

import { notFound } from "next/navigation";
import { requirePlatformUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode, getDemoContext, listDemoTenants } from "@/lib/demo/fixtures";
import { loadStorefrontBrand } from "@/lib/storefront/storefront-brand";
import { ADMIN_VIEWER } from "@/lib/storefront/gb-access.server";
import { PreviewFrame } from "@/components/admin/preview/PreviewFrame";
import "@/storefront/storefront.css";
import "@/storefront/boutique.css";
import "@/storefront/editorial.css";
import "@/storefront/showcase.css";
import "@/storefront/section-background.css";
import "@/storefront/intl-local.css";

export const dynamic = "force-dynamic";

export default async function PreviewFramePage({ params }: { params: Promise<{ slug: string }> }) {
  await requirePlatformUser();
  const { slug } = await params;
  if (!/^[a-z0-9-]{2,}$/.test(slug)) notFound();

  let tenantId: string;
  if (isDemoMode()) {
    if (!listDemoTenants().some((t) => t.slug === slug)) notFound();
    tenantId = getDemoContext(slug).tenant.id;
  } else {
    const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!tenant) notFound();
    tenantId = tenant.id;
  }

  const { brand, products } = await loadStorefrontBrand({
    tenantId,
    slug,
    // The operator is no reseller and is viewing as the store's admin.
    isResellerUnlocked: async () => false,
    groupBuyViewer: async () => ADMIN_VIEWER,
  });

  return <PreviewFrame base={brand} products={products} tenantKey={`preview-${tenantId}`} />;
}
