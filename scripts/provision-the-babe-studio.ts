/**
 * Provision the tenant "The Babe Studio" (operator-side intake).
 *
 * Same shape the self-serve /get-started flow produces — it runs the real
 * onboarding schema + `buildProvisioning` mapping rather than hand-rolling a
 * branding blob, so the store lands byte-identical to a wizard sign-up:
 * tenant + branding + settings + products + an OnboardingSubmission record the
 * operator can publish from Super Admin → Onboarding.
 *
 * Client brief (2026-07-31):
 *   Business      The Babe Studio — peptides
 *   Contact       Kaye Delos Reyes, WhatsApp +63 949 613 3242
 *   Branding      #0b0d14 midnight · #cdafa0 rose gold · #c08d7a copper rose
 *   Products      Tirzepatide, GHK-Cu, NAD+, Semax, Selank (no prices yet)
 *   Package       Automated (enterprise), prepaid YEARLY
 *
 * Two deliberate choices, both reversible from the admin console:
 *   • status "pending_setup" — the store stays dark (gate.ts → /unknown-tenant)
 *     until the operator publishes it. The catalog is unpriced and there is no
 *     logo yet, so it must not be reachable.
 *   • products created as DRAFT (status "draft", active false) — the brief has
 *     no prices, and a live ₱0 product is worse than no product. The owner
 *     prices them in store admin and flips them live.
 *
 * DRY RUN BY DEFAULT — prints the plan and writes nothing:
 *   npx tsx scripts/provision-the-babe-studio.ts
 *   npx tsx scripts/provision-the-babe-studio.ts --apply
 */

import { PrismaClient, Prisma } from "@prisma/client";

import { onboardingSchema, type OnboardingInput } from "../src/lib/onboarding/schema";
import { buildProvisioning } from "../src/lib/onboarding/mapping";
import { amountDueFromConfig } from "../src/lib/onboarding/pricing";
import { normalizePlanConfig, PLAN_CONFIG_KEY, defaultPlanConfig } from "../src/lib/platform/plan-config";
import { normalizeOrderNumberFormat } from "../src/lib/orders/order-number-format";
import { planMeta, formatPesos } from "../src/lib/admin/plans";
import { slugify, uniqueize } from "../src/lib/storefront/product-mapping";
import { toWaDigits } from "../src/lib/admin/whatsapp";
import type { Brand } from "../src/storefront/types";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

const SLUG = "the-babe-studio";
const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").replace(/:\d+$/, "");

// Client palette. `main` is the brand ink (midnight), `accent` the rose gold the
// storefront uses for highlights, `button` the copper rose CTA. Button text is
// midnight rather than white: white on #c08d7a is 2.8:1 (fails AA), midnight is
// 6.8:1.
const MIDNIGHT = "#0b0d14";
const ROSE_GOLD = "#cdafa0";
const COPPER_ROSE = "#c08d7a";

const BRIEF: OnboardingInput = {
  businessName: "The Babe Studio",
  businessType: "Peptides",
  description:
    "Premium research-grade peptides — lab-tested, high-purity formulations for your wellness journey.",
  contactPerson: "Kaye Delos Reyes",
  whatsapp: "+63 949 613 3242",
  facebook: "", // brief said n/a

  themeStyle: "luxury",
  themeId: "velvet-noir",
  primaryColor: MIDNIGHT,
  secondaryColor: ROSE_GOLD,
  logoUrl: "", // JPEG lands later via the media upload path

  // Prices are not set yet — every row is created as an unpriced draft.
  products: [
    {
      name: "Tirzepatide",
      price: 0,
      category: "Weight Loss",
      description: "Tirzepatide (GLP-1/GIP dual agonist) research peptide — lab-tested, high purity.",
    },
    {
      name: "GHK-Cu",
      price: 0,
      category: "Beauty & Skin",
      description: "GHK-Cu copper peptide for skin-repair and anti-aging research.",
    },
    {
      name: "NAD+",
      price: 0,
      category: "Longevity",
      description: "NAD+ research vial for cellular-energy and longevity protocols.",
    },
    {
      name: "Semax",
      price: 0,
      category: "Nootropics",
      description: "Semax nootropic research peptide for cognitive and neuroprotection studies.",
    },
    {
      name: "Selank",
      price: 0,
      category: "Nootropics",
      description: "Selank anxiolytic / nootropic research peptide.",
    },
  ],

  orderDestination: "whatsapp",
  orderDestinationValue: "+63 949 613 3242",
  paymentMethods: [], // owner adds GCash/Maya/bank in store admin

  packageKey: "enterprise", // Automated
  billingCycle: "yearly",
  trial: false,
  selectedFeatures: [], // Starter-only concept; Automated ships every page on

  paymentProofUrl: "",
  termsAccepted: true, // operator-entered intake on the client's behalf
};

/** Operator-edited plan pricing (platform_settings), falling back to code defaults. */
async function planConfig() {
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: PLAN_CONFIG_KEY } });
    return row ? normalizePlanConfig(row.value) : defaultPlanConfig();
  } catch {
    return defaultPlanConfig();
  }
}

