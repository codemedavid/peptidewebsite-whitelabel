import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode, getDemoContext, getDemoBranding, listDemoTenants } from "@/lib/demo/fixtures";
import { getEntitlements } from "@/lib/features/entitlements";
import { type FeatureKey } from "@/lib/features/catalog";
import { normalizeGroupBuySettings } from "@/lib/storefront/group-buy";
import { buildFeatureInventory } from "@/lib/tenant/feature-toggle";
import { planMeta } from "@/lib/admin/plans";
import { FeaturesEditor, type FeatureItem } from "@/components/admin/FeaturesEditor";
import { GroupBuySettingsCard } from "@/components/admin/GroupBuySettingsCard";

export const dynamic = "force-dynamic";

export default async function TenantFeaturesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let name: string;
  let planKey: string;
  let enabled: Set<FeatureKey>;
  let brandingConfig: Record<string, unknown>;

  if (isDemoMode()) {
    if (!listDemoTenants().some((t) => t.slug === slug)) notFound();
    const ctx = getDemoContext(slug);
    name = ctx.tenant.name;
    planKey = ctx.tenant.plan.key;
    enabled = ctx.features; // resolved Set<FeatureKey>
    brandingConfig = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
  } else {
    const t = await prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        plan: { select: { key: true } },
        branding: { select: { config: true } },
      },
    });
    if (!t) notFound();
    name = t.name;
    planKey = t.plan.key;
    enabled = await getEntitlements(t.id);
    brandingConfig = (t.branding?.config ?? {}) as Record<string, unknown>;
  }

  // One builder, shared with the MCP connector's feature tool, so the two answers
  // to "what's on for this tenant?" can never drift. It re-derives the same rows
  // this page used to build inline AND carries `dependsOn` — the master switch a
  // child is ANDed with — which the inline version dropped. Without it the screen
  // showed a child switched on above an off parent with no sign it was inert:
  // exactly how Nova Lab ended up with a reseller page that did not exist.
  const items: FeatureItem[] = buildFeatureInventory({ planKey, current: enabled }).groups.flatMap(
    (g) => g.features,
  );

  return <FeaturesEditor slug={slug} name={name} planLabel={planMeta(planKey).label} items={items} />;
}
