import { getTenantId } from "@/lib/tenant/headers";
import { getTenantContext } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

export default async function DashboardOverview() {
  const tenantId = await getTenantId();
  const { tenant, features } = await getTenantContext(tenantId);

  return (
    <div>
      <h1 className="font-heading text-2xl font-bold">{tenant.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Plan: {tenant.plan.name} · {features.size} features enabled
      </p>
    </div>
  );
}
