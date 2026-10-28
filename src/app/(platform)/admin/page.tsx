import { requirePlatformUser } from "@/lib/auth/session";
import { getAttentionQueue, getPlatformOverview } from "@/lib/admin/data";
import { DashboardView } from "@/components/admin/pages/DashboardView";

export const dynamic = "force-dynamic";

/** Super Admin dashboard — platform-wide overview. Cross-tenant by design. */
export default async function AdminDashboardPage() {
  await requirePlatformUser(); // no-op in demo; bounces logged-out operators to /login
  const [data, queue] = await Promise.all([getPlatformOverview(), getAttentionQueue()]);
  return <DashboardView data={data} queue={queue} />;
}
