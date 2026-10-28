import { cookies, headers } from "next/headers";
import "./admin.css";
import { isDemoMode } from "@/lib/demo/fixtures";
import { getPlatformUser } from "@/lib/auth/session";
import { getAttentionQueue, listTenantNames } from "@/lib/admin/data";
import { getPlanConfig } from "@/lib/platform/plan-config-server";
import { AdminShell } from "@/components/admin/shell/AdminShell";
import { COLLAPSED_COOKIE, THEME_COOKIE, parseShellPrefs } from "@/components/admin/shell/shell-prefs";

/**
 * Platform admin shell. Renders the immersive Super Admin chrome (sidebar +
 * topbar + create-tenant drawer) around every admin page — except /admin/login,
 * which renders bare so the sign-in screen isn't wrapped in the dashboard.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (pathname.endsWith("/login")) return <>{children}</>;

  const jar = await cookies();
  const prefs = parseShellPrefs(jar.get(THEME_COOKIE)?.value, jar.get(COLLAPSED_COOKIE)?.value);
  const [operator, tenants, planConfig, attention] = await Promise.all([
    isDemoMode() ? Promise.resolve(null) : getPlatformUser(),
    listTenantNames(),
    getPlanConfig(),
    getAttentionQueue(),
  ]);

  return (
    <AdminShell
      operatorEmail={operator?.email ?? (isDemoMode() ? "demo@platform" : null)}
      tenantNameBySlug={tenants.bySlug}
      planCards={planConfig.plans}
      attention={{ onboarding: attention.onboarding.count, upgrades: attention.upgrades.count }}
      initialPrefs={prefs}
    >
      {children}
    </AdminShell>
  );
}
