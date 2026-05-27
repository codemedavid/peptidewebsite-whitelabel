import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode, getDemoContext, listDemoTenants } from "@/lib/demo/fixtures";
import { getEntitlements } from "@/lib/features/entitlements";
import { ALL_FEATURES, FEATURE_META, planFeatureSet, type FeatureKey } from "@/lib/features/catalog";
import { planMeta } from "@/lib/admin/plans";
import { FeaturesEditor, type FeatureItem } from "@/components/admin/FeaturesEditor";

export const dynamic = "force-dynamic";

export default async function TenantFeaturesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let name: string;
  let planKey: string;
  let enabled: Set<FeatureKey>;

  if (isDemoMode()) {
    if (!listDemoTenants().some((t) => t.slug === slug)) notFound();
    const ctx = getDemoContext(slug);
    name = ctx.tenant.name;
    planKey = ctx.tenant.plan.key;
    enabled = ctx.features; // resolved Set<FeatureKey>
  } else {
    const t = await prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, name: true, plan: { select: { key: true } } },
    });
    if (!t) notFound();
    name = t.name;
    planKey = t.plan.key;
    enabled = await getEntitlements(t.id);
  }

  const ceiling = planFeatureSet(planKey);
  const items: FeatureItem[] = ALL_FEATURES.map((key) => ({
    key,
    label: FEATURE_META[key].label,
    description: FEATURE_META[key].description,
    group: FEATURE_META[key].group,
    lockedByPlan: !ceiling.has(key),
    enabled: enabled.has(key),
  }));

  return <FeaturesEditor slug={slug} name={name} planLabel={planMeta(planKey).label} items={items} />;
}
