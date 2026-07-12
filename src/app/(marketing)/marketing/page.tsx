import { Hero } from "@/marketing/sections/Hero";
import { Pain } from "@/marketing/sections/Pain";
import { Journey } from "@/marketing/sections/Journey";
import { Features } from "@/marketing/sections/Features";
import { Pricing } from "@/marketing/sections/Pricing";
import { Faq } from "@/marketing/sections/Faq";
import { FinalCta } from "@/marketing/sections/FinalCta";

// Host-dependent (the layout guards on x-tenant-host), so never statically cache.
export const dynamic = "force-dynamic";

export default function MarketingHomePage() {
  return (
    <>
      <Hero />
      <Pain />
      <Journey />
      <Features />
      <Pricing />
      <Faq />
      <FinalCta />
    </>
  );
}
