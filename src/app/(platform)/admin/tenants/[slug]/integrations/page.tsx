import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode, getDemoContext, listDemoTenants } from "@/lib/demo/fixtures";
import { getEntitlements } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { getPostHogStatus } from "@/lib/integrations/store";
import { AdminIntegrations, type PostHogStatusView } from "@/components/admin/AdminIntegrations";

export const dynamic = "force-dynamic";

export default async function TenantIntegrationsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (isDemoMode()) {
    if (!listDemoTenants().some((t) => t.slug === slug)) notFound();
    const ctx = getDemoContext(slug);
    return (
      <AdminIntegrations
        slug={slug}
        name={ctx.tenant.name}
        entitled={ctx.features.has(FEATURES.ANALYTICS_POSTHOG)}
        status={null}
        demo
      />
    );
  }

  const t = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!t) notFound();

  const entitled = (await getEntitlements(t.id)).has(FEATURES.ANALYTICS_POSTHOG);
  const raw = await getPostHogStatus(t.id);
  // Serialize the Date for the client component boundary.
  const status: PostHogStatusView | null = raw
    ? { ...raw, lastHealthCheckAt: raw.lastHealthCheckAt ? raw.lastHealthCheckAt.toISOString() : null }
    : null;

  return <AdminIntegrations slug={slug} name={t.name} entitled={entitled} status={status} />;
}
