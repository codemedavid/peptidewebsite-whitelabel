import Link from "next/link";
import { getTenantSession } from "@/lib/auth/session";
import { signOutAction } from "@/actions/auth";

/**
 * Tenant backoffice. Guarded: only members of THIS tenant (resolved from the
 * host) may enter. Non-members / logged-out users are bounced.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getTenantSession();

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">
          You don’t have access to this dashboard.{" "}
          <Link href="/login" className="text-primary underline">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 w-60 border-r border-border p-6">
        <div className="mb-6 text-sm text-muted-foreground">
          <p>
            {session.email} · {session.role}
          </p>
          <form action={signOutAction.bind(null, "/login")} className="mt-1">
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
