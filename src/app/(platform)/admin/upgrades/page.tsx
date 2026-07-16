import { requirePlatformUser } from "@/lib/auth/session";
import { listUpgradeRequestsAction } from "@/actions/admin-upgrades";
import { UpgradeRequestsManager } from "@/components/admin/pages/UpgradeRequestsManager";

export const dynamic = "force-dynamic";

export default async function UpgradeRequestsPage() {
  await requirePlatformUser();
  const result = await listUpgradeRequestsAction();
  const rows = "rows" in result ? result.rows : [];
  const loadError = "error" in result ? result.error : undefined;
  return <UpgradeRequestsManager initial={rows} loadError={loadError} />;
}
