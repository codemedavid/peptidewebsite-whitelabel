/**
 * Provision `mnm-pepsabuy` — MNM PEPSABUY ("Premium peptides · Premium results",
 * "for our people"). New tenant, blue like its logo.
 *
 * Writes:
 *   • Tenant (pro, trial — same shape as the other operator-made stores),
 *     operator account as owner member
 *   • Branding — themeId royal-sapphire as the base, palette overridden with
 *     blues SAMPLED from the logo (see COLORS), rounded display type to match
 *     the chunky logotype, card hero with the logo
 *   • the logo, uploaded to the tenant's ImageKit folder (Branding.logoUrl
 *     column only — config.logoUrl stays empty so admin uploads win later)
 *   • feature grants:
 *       storefront.access_code — the storefront password ("Access Code" panel
 *                                in the store admin; the owner sets the code)
 *       groupbuy.module        — group buys
 *       groupbuy.scheduled     — rounds that open on their own, which the hero
 *                                countdown counts down to
 *   • branding.config.heroCountdown ON (owner can switch it off in
 *     Group Buys → Hero countdown)
 *
 * Products, payment methods and couriers are left for the owner.
 *
 * SAFE BY DEFAULT — dry run unless --apply. Refuses to run if the slug exists.
 *
 *   npx tsx --env-file=.env scripts/seed-mnm-pepsabuy.ts /path/to/logo.jpg
 *   npx tsx --env-file=.env scripts/seed-mnm-pepsabuy.ts /path/to/logo.jpg --apply
 *
 * ── Colours (logo sampled at 300×300, saturated blues bucketed) ─────────────
 *   #1848a8 / #2454b4 / #183c9c — the "MNM PEPSABUY" letter outlines
 *   #d0e0f0 / #c0e0f0           — the sky-blue background wash
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import { uploadTenantMedia } from "../src/lib/imagekit/server";
import { normalizeOrderNumberFormat } from "../src/lib/orders/order-number-format";
import type { Brand } from "../src/storefront/types";

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes("--apply");
const LOGO = ARGS.find((a) => !a.startsWith("--"));

const SLUG = "mnm-pepsabuy";
const NAME = "MNM PEPSABUY";
const PLAN_KEY = "pro";
const STATUS = "trial";
const THEME_ID = "royal-sapphire";
const OPERATOR_EMAIL = "joninadavid2@gmail.com";
const MAX_LOGO_BYTES = 10 * 1024 * 1024;
const HERO_LOGO_SIZE = 240;

const COLORS = {
  main: "#1B4DB0", // logo letter outline
  accent: "#2F6FD6", // lifted step for links / highlights
  button: "#1E56C8",
  button2: "#4A86E0", // CTA gradient stop
  buttonText: "#FFFFFF",
  background: "#EEF5FE", // the logo's sky wash, lightened for body text
  surface: "#FFFFFF",
  text: "#0F2147", // navy body copy
  border: "#C9DCF5",
} as const;

const FONTS = { heading: "Fredoka", body: "Nunito" } as const;

const FEATURE_GRANTS = ["storefront.access_code", "groupbuy.module", "groupbuy.scheduled"] as const;

const CONFIG: Record<string, unknown> & Omit<Partial<Brand>, "heroCountdown"> = {
  name: NAME,
  industry: "premium peptides",
  currency: "₱",
  ...COLORS,
  borderColor: COLORS.border,
  headingFont: FONTS.heading,
  bodyFont: FONTS.body,
  heroVariant: "card",
  heroShowLogo: true,
  heroLogoSize: HERO_LOGO_SIZE,
  heroChipLabel: "For our people",
  heroLine1: "Join our group buys or shop on-hand.",
  heroLine2: "Every order is handled by the MNM team.",
  heroSub: "Join our group buys or shop on-hand. Every order is handled by the MNM team.",
  heroShowSub: false,
  heroCta1: "Shop now",
  metaDescription: "MNM PEPSABUY: premium peptides for our people, through group buys and on-hand orders.",
  // Storefront password: the owner sets the code in Admin → Access Code, which
  // switches the gate on. Off until then (the gate never walls a store without a code).
  accessGate: { enabled: false, heading: "" },
  heroCountdown: { enabled: true, showHeading: true, closingHeading: "", openingHeading: "" },
};

async function main() {
  if (!LOGO) throw new Error("Pass the logo file path as the first argument.");
  if (!existsSync(LOGO)) throw new Error(`Logo file not found: ${LOGO}`);
  const bytes = statSync(LOGO).size;
  if (bytes > MAX_LOGO_BYTES) throw new Error(`Logo is ${bytes} bytes — over the 10 MB limit.`);

  if (await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } })) {
    throw new Error(`Tenant "${SLUG}" already exists — refusing to provision twice.`);
  }
  const plan = await prisma.plan.findUnique({ where: { key: PLAN_KEY }, select: { id: true } });
  if (!plan) throw new Error(`Plan not seeded: ${PLAN_KEY}`);
  const features = await prisma.feature.findMany({
    where: { key: { in: [...FEATURE_GRANTS] } },
    select: { id: true, key: true },
  });
  const missing = FEATURE_GRANTS.filter((k) => !features.some((f) => f.key === k));
  if (missing.length) throw new Error(`Feature rows missing in DB: ${missing.join(", ")}`);
  const operator = await prisma.tenantUser.findFirst({
    where: { email: OPERATOR_EMAIL, role: "owner" },
    select: { userId: true },
  });
  if (!operator) throw new Error(`No existing owner membership for ${OPERATOR_EMAIL} to copy the userId from.`);

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${NAME} (${SLUG})`);
  console.log(`  plan ${PLAN_KEY} · status ${STATUS} · theme ${THEME_ID} · owner ${OPERATOR_EMAIL}`);
  console.log(`  logo ${LOGO} (${(bytes / 1024).toFixed(0)} KB)`);
  console.log(`  grants ${FEATURE_GRANTS.join(", ")}`);
  console.log(`  palette ${JSON.stringify(COLORS)}`);
  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.");
    return;
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: NAME,
      slug: SLUG,
      status: STATUS,
      planId: plan.id,
      orderNumberFormat: normalizeOrderNumberFormat({}, NAME),
      storeAdminEmail: OPERATOR_EMAIL,
      branding: {
        create: {
          themeId: THEME_ID,
          fonts: FONTS as Prisma.InputJsonValue,
          config: CONFIG as Prisma.InputJsonValue,
        },
      },
      settings: { create: { storeName: NAME, supportEmail: OPERATOR_EMAIL, currency: "PHP" } },
      members: { create: { userId: operator.userId, email: OPERATOR_EMAIL, role: "owner" } },
      featureOverrides: {
        create: features.map((f) => ({ featureId: f.id, enabled: true })),
      },
    },
    select: { id: true },
  });

  try {
    const uploaded = await uploadTenantMedia({
      tenantId: tenant.id,
      file: readFileSync(LOGO),
      fileName: `logo-mnm-pepsabuy-${basename(LOGO)}`,
      tags: ["branding:logo"],
    });
    await prisma.$transaction([
      prisma.mediaAsset.create({
        data: { tenantId: tenant.id, imagekitId: uploaded.fileId, url: uploaded.url, type: "branding:logo" },
      }),
      prisma.branding.update({ where: { tenantId: tenant.id }, data: { logoUrl: uploaded.url, faviconUrl: uploaded.url } }),
    ]);
    console.log(`\n✓ Created ${SLUG} (${tenant.id})`);
    console.log(`✓ Logo ${uploaded.url}`);
  } catch (e) {
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => undefined);
    throw e;
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
