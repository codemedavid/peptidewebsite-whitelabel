import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { getPackagePayment } from "@/lib/platform/package-payment-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Get Started",
  description:
    "Tell us about your business and we'll build a branded, order-ready website for you — in a few simple steps.",
};

export default async function GetStartedPage() {
  // Operator-managed receiving accounts for the checkout step (Super Admin →
  // Checkout Payments), falling back to the marketing-config defaults.
  const packagePayment = await getPackagePayment();
  return <OnboardingWizard packagePayment={packagePayment} />;
}
