import { headers } from "next/headers";
import "./admin.css";
import { isDemoMode } from "@/lib/demo/fixtures";
import { getPlatformUser } from "@/lib/auth/session";
import { listTenantNames } from "@/lib/admin/data";
import { AdminShell } from "@/components/admin/shell/AdminShell";

/**
 * Platform admin shell. Renders the immersive Super Admin chrome (sidebar +
 * topbar + create-tenant drawer) around every admin page — except /admin/login,
 * which renders bare so the sign-in screen isn't wrapped in the dashboard.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (pathname.endsWith("/login")) return <>{children}</>;

  const [operator, tenants] = await Promise.all([
    isDemoMode() ? Promise.resolve(null) : getPlatformUser(),
    listTenantNames(),
  ]);

  return (
    <AdminShell
      operatorEmail={operator?.email ?? (isDemoMode() ? "demo@platform" : null)}
      tenantCount={tenants.count}
      tenantNameBySlug={tenants.bySlug}
    >
      {children}
    </AdminShell>
  );
}
