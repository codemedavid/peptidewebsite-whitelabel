import { notFound } from "next/navigation";
import { isDemoMode, getDemoContext, listDemoTenants } from "@/lib/demo/fixtures";
import type { Brand } from "@/storefront/types";
import { BrandingEditor } from "@/components/admin/BrandingEditor";
import { requirePlatformUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function TenantBrandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requirePlatformUser(); // no-op in demo; redirects logged-out operators
  const { slug } = await params;

  if (!isDemoMode()) {
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      select: { name: true, branding: true },
    });
    if (!tenant) notFound();

    const b = tenant.branding;
    const config = (b?.config ?? {}) as Partial<Brand>;
    // Hero typography now lives on the storefront Brand config (branding.config),
    // so the editor reads it from initialConfig — no separate hero prop needed.
    return (
      <BrandingEditor
        slug={slug}
        name={tenant.name}
        initialThemeId={b?.themeId ?? "clinical-white"}
        initialColors={(b?.colors ?? {}) as Record<string, string>}
        initialFonts={(b?.fonts ?? {}) as { heading?: string; body?: string }}
        initialLogoUrl={b?.logoUrl ?? null}
        initialFaviconUrl={b?.faviconUrl ?? null}
        initialConfig={config}
      />
    );
  }

  if (!listDemoTenants().some((t) => t.slug === slug)) notFound();

  const ctx = getDemoContext(slug);
  return (
    <BrandingEditor
      slug={slug}
      name={ctx.tenant.name}
      initialThemeId={ctx.branding.themeId}
      initialColors={(ctx.branding.colors ?? {}) as Record<string, string>}
      initialFonts={(ctx.branding.fonts ?? {}) as { heading?: string; body?: string }}
      initialLogoUrl={ctx.branding.logoUrl}
      initialFaviconUrl={ctx.branding.faviconUrl}
      initialConfig={(ctx.branding.config ?? {}) as Partial<Brand>}
    />
  );
}
