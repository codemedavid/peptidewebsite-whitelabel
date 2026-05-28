import { redirect } from "next/navigation";
import { readTenantAdminCookie } from "@/lib/auth/tenant-admin";
import { getTenantIdOrNull } from "@/lib/tenant/headers";
import { TenantAdminLoginForm } from "@/components/auth/TenantAdminLoginForm";

export const dynamic = "force-dynamic";

/**
 * Password-only tenant admin login. Reached at <slug>.<root>/admin — middleware
 * rewrites /admin → /tenant-admin on tenant hosts so the public URL stays clean
 * (the /admin route slot is owned by the platform Super Admin under (platform)).
 */
export default async function TenantAdminPage() {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <p className="text-sm text-muted-foreground">
          This site isn&apos;t connected to a tenant.
        </p>
      </main>
    );
  }

  const session = await readTenantAdminCookie();
  if (session?.tenantId === tenantId) redirect("/dashboard");

  return <TenantAdminLoginForm />;
}
