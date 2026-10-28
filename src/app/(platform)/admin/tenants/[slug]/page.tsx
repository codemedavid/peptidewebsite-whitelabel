import { notFound } from "next/navigation";
import {
  getAdminTenantDetail,
  getTenantStoreAdminCredential,
  getTenantStoreSnapshot,
} from "@/lib/admin/data";
import { TenantDetailView } from "@/components/admin/pages/TenantDetailView";

// Guarded by tenants/layout.tsx (requirePlatformUser).
export const dynamic = "force-dynamic";

export default async function TenantDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [tenant, signIn, snapshot] = await Promise.all([
    getAdminTenantDetail(slug),
    getTenantStoreAdminCredential(slug),
    getTenantStoreSnapshot(slug),
  ]);
  if (!tenant) notFound();
  return <TenantDetailView tenant={tenant} signIn={signIn} snapshot={snapshot} />;
}
