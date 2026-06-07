import { requirePlatformUser } from "@/lib/auth/session";

/**
 * Guards every onboarding-management route (/admin/onboarding/*). Mirrors
 * tenants/layout.tsx — kept separate so /admin/login stays reachable.
 */
export default async function OnboardingAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePlatformUser();
  return <>{children}</>;
}
