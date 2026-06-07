import { Hero } from "@/marketing/sections/Hero";
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
      <Features />
      <DemoWebsites />
      <Pricing />
      <Testimonials />
      <Faq />
      <FinalCta />
    </>
  );
}
