import { Hero } from "@/marketing/sections/Hero";
import { Pricing } from "@/marketing/sections/Pricing";
import { WhyMonthly } from "@/marketing/sections/WhyMonthly";
import { PlanComparison } from "@/marketing/sections/PlanComparison";
import { WhyPepweb } from "@/marketing/sections/WhyPepweb";
import { Faq } from "@/marketing/sections/Faq";
import { FinalCta } from "@/marketing/sections/FinalCta";

// Host-dependent (the layout guards on x-tenant-host), so never statically cache.
export const dynamic = "force-dynamic";

export default function MarketingHomePage() {
  return (
    <>
      <Hero />
      <Pricing />
      <WhyMonthly />
      <PlanComparison />
      <WhyPepweb />
      <Faq />
      <FinalCta />
    </>
  );
}
