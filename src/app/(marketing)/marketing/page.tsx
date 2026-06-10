import { Hero } from "@/marketing/sections/Hero";
import { Problem } from "@/marketing/sections/Problem";
import { HiddenCost } from "@/marketing/sections/HiddenCost";
import { RealProblem } from "@/marketing/sections/RealProblem";
import { FutureVision } from "@/marketing/sections/FutureVision";
import { SystemIntro } from "@/marketing/sections/SystemIntro";
import { Features } from "@/marketing/sections/Features";
import { DemoWebsites } from "@/marketing/sections/DemoWebsites";
import { Pricing } from "@/marketing/sections/Pricing";
import { Testimonials } from "@/marketing/sections/Testimonials";
import { Faq } from "@/marketing/sections/Faq";
import { FinalCta } from "@/marketing/sections/FinalCta";

// Host-dependent (the layout guards on x-tenant-host), so never statically cache.
export const dynamic = "force-dynamic";

export default function MarketingHomePage() {
  return (
    <>
      <Hero />
      <Problem />
      <HiddenCost />
      <RealProblem />
      <FutureVision />
      <SystemIntro />
      <Features />
      <DemoWebsites />
      <Pricing />
      <Testimonials />
      <Faq />
      <FinalCta />
    </>
  );
}
