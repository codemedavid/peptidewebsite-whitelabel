import { notFound } from "next/navigation";
import { getTenantHeader } from "@/lib/admin/data";
import { TenantWorkspaceHeader } from "@/components/admin/pages/TenantWorkspaceHeader";

// One workspace for every tenant page: the header + tab bar stay mounted while
// the operator moves between Overview, Branding, Features, Settings, etc. Auth
// is enforced by the parent tenants/layout.tsx (requirePlatformUser).
export default async function TenantWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await getTenantHeader(slug);
  if (!tenant) notFound();
  return (
    <div className="page-inner tw">
      <TenantWorkspaceHeader tenant={tenant} />
      <div className="tw-body">{children}</div>
    </div>
  );
}
