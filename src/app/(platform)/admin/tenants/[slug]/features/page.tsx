import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode, getDemoContext, listDemoTenants } from "@/lib/demo/fixtures";
import { getEntitlements } from "@/lib/features/entitlements";
import { ALL_FEATURES, FEATURE_META, OPERATOR_GRANTABLE, planFeatureSet, type FeatureKey } from "@/lib/features/catalog";
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
  // Lowest tier whose ceiling includes the feature — shown on locked rows.
  const tiers = ["starter", "pro", "enterprise"].map((t) => [t, planFeatureSet(t)] as const);
  const requiredPlan = (key: FeatureKey) => tiers.find(([, set]) => set.has(key))?.[0];
  const items: FeatureItem[] = ALL_FEATURES.map((key) => {
    const lockedByPlan = !ceiling.has(key) && !OPERATOR_GRANTABLE.has(key);
    const req = lockedByPlan ? requiredPlan(key) : undefined;
    return {
      key,
      label: FEATURE_META[key].label,
      description: FEATURE_META[key].description,
      group: FEATURE_META[key].group,
      // Operator-grantable features sit outside every plan (default OFF) but are
      // never plan-locked — the operator can switch them on for any tenant.
      lockedByPlan,
      requiredPlanLabel: req ? planMeta(req).label : null,
      enabled: enabled.has(key),
    };
  });

  return <FeaturesEditor slug={slug} name={name} planLabel={planMeta(planKey).label} items={items} />;
}