async function main() {
  const payload = onboardingSchema.parse(BRIEF);
  const planKey = planMeta(payload.packageKey).key;

  const plan = await prisma.plan.findUnique({ where: { key: planKey }, select: { id: true } });
  if (!plan) throw new Error(`Plan not seeded: ${planKey}`);

  const clash = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (clash) throw new Error(`Tenant "${SLUG}" already exists (${clash.id}) — nothing to do.`);

  const { brandConfig, productWrites, settings } = buildProvisioning(payload);

  // The mapping derives accent/button from secondaryColor; the brief names a
  // third colour (copper rose) for CTAs, so override those two keys explicitly.
  const config: Partial<Brand> = {
    ...brandConfig,
    main: MIDNIGHT,
    accent: ROSE_GOLD,
    button: COPPER_ROSE,
    button2: ROSE_GOLD,
    buttonText: MIDNIGHT,
  };

  const waDigits = toWaDigits(payload.whatsapp);
  const orderNumberFormat = normalizeOrderNumberFormat({}, payload.businessName);
  const amountDueCents = amountDueFromConfig(await planConfig(), {
    planKey,
    trial: false,
    billingCycle: "yearly",
    extraFeatureCount: 0,
  });

  // Unique slug + sku per product, then forced to draft (unpriced catalog).
  const takenSlugs = new Set<string>();
  const takenSkus = new Set<string>();
  const products = productWrites.map((w, i) => {
    const slug = uniqueize(slugify(w.name), takenSlugs);
    takenSlugs.add(slug);
    const skuBase = (slug.toUpperCase().replace(/[^A-Z0-9]/g, "") || `SKU${i + 1}`).slice(0, 32);
    const sku = uniqueize(skuBase, takenSkus);
    takenSkus.add(sku);
    return {
      sku,
      slug,
      name: w.name,
      description: w.description,
      priceCents: w.priceCents,
      currency: w.currency,
      stock: w.stock,
      status: "draft",
      active: false,
      images: w.images as unknown as Prisma.InputJsonValue,
      metadata: w.metadata as unknown as Prisma.InputJsonValue,
    };
  });

  console.log(`Tenant       ${payload.businessName}  →  ${SLUG}.${ROOT}`);
  console.log(`Plan         ${planMeta(planKey).label} (${planKey}), yearly — quoted ${formatPesos(amountDueCents)}`);
  console.log(`Status       pending_setup (dark until published in Super Admin)`);
  console.log(`Theme        ${payload.themeId}  ·  main ${MIDNIGHT} · accent ${ROSE_GOLD} · button ${COPPER_ROSE}`);
  console.log(`WhatsApp     ${waDigits}  (contact channel + owner quick-contact)`);
  console.log(`Categories   ${(config.categories ?? []).map((c) => c.label).join(", ")}`);
  console.log(`Products     ${products.length} draft rows:`);
  for (const p of products) console.log(`   • ${p.name.padEnd(14)} ${p.slug}  [draft, unpriced]`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to provision.");
    return;
  }

  const tenant = await prisma.$transaction(async (tx) => {
    const t = await tx.tenant.create({
      data: {
        name: payload.businessName,
        slug: SLUG,
        status: "pending_setup",
        planId: plan.id,
        orderNumberFormat,
        ownerWhatsapp: waDigits,
        subscriptionCycle: "yearly",
        branding: {
          create: {
            themeId: payload.themeId,
            config: config as unknown as Prisma.InputJsonValue,
          },
        },
        settings: {
          create: {
            storeName: settings.storeName,
            supportEmail: settings.supportEmail,
            currency: settings.currency,
          },
        },
        products: { create: products },
      },
      select: { id: true, slug: true },
    });

    await tx.onboardingSubmission.create({
      data: {
        businessName: payload.businessName,
        businessType: payload.businessType,
        description: payload.description || null,
        contactPerson: payload.contactPerson || null,
        email: payload.email,
        whatsapp: payload.whatsapp,
        facebook: null,
        themeStyle: payload.themeStyle ?? null,
        themeId: payload.themeId,
        primaryColor: MIDNIGHT,
        secondaryColor: ROSE_GOLD,
        logoUrl: null,
        bannerUrls: [] as unknown as Prisma.InputJsonValue,
        inspirationUrls: [] as unknown as Prisma.InputJsonValue,
        inspirationNotes: `Accent (copper rose): ${COPPER_ROSE}. Logo JPEG to follow. Product prices TBD.`,
        products: payload.products as unknown as Prisma.InputJsonValue,
        orderDestination: payload.orderDestination,
        orderDestinationValue: payload.orderDestinationValue || null,
        paymentMethods: [] as unknown as Prisma.InputJsonValue,
        packageKey: planKey,
        billingCycle: "yearly",
        trial: false,
        amountDueCents,
        selectedFeatures: [] as unknown as Prisma.InputJsonValue,
        paymentProofUrl: null,
        termsAccepted: payload.termsAccepted,
        slug: t.slug,
        tenantId: t.id,
        setupStatus: "tenant_created",
      },
    });

    return t;
  });

  console.log(`\n✓ Provisioned ${tenant.slug} (${tenant.id}).`);
  console.log("  Next: set store-admin email + password, upload the logo, price the 5 products, then publish.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
