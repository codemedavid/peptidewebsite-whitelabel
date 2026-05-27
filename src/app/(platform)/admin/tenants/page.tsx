import { listAdminTenants } from "@/lib/admin/data";
import { TenantsTable } from "@/components/admin/pages/TenantsTable";

// Guarded by tenants/layout.tsx (requirePlatformUser).
export const dynamic = "force-dynamic";

export default async function TenantsListPage() {
  const tenants = await listAdminTenants();
  return <TenantsTable tenants={tenants} />;
}
