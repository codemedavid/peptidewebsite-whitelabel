import { listOnboardingSubmissions } from "@/lib/admin/onboarding-data";
import { OnboardingList } from "@/components/admin/pages/OnboardingList";

// Guarded by onboarding/layout.tsx (requirePlatformUser).
export const dynamic = "force-dynamic";

export default async function OnboardingListPage() {
  const submissions = await listOnboardingSubmissions();
  return <OnboardingList submissions={submissions} />;
}
