import { requirePlatformUser } from "@/lib/auth/session";

/**
 * Guards every tenant-management route (/admin/tenants/*). Kept here — not on the
 * admin root layout — so /admin/login stays reachable without a redirect loop.
 * No-op in demo mode; redirects logged-out operators to /login.
 */
export default async function TenantsAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePlatformUser();
  return <>{children}</>;
}
