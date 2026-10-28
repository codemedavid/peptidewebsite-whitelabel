import { notFound } from "next/navigation";
import {
  getAdminTenantDetail,
  getTenantStoreAdminCredential,
  getTenantStoreSnapshot,
} from "@/lib/admin/data";
import { TenantDetailView } from "@/components/admin/pages/TenantDetailView";
import { parseTenantDetailTab } from "@/components/admin/pages/tenant-tabs";

// Guarded by tenants/layout.tsx (requirePlatformUser). The header + tab bar
// come from [slug]/layout.tsx; ?tab= picks the in-page view.
export const dynamic = "force-dynamic";

export default async function TenantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const [{ slug }, { tab }] = await Promise.all([params, searchParams]);
  const [tenant, signIn, snapshot] = await Promise.all([
    getAdminTenantDetail(slug),
    getTenantStoreAdminCredential(slug),
    getTenantStoreSnapshot(slug),
  ]);
  if (!tenant) notFound();
  return <TenantDetailView tenant={tenant} signIn={signIn} snapshot={snapshot} tab={parseTenantDetailTab(tab)} />;
}
