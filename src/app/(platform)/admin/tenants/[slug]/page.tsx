import { notFound } from "next/navigation";
import { getAdminTenantDetail } from "@/lib/admin/data";
import { TenantDetailView } from "@/components/admin/pages/TenantDetailView";

// Guarded by tenants/layout.tsx (requirePlatformUser).
export const dynamic = "force-dynamic";

export default async function TenantDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await getAdminTenantDetail(slug);
  if (!tenant) notFound();
  return <TenantDetailView tenant={tenant} />;
}
