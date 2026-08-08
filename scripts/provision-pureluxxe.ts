/**
 * Provision the tenant "Pureluxxe" (operator-side intake).
 *
 * Runs the real onboarding schema + `buildProvisioning` mapping rather than
 * hand-rolling a branding blob, so the store lands byte-identical to a wizard
 * sign-up: tenant + branding + settings + products + an OnboardingSubmission
 * the operator can see in Super Admin → Onboarding.
 *
 * The brief — including all 21 prices — lives in ./lib/pureluxxe-brief and is
 * verified by `npm run test:pureluxxe` BEFORE anything is written. Run that
 * first; this script writes a live shop in one transaction.
 *
 * THE FIRST NON-PESO TENANT. Everything is stamped SAR: brand config, every
 * product row, and TenantSettings. That is only possible because
 * buildProvisioning now takes a currency (docs/testing/store-currency.tdd.md).
 *
 * Two deliberate choices, both different from the-babe-studio and both what the
 * client asked for:
 *   • status "active" — the shop is LIVE the moment this runs, reachable at
 *     pureluxxe.<root>. The catalog is fully priced, so there is nothing to
 *     hold back for.
 *   • products created LIVE (status "active") — every row has a real price from
 *     the client's list, so there is no reason to land them as drafts.
 *
 * Left for a human afterwards, deliberately:
 *   • the logo — the client sent a PNG in chat, not a file in this repo. Upload
 *     it in store admin (or via the media path) and it lands on ImageKit.
 *   • payment methods — the owner uploads their own. An invented bank detail
 *     would send a customer's money to the wrong account.
 *   • the store-admin password — set from Super Admin so it is never written
 *     into branding.config, which ships to every visitor.
 *
 * DRY RUN BY DEFAULT — prints the plan and writes nothing:
 *   npx tsx scripts/provision-pureluxxe.ts
 *   npx tsx scripts/provision-pureluxxe.ts --apply
 */

import { PrismaClient, Prisma } from "@prisma/client";

import { BRIEF, PALETTE, SLUG, CURRENCY, PRICE_LIST } from "./lib/pureluxxe-brief";

import { onboardingSchema } from "../src/lib/onboarding/schema";
import { buildProvisioning } from "../src/lib/onboarding/mapping";
import { amountDueFromConfig } from "../src/lib/onboarding/pricing";
import {
  normalizePlanConfig,
  PLAN_CONFIG_KEY,
  defaultPlanConfig,
} from "../src/lib/platform/plan-config";
import { normalizeOrderNumberFormat } from "../src/lib/orders/order-number-format";
import { planMeta, formatPesos } from "../src/lib/admin/plans";
import { slugify, uniqueize } from "../src/lib/storefront/product-mapping";
import { toWaDigits } from "../src/lib/admin/whatsapp";
import { formatMoney } from "../src/lib/storefront/currency";
import type { Brand } from "../src/storefront/types";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").replace(/:\d+$/, "");

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

  // The currency is passed here — this is what makes it a riyal store rather
  // than a peso one, all the way down to each product row.
  const { brandConfig, productWrites, settings } = buildProvisioning(payload, CURRENCY);

  // The mapping derives accent/button from secondaryColor; the logo gives a
  // distinct coral for CTAs, so those keys are set explicitly.
  const config: Partial<Brand> = {
    ...brandConfig,
    main: PALETTE.main,
    accent: PALETTE.accent,
    button: PALETTE.button,
    button2: PALETTE.button2,
    buttonText: PALETTE.buttonText,
  };

  const waDigits = toWaDigits(payload.whatsapp);
  const orderNumberFormat = normalizeOrderNumberFormat({}, payload.businessName);
  const billingCycle = payload.billingCycle ?? "monthly";
  const amountDueCents = amountDueFromConfig(await planConfig(), {
    planKey,
    trial: false,
    billingCycle,
    extraFeatureCount: 0,
  });

  // Unique slug + sku per product. Every row is priced, so every row goes live.
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
      status: "active",
      active: true,
      images: w.images as unknown as Prisma.InputJsonValue,
      metadata: w.metadata as unknown as Prisma.InputJsonValue,
    };
  });

  const catalogTotal = PRICE_LIST.reduce((sum, p) => sum + p.price, 0);

  console.log(`Tenant       ${payload.businessName}  →  ${SLUG}.${ROOT}`);
  console.log(`Plan         ${planMeta(planKey).label} (${planKey}), ${billingCycle} — quoted ${formatPesos(amountDueCents)}`);
  console.log(`Status       ACTIVE — live and publicly reachable the moment this applies`);
  console.log(`Currency     ${CURRENCY} — brand config, all ${products.length} product rows, and settings`);
  console.log(`Theme        ${payload.themeId}  ·  main ${PALETTE.main} · accent ${PALETTE.accent} · button ${PALETTE.button}`);
  console.log(`Contact      ${payload.contactPerson} · ${payload.email}`);
  console.log(`WhatsApp     ${waDigits}  (contact channel + order destination)`);
  console.log(`Categories   ${(config.categories ?? []).map((c) => c.label).join(", ")}`);
  console.log(`Products     ${products.length} live rows, catalog totals ${formatMoney(catalogTotal, CURRENCY, { decimals: false })}:`);
  for (const p of products) {
    const price = formatMoney(p.priceCents / 100, CURRENCY, { decimals: false });
    console.log(`   • ${p.name.padEnd(20)} ${price.padStart(9)}   ${p.slug}`);
  }
  console.log(`\nLeft for a human: logo upload (ImageKit), payment methods, store-admin password.`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to provision.");
    return;
  }

  const tenant = await prisma.$transaction(async (tx) => {
    const t = await tx.tenant.create({
      data: {
        name: payload.businessName,
        slug: SLUG,
        status: "active",
        planId: plan.id,
        orderNumberFormat,
        ownerWhatsapp: waDigits,
        storeAdminEmail: payload.email,
        subscriptionCycle: billingCycle,
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
        primaryColor: PALETTE.main,
        secondaryColor: PALETTE.accent,
        logoUrl: null,
        bannerUrls: [] as unknown as Prisma.InputJsonValue,
        inspirationUrls: [] as unknown as Prisma.InputJsonValue,
        inspirationNotes: `Coral CTA: ${PALETTE.button}. Currency ${CURRENCY}. Logo PNG to be uploaded by the operator. Payment methods to be added by the owner.`,
        products: payload.products as unknown as Prisma.InputJsonValue,
        orderDestination: payload.orderDestination,
        orderDestinationValue: payload.orderDestinationValue || null,
        paymentMethods: [] as unknown as Prisma.InputJsonValue,
        packageKey: planKey,
        billingCycle,
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

  console.log(`\n✓ Provisioned ${tenant.slug} (${tenant.id}) — LIVE at ${SLUG}.${ROOT}`);
  console.log("  Next: upload the logo, set the store-admin password in Super Admin,");
  console.log("  then have the owner add their payment methods before taking orders.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
