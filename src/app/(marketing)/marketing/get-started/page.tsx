import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Get Started",
  description:
    "Tell us about your business and we'll build a branded, order-ready website for you — in a few simple steps.",
};

export default function GetStartedPage() {
  return <OnboardingWizard />;
}
