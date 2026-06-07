import { notFound } from "next/navigation";
import { getOnboardingSubmission } from "@/lib/admin/onboarding-data";
import { OnboardingDetail } from "@/components/admin/pages/OnboardingDetail";

// Guarded by onboarding/layout.tsx (requirePlatformUser).
export const dynamic = "force-dynamic";

export default async function OnboardingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const submission = await getOnboardingSubmission(id);
  if (!submission) notFound();
  return <OnboardingDetail submission={submission} />;
}
