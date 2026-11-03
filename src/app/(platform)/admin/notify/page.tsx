import { requirePlatformUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode } from "@/lib/demo/fixtures";
import { AdminBroadcastForm } from "@/components/admin/AdminBroadcastForm";

export const dynamic = "force-dynamic";

export default async function AppNotificationsPage() {
  await requirePlatformUser();
  const tenants = isDemoMode()
    ? []
    : await prisma.tenant.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } });
  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">App Notifications</h1>
          <p className="page-sub">
            Push a notice to store owners and staff signed in to the PepWorld app. Customers never receive these.
          </p>
        </div>
      </div>
      <AdminBroadcastForm tenants={tenants} />
    </div>
  );
}
