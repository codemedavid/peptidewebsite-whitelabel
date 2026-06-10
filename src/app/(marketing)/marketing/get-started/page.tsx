import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { getPackagePayment } from "@/lib/platform/package-payment-server";
import { getPlanConfig } from "@/lib/platform/plan-config-server";
import { packagesFrom } from "@/marketing/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Get Started",
  description:
    "Tell us about your business and we'll build a branded, order-ready website for you — in a few simple steps.",
};

export default async function GetStartedPage() {
  // Operator-managed receiving accounts (Super Admin → Checkout Payments) and
  // plan pricing/features (Super Admin → Plans & Billing), falling back to the
  // marketing-config defaults.
  const [packagePayment, planConfig] = await Promise.all([getPackagePayment(), getPlanConfig()]);
  return <OnboardingWizard packagePayment={packagePayment} packages={packagesFrom(planConfig.plans)} />;
}
