import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode, getDemoContext, listDemoTenants } from "@/lib/demo/fixtures";
import { getEntitlements } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { getPostHogStatus } from "@/lib/integrations/store";
import { AdminIntegrations, type PostHogStatusView } from "@/components/admin/AdminIntegrations";
import { AdminTelegramBot } from "@/components/admin/AdminTelegramBot";

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
      <>
        <AdminIntegrations
          slug={slug}
          name={ctx.tenant.name}
          entitled={ctx.features.has(FEATURES.ANALYTICS_POSTHOG)}
          status={null}
          demo
        />
        {/* The Telegram order bot is operator-managed too — same page, its own
            credential and its own entitlement. */}
        <AdminTelegramBot slug={slug} entitled={false} demo />
      </>
    );
  }

  const t = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!t) notFound();

  const features = await getEntitlements(t.id);
  const entitled = features.has(FEATURES.ANALYTICS_POSTHOG);
  const telegramEntitled = features.has(FEATURES.NOTIFY_TELEGRAM);
  const raw = await getPostHogStatus(t.id);
  // Serialize the Date for the client component boundary.
  const status: PostHogStatusView | null = raw
    ? { ...raw, lastHealthCheckAt: raw.lastHealthCheckAt ? raw.lastHealthCheckAt.toISOString() : null }
    : null;

  return (
    <>
      <AdminIntegrations slug={slug} name={t.name} entitled={entitled} status={status} />
      {/* Telegram order bot: the tenant's own @BotFather bot, the chats that
          receive orders, and the alerts switch. Operator-only by design — the
          token can post as the store and the webhook points at this deployment. */}
      <AdminTelegramBot slug={slug} entitled={telegramEntitled} />
    </>
  );
}
