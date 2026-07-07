import { requirePlatformUser } from "@/lib/auth/session";
import { getPlanDistribution } from "@/lib/admin/data";
import { getPlanConfig } from "@/lib/platform/plan-config-server";
import { getPlanFeatureConfig } from "@/lib/platform/plan-feature-config-server";
import { getFeatureRegistry } from "@/lib/platform/feature-registry-server";
import { effectiveNewFeatures } from "@/lib/platform/feature-registry";
import { PlansManager } from "@/components/admin/pages/PlansManager";
import { PlanFeaturesEditor } from "@/components/admin/pages/PlanFeaturesEditor";

export const dynamic = "force-dynamic";

export default async function PlansBillingPage() {
  await requirePlatformUser();
  const [{ rows, revenueCents, activeCount }, config, featureConfig, registry] = await Promise.all([
    getPlanDistribution(),
    getPlanConfig(),
    getPlanFeatureConfig(),
    getFeatureRegistry(),
  ]);
  const newFeatures = [...effectiveNewFeatures(registry)];

  return (
    <>
      <PlansManager
        initial={config}
        rows={rows}
        revenueCents={revenueCents}
        activeCount={activeCount}
        featureConfig={featureConfig}
      />
      <PlanFeaturesEditor initial={featureConfig} newFeatures={newFeatures} />
    </>
  );
}
