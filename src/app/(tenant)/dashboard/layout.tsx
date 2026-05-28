import Link from "next/link";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/session";
import { getTenantContext } from "@/lib/tenant/context";
import { signOutTenantAdminAction } from "@/actions/tenant-admin";

/**
 * Tenant backoffice. Guarded: only callers holding a valid tenant-admin cookie
 * for THIS tenant (resolved from the host) may enter. Anyone else is bounced
 * to /admin — the password-only login page.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getTenantSession();
  if (!session) redirect("/admin");

  const { tenant } = await getTenantContext(session.tenantId);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 w-60 border-r border-border p-6">
        <div className="mb-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{tenant.name}</p>
          <p className="text-xs">Admin</p>
          <form action={signOutTenantAdminAction} className="mt-1">
            <button type="submit" className="text-primary underline">
              Sign out
            </button>
          </form>
        </div>
        <nav className="flex flex-col gap-2 text-sm">
          <Link href="/dashboard">Overview</Link>
          <Link href="/dashboard/products">Products</Link>
          <Link href="/dashboard/orders">Orders</Link>
          <Link href="/dashboard/pages">Pages</Link>
          <Link href="/dashboard/branding">Branding</Link>
          <Link href="/dashboard/features">Features</Link>
          <Link href="/dashboard/domains">Domains</Link>
        </nav>
      </aside>
      <div className="ml-60 p-8">{children}</div>
    </div>
  );
}
