/**
 * Replace the FAQ for tenant `pepstack-davao` with the owner's authored
 * Shipping / Payment / Product groups.
 *
 * Read-modify-write into the shared `branding.config` blob (never clobbering
 * the rest of the Brand config), exactly like configure-peppertones-hero.ts.
 * Writing `faqGroups` replaces the seed defaults — the storefront only falls
 * back to SEED_FAQ_GROUPS when the key is absent. Content is passed through
 * normalizeFaqGroups (the same sanitizer used by saveFaqAction) so the stored
 * shape matches what the store-admin editor would have persisted.
 *
 * Run from the project root:
 *   npx tsx scripts/configure-pepstack-faq.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { normalizeFaqGroups } from "../src/lib/storefront/faq";
import type { FaqGroup } from "../src/storefront/types";

const prisma = new PrismaClient();

const TENANT_SLUG = "pepstack-davao";

const FAQ_GROUPS: FaqGroup[] = [
  {
    id: "shipping",
    label: "Shipping",
    icon: "shipping",
    items: [
      {
        q: "Where is the seller located?",
        a: "Our fulfillment center is based in Davao City, Philippines.",
      },
      {
        q: "Do you ship internationally or nationwide only?",
        a: "We currently ship nationwide within the Philippines via J&T Express only.",
      },
      {
        q: "Are your products on-hand?",
        a: "Yes. All products are on-hand unless stated otherwise.",
      },
      {
        q: "Are prices fixed?",
        a: "Prices may change without prior notice due to supplier pricing, shipping fees, and sourcing costs.",
      },
      {
        q: "Can I cancel or change my order after payment?",
        a: "Once your order has been confirmed and prepared for processing, cancellations or order changes are no longer allowed.",
      },
      {
        q: "What if my order arrives damaged, incomplete, or incorrect?",
        a: "Please contact us within 24 hours of receiving your order.\n\nTo help us review your concern, kindly provide:\n• Clear photos\n• A complete unboxing video (if available)",
      },
      {
        q: "Do you offer refunds or replacements after reconstitution?",
        a: "No. Products that become cloudy, gel, clump, become contaminated, or are damaged during or after reconstitution are not eligible for a refund or replacement.",
      },
      {
        q: "Do you offer meet-ups or local pick-up?",
        a: "No. At this time, we do not offer meet-ups or local pick-up. All orders are shipped via courier.",
      },
      {
        q: "When will my order be shipped?",
        a: "🚚 We offer next-business-day shipping for orders placed during our operating days.\n\nOrder Schedule\nMonday–Friday: Accepting orders\nSaturday–Sunday: Closed\n\nDaily Cut-off\n⏰ 4:00 PM – Order cut-off\n📦 5:00 PM – Packing begins\n\nOrders placed on weekends will be processed on the next business day (Monday).",
      },
      {
        q: "Do you accept rush orders?",
        a: "No. We do not accept rush orders.",
      },
      {
        q: "Can I track my order?",
        a: "Yes!\n\nJ&T tracking numbers are usually posted in our WhatsApp Channel approximately 5–8 hours after pickup.\n\nYou may also track your package using the Track Order page with your Order ID, found in your order confirmation.\n\nTracking numbers are made available as soon as they're released by the courier. Since I may not be able to message everyone individually, please use the Track Order page for the latest status.",
      },
      {
        q: "What if I entered the wrong shipping details?",
        a: "Please contact us as soon as possible.\n\nChanges can only be made before your order has been packed or shipped.",
      },
      {
        q: "What if my package is delayed?",
        a: "Once your package has been shipped, delivery times depend on the courier.\n\nDelays caused by weather, holidays, customs, courier operations, or other circumstances beyond our control are unfortunately outside our responsibility.",
      },
    ],
  },
  {
    id: "payment",
    label: "Payment",
    icon: "payment",
    items: [
      {
        q: "Do you offer Cash on Delivery (COD)?",
        a: "No. We do not offer Cash on Delivery (COD).",
      },
      {
        q: "Is payment secure?",
        a: "Yes. All payments are processed through secure and encrypted payment channels.",
      },
      {
        q: "What payment methods do you accept?",
        a: "We currently accept QR bank transfers via:\n• MariBank\n• GCash",
      },
    ],
  },
  {
    id: "product",
    label: "Product",
    icon: "product",
    items: [
      {
        q: "Why do vial cap colors sometimes differ?",
        a: "Vial cap colors may vary depending on manufacturing batch and supplier availability. Different cap colors do not automatically indicate a different product.",
      },
      {
        q: "Do you provide COAs?",
        a: "Certificates of Analysis (COAs) may be available for selected products when provided by the supplier or manufacturer.",
      },
      {
        q: "Are these FDA-approved?",
        a: "No.\n\nThe products offered on this site are sold as research compounds for in vitro/in vivo laboratory research only. They are not medications, are not FDA-approved, and are not intended for use in humans or animals.",
      },
      {
        q: "Do you provide medical advice?",
        a: "No.\n\nAny protocols, guides, or educational information shared are based on commonly referenced materials and personal experience. They are not intended to replace professional medical advice, diagnosis, or treatment.",
      },
      {
        q: "Do you have a partner doctor?",
        a: "No.\n\nWe do not work with a partner physician. If you need medical advice, we strongly recommend consulting a licensed healthcare professional in your area. Please exercise caution when seeking medical advice online.",
      },
      {
        q: "What is the shelf life of peptides?",
        a: "Lyophilized peptides\n• Typically remain stable for 24–48 months\n• Store in a cool, dry place, preferably refrigerated or frozen\n\nAfter reconstitution with bacteriostatic water\n• Best potency is maintained for approximately 4–5 weeks\n• Keep refrigerated\n• Always inspect the solution for proper color and clarity before use",
      },
      {
        q: "How quickly do you respond?",
        a: "I'm a full-time mom with a full-time job, so I may not always be able to reply immediately.\n\nTo help everyone get answers faster, I created a community where members can interact and assist one another.\n\n🕐 Typical reply time: 1:00 PM onwards\n\n📞 No calls, please.",
      },
    ],
  },
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const branding = await prisma.branding.findUnique({
    where: { tenantId: tenant.id },
    select: { config: true },
  });
  const current = (branding?.config ?? {}) as Record<string, unknown>;

  const previous = current.faqGroups;
  console.log(
    previous === undefined
      ? "Current FAQ: seed defaults (no faqGroups in branding.config)"
      : `Current FAQ: ${Array.isArray(previous) ? previous.length : "?"} custom group(s) — replacing`,
  );

  const config: Record<string, unknown> = {
    ...current,
    faqGroups: normalizeFaqGroups(FAQ_GROUPS),
  };

  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: { config: config as Prisma.InputJsonValue },
    create: { tenantId: tenant.id, config: config as Prisma.InputJsonValue },
  });

  const groups = config.faqGroups as FaqGroup[];
  for (const g of groups) console.log(`Saved group "${g.label}" (${g.items.length} items)`);
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
