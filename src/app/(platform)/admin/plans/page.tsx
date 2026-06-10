import { requirePlatformUser } from "@/lib/auth/session";
import { getPlanDistribution } from "@/lib/admin/data";
import { getPlanConfig } from "@/lib/platform/plan-config-server";
import { PlansManager } from "@/components/admin/pages/PlansManager";

export const dynamic = "force-dynamic";

export default async function PlansBillingPage() {
  await requirePlatformUser();
  const [{ rows, mrrCents, arrCents, activeCount }, config] = await Promise.all([
    getPlanDistribution(),
    getPlanConfig(),
  ]);

  return (
    <PlansManager
      initial={config}
      rows={rows}
      mrrCents={mrrCents}
      arrCents={arrCents}
      activeCount={activeCount}
    />
  );
}
