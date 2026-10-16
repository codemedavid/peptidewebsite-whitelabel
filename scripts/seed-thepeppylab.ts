/**
 * Provision `thepeppylab` — The Peppy Lab, migrated off its old Vite + Supabase
 * site (thepeppylab.vercel.app) onto the whitelabel.
 *
 * Reads the exported legacy tables (scripts/export-legacy-supabase.ts →
 * .migration/thepeppylab/*.json) and maps them with the pure core in
 * src/lib/migration/legacy-store.ts. Writes:
 *   • Tenant (pro, active) — order numbers continue the old TPL series
 *   • Branding — the old site's identity (see "Brand" below) + catalog config:
 *     categories, payment methods, couriers/shipping, promo codes, FAQ, contact,
 *     assessment quiz settings
 *   • TenantSettings
 *   • 56 products (+ "Vial Only / Complete Set" and pen-colour variations),
 *     upserted by `leg-…` SKU so a re-run updates in place
 *   • the logo, uploaded to the tenant's ImageKit folder
 *
 * Product images and payment QR codes still point at the OLD project after this
 * script; re-host them next with
 *   npx tsx scripts/rehost-hpglow-images.ts --tenant=<id> --host=enqbkjvzafzlhavcrbad.supabase.co --apply
 * Orders: scripts/import-legacy-orders.ts --tenant=thepeppylab --rest=… (see its header).
 *
 * SAFE BY DEFAULT — dry run unless --apply. Re-running never clobbers branding
 * the owner may have edited: an existing config is left alone unless
 * --force-branding is passed (products/tenant row still upsert).
 *
 *   npx tsx --env-file=.env scripts/seed-thepeppylab.ts            # dry run
 *   npx tsx --env-file=.env scripts/seed-thepeppylab.ts --apply
 *
 * ── Brand (measured off the live site, 2026-10-15) ──────────────────────────
 *   Rose-brick #9A4444 (headings, prices, buttons) · peach-tan #E0C0A8 (2px
 *   hairlines) · blush page #FFFAF8 · white surfaces · grey body copy #4B5563.
 *   Type: Times New Roman everywhere — the wordmark is set in it. Shipped as
 *   Tinos, its metric-compatible Google twin, because Android has no Times New
 *   Roman and most PH shoppers are on Android.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import { hexToHslTriple } from "../src/lib/theme/color";
import { BRAND } from "../src/storefront/data";
import type { Brand, Courier, FaqGroup, NavItem, ShippingLocation } from "../src/storefront/types";
import {
  mapLegacyCategories,
  mapLegacyPaymentMethods,
  mapLegacyProduct,
  mapLegacyVouchers,
  type LegacyCategoryRow,
  type LegacyPaymentMethodRow,
  type LegacyProductRow,
  type LegacyVariationRow,
  type LegacyVoucherRow,
} from "../src/lib/migration/legacy-store";
import { productToDbWrite, slugify, uniqueize } from "../src/lib/storefront/product-mapping";
import { DEFAULT_ASSESSMENT, normalizeAssessmentConfig } from "../src/lib/storefront/assessment";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FORCE_BRANDING = args.includes("--force-branding");

const SLUG = "thepeppylab";
const NAME = "The Peppy Lab";
const TAGLINE = "Peptides & Essentials";
const PLAN_KEY = "pro";
const EXPORT_DIR = join(process.cwd(), ".migration", SLUG);
const LOGO_SOURCE = "https://thepeppylab.vercel.app/assets/logo.jpeg";
const CURRENCY_SYMBOL = "₱";
const CURRENCY_ISO = "PHP";
/** The old site's last order is TPL#1794; new orders continue from TPL-1795. */
const LAST_LEGACY_ORDER_SEQ = 1794;

const TELEGRAM_SELLER = "anntpl";
const TELEGRAM_COMMUNITY = "https://t.me/+I1VczGgB-JJlMmU9";

const COLORS = {
  rose: "#9A4444",
  peach: "#E0C0A8",
  blush: "#FFFAF8",
  white: "#FFFFFF",
  ink: "#4B5563",
} as const;
const FONT = "Tinos";

// ── Shipping: the old shipping_locations rows, re-shaped per courier ─────────
const JNT_ID = "jnt";
const LALAMOVE_ID = "lalamove";
const COURIERS: Courier[] = [
  { id: JNT_ID, name: "J&T Express", trackingUrl: "https://www.jtexpress.ph/trajectoryQuery?waybillNo=", active: true },
  {
    id: LALAMOVE_ID,
    name: "Lalamove — Same Day (Metro Manila)",
    trackingUrl: "https://www.lalamove.com/philippines/manila/en/track",
    active: true,
    noLocation: true,
  },
];
const SHIPPING_LOCATIONS: ShippingLocation[] = [
  { id: "jnt-ncr", courierId: JNT_ID, code: "NCR", name: "Metro Manila (NCR)", price: 80, active: true },
  { id: "jnt-luzon", courierId: JNT_ID, code: "LUZON", name: "Luzon (outside NCR)", price: 100, active: true },
  { id: "jnt-visayas", courierId: JNT_ID, code: "VISAYAS", name: "Visayas", price: 130, active: true },
  { id: "jnt-mindanao", courierId: JNT_ID, code: "MINDANAO", name: "Mindanao", price: 150, active: true },
];

// ── Assessment: the original goal map, widened to THIS catalog's names ──────
const ASSESSMENT = normalizeAssessmentConfig({
  ...DEFAULT_ASSESSMENT,
  intro:
    "Tell us your goals and we'll match you with the right products from our shop. It takes about 2 minutes.",
  goals: [
    { label: "Weight Loss", keywords: ["Tirzepatide", "Retatrutide", "Eloralintide", "Semaglutide", "Cagrilintide", "Mazdutide", "AOD", "5 Amino", "Super Shred"] },
    { label: "Muscle Gain", keywords: ["CJC-1295", "CJC", "Ipamorelin", "Tesamorelin", "IGF-1", "MK-677"] },
    { label: "Anti-Aging/Longevity", keywords: ["Epitalon", "NAD+", "GHK-Cu", "Thymosin Alpha", "Thymalin", "Foxo4", "Glutathione"] },
    { label: "Energy & Focus", keywords: ["NAD+", "MOTS-c", "Semax", "Selank", "SS-31", "Adamax"] },
    { label: "Better Sleep", keywords: ["DSIP", "Epitalon", "CJC-1295"] },
    { label: "Injury Recovery", keywords: ["BPC-157", "TB-500", "KPV", "KLOW", "GHK-Cu"] },
    { label: "Skin Health", keywords: ["GHK-Cu", "AHK-Cu", "Glutathione", "Matrixyl", "Snap-8", "HHB", "Hyaluronic", "Melanotan"] },
    { label: "Body Contouring", keywords: ["Aqualyx", "Lemon Bottle", "Lipo Lab", "Lipo Vela", "Lipo C"] },
  ],
});

// ── FAQ — only facts taken from the old store's own data ────────────────────
const FAQ: FaqGroup[] = [
  {
    id: "ordering",
    label: "Ordering & Payment",
    icon: "payment",
    items: [
      {
        q: "How do I place an order?",
        a: "Add products to your cart, check out with your delivery details, then pay by BPI bank transfer or GCash and upload your proof of payment. We confirm every order with you on Telegram.",
      },
      {
        q: "Which payment methods do you accept?",
        a: "BPI bank transfer and GCash, both under the account name The Peppy Lab. The account numbers and QR codes are shown at checkout.",
      },
      {
        q: "What is the difference between Vial Only and Complete Set?",
        a: "Vial Only is the peptide vial on its own. The Complete Set adds everything you need to start: bacteriostatic water, a small clear vial case, 10 insulin syringes, a 3ml syringe for reconstitution, 20 alcohol pads and a big clear hard case.",
      },
    ],
  },
  {
    id: "shipping",
    label: "Shipping & Delivery",
    icon: "shipping",
    items: [
      {
        q: "How much is shipping?",
        a: "We ship with J&T Express: Metro Manila ₱80, Luzon (outside NCR) ₱100, Visayas ₱130, Mindanao ₱150. Same-day Lalamove delivery is available within Metro Manila.",
      },
      {
        q: "How do I track my order?",
        a: "Open Track Order and enter your order number (for example TPL#1234 or TPL-1795). Your tracking number appears there once your parcel ships.",
      },
    ],
  },
  {
    id: "support",
    label: "Help & Community",
    icon: "product",
    items: [
      {
        q: "How can I reach you?",
        a: "Message us on Telegram at @anntpl. You can also join our Telegram community for updates and tips.",
      },
    ],
  },
];

const NAV: NavItem[] = [
  { label: "Products", href: "#catalog" },
  { label: "Peptide Calculator", href: "#calculator" },
  { label: "Lab Results (COA)", href: "#coa" },
  { label: "FAQ", href: "#faq" },
  { label: "Guides", href: "#protocols" },
  { label: "Articles", href: "#articles" },
  { label: "Track Order", href: "#track" },
];

function readJson<T>(table: string): T[] {
  const parsed: unknown = JSON.parse(readFileSync(join(EXPORT_DIR, `${table}.json`), "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${table}.json is not an array`);
  return parsed as T[];
}

function buildConfig(
  categories: Brand["categories"],
  paymentMethods: Brand["paymentMethods"],
  promoCodes: Brand["promoCodes"],
): Brand {
  return {
    ...BRAND,
    name: NAME,
    logoUrl: "", // the Branding.logoUrl COLUMN owns the logo (see seed-pepsys-compound)
    logoCurve: 50,
    ctaLabel: "Shop All Products",
    industry: "peptides & essentials",
    currency: CURRENCY_SYMBOL,

    main: COLORS.rose,
    accent: COLORS.rose,
    button: COLORS.rose,
    button2: COLORS.rose, // the old buttons were solid, not a gradient
    buttonText: COLORS.white,
    background: COLORS.blush,
    surface: COLORS.white,
    text: COLORS.ink,
    headerBg: COLORS.white,
    headerText: COLORS.rose,
    borderColor: COLORS.peach,
    borderWidth: 2,

    headingFont: FONT,
    bodyFont: FONT,
    buttonFont: FONT,
    priceFont: FONT,

    heroVariant: "centered",
    heroShowChip: true,
    heroChipLabel: `🧪 ${TAGLINE}`,
    heroLine1: "Welcome to",
    heroLine2: NAME,
    heroHighlight: COLORS.rose,
    heroSub:
      "At Peppy Lab, we offer high-quality peptides to support weight loss, glowing skin, wellness, and confidence. Because looking and feeling your best doesn't have to be expensive. 💕",
    heroCta1: "Shop All Products",
    heroCta1LinkType: "page",
    heroCta1LinkPage: "catalog",
    heroCta2: "Start Assessment",
    heroCta2LinkType: "page",
    heroCta2LinkPage: "assessment",

    nav: NAV,
    categories,
    paymentMethods,
    requireProofOfPayment: true,
    couriers: COURIERS,
    shippingLocations: SHIPPING_LOCATIONS,
    promoCodes,
    faqGroups: FAQ,
    // Lab reports and guides were empty on the old site. The pages are granted
    // (the owner can fill them) but hidden until there is something to show.
    coaReports: [],
    showPageCOA: false,
    protocols: [],
    showPageProtocols: false,
    articlesTitle: "Articles",
    articlesIntro: "Guides, explainers and notes from The Peppy Lab team.",
    assessment: ASSESSMENT,

    contactChannels: [
      { type: "telegram", destination: TELEGRAM_SELLER, enabled: true },
      { type: "whatsapp", destination: "", enabled: false },
      { type: "messenger", destination: "", enabled: false },
      { type: "viber", destination: "", enabled: false },
      { type: "gmail", destination: "", enabled: false },
      { type: "instagram", destination: "", enabled: false },
    ],
    checkoutTitle: "Complete your order",
    checkoutNote: "Pay by BPI or GCash, upload your proof, and we'll confirm your order on Telegram.",

    footerBlurb: `${TAGLINE} — quality you can feel, results you can trust.`,
    footerSocials: [{ label: "Telegram", href: `https://t.me/${TELEGRAM_SELLER}`, icon: "telegram", show: true }],
    footerColumns: [
      {
        title: "Shop",
        links: [
          { label: "All Products", href: "#catalog" },
          { label: "Track Order", href: "#track" },
          { label: "Start Assessment", href: "#assessment" },
        ],
      },
      {
        title: "Learn",
        links: [
          { label: "Peptide Calculator", href: "#calculator" },
          { label: "Articles", href: "#articles" },
          { label: "FAQ", href: "#faq" },
        ],
      },
      {
        title: "Contact",
        links: [
          { label: "Contact Seller", href: `https://t.me/${TELEGRAM_SELLER}` },
          { label: "Join Community", href: TELEGRAM_COMMUNITY },
        ],
      },
    ],
    metaDescription: "Premium peptide solutions for radiance, confidence & vitality. Lab-verified purity guaranteed.",
  } as Brand;
}

async function uploadLogo(tenantId: string): Promise<string> {
  const { uploadTenantMedia } = await import("../src/lib/imagekit/server");
  const res = await fetch(LOGO_SOURCE);
  if (!res.ok) throw new Error(`logo download failed: HTTP ${res.status}`);
  const up = await uploadTenantMedia({
    tenantId,
    file: Buffer.from(await res.arrayBuffer()),
    fileName: "the-peppy-lab-logo.jpeg",
    tags: ["logo", "legacy-import"],
  });
  return up.url;
}

async function main() {
  const legacyProducts = readJson<LegacyProductRow>("products");
  const variations = readJson<LegacyVariationRow>("product_variations");
  const { categories, idMap } = mapLegacyCategories(readJson<LegacyCategoryRow>("categories"));
  const paymentMethods = mapLegacyPaymentMethods(readJson<LegacyPaymentMethodRow>("payment_methods"));
  const promoCodes = mapLegacyVouchers(readJson<LegacyVoucherRow>("vouchers"));

  const byProduct = new Map<string, LegacyVariationRow[]>();
  for (const v of variations) byProduct.set(v.product_id, [...(byProduct.get(v.product_id) ?? []), v]);
  const products = legacyProducts.map((row) =>
    mapLegacyProduct(row, byProduct.get(row.id) ?? [], idMap, CURRENCY_SYMBOL),
  );

  console.log(`\n▶ ${NAME} (${SLUG}) — ${APPLY ? "APPLY" : "DRY RUN"}\n`);
  console.log(`  categories  ${categories.map((c) => c.label).join(" · ")}`);
  console.log(`  products    ${products.length} (${products.filter((p) => p.variations).length} with options, ${products.filter((p) => !p.image).length} without a photo)`);
  console.log(`  payments    ${paymentMethods.map((m) => m.name).join(" · ")}`);
  console.log(`  promo codes ${promoCodes.length} (${promoCodes.filter((p) => p.active).length} active)`);
  console.log(`  shipping    J&T ×${SHIPPING_LOCATIONS.length} zones + Lalamove same-day`);
  console.log(`  assessment  ${ASSESSMENT.goals.length} goals`);

  if (!APPLY) {
    console.log(`\n  DRY RUN — nothing written. Re-run with --apply.\n`);
    return;
  }

  const plan = await prisma.plan.findUnique({ where: { key: PLAN_KEY } });
  if (!plan) throw new Error(`Plan not seeded: ${PLAN_KEY}`);

  const orderNumberFormat = { prefix: "TPL", separator: "-", scheme: "sequential", digits: 4 };
  const existingTenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { orderSeq: true } });
  const tenant = await prisma.tenant.upsert({
    where: { slug: SLUG },
    update: {
      name: NAME,
      planId: plan.id,
      orderNumberFormat,
      orderSeq: Math.max(existingTenant?.orderSeq ?? 0, LAST_LEGACY_ORDER_SEQ),
    },
    create: {
      name: NAME,
      slug: SLUG,
      status: "active",
      planId: plan.id,
      orderNumberFormat,
      orderSeq: LAST_LEGACY_ORDER_SEQ,
    },
  });
  console.log(`\n  ✓ tenant ${tenant.id}`);

  const existingBranding = await prisma.branding.findUnique({ where: { tenantId: tenant.id } });
  const hasConfig =
    !!existingBranding?.config && Object.keys(existingBranding.config as object).length > 0;
  if (hasConfig && !FORCE_BRANDING) {
    console.log("  • branding already configured — left alone (pass --force-branding to overwrite)");
  } else {
    const config = buildConfig(categories, paymentMethods, promoCodes) as unknown as Prisma.InputJsonValue;
    const branding = {
      themeId: "peach-blossom",
      colors: {
        main: hexToHslTriple(COLORS.rose),
        accent: hexToHslTriple(COLORS.rose),
        button: hexToHslTriple(COLORS.rose),
        buttonText: hexToHslTriple(COLORS.white),
        background: hexToHslTriple(COLORS.blush),
        surface: hexToHslTriple(COLORS.white),
        text: hexToHslTriple(COLORS.ink),
      },
      fonts: { heading: FONT, body: FONT },
      radius: "0.5rem",
      config,
    };
    await prisma.branding.upsert({
      where: { tenantId: tenant.id },
      update: branding,
      create: { tenantId: tenant.id, logoUrl: "", ...branding },
    });
    console.log("  ✓ branding");
  }

  if (!existingBranding?.logoUrl) {
    try {
      const logoUrl = await uploadLogo(tenant.id);
      await prisma.branding.update({ where: { tenantId: tenant.id }, data: { logoUrl } });
      console.log(`  ✓ logo → ${logoUrl}`);
    } catch (err) {
      console.log(`  ! logo not uploaded (${(err as Error).message}) — upload it from the store admin`);
    }
  }

  const settings = { storeName: NAME, currency: CURRENCY_ISO };
  await prisma.tenantSettings.upsert({
    where: { tenantId: tenant.id },
    update: settings,
    create: { tenantId: tenant.id, ...settings },
  });

  // Products: upsert by the legacy SKU; slugs are assigned once and kept.
  const existing = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    select: { sku: true, slug: true },
  });
  const slugBySku = new Map(existing.map((p) => [p.sku, p.slug]));
  const takenSlugs = new Set(existing.map((p) => p.slug).filter((s): s is string => !!s));
  for (const p of products) {
    const sku = p.id; // mapLegacyProduct already set id = legacySku(uuid)
    const slug = slugBySku.get(sku) ?? uniqueize(slugify(p.name), takenSlugs);
    takenSlugs.add(slug);
    const write = productToDbWrite(p, CURRENCY_ISO, CURRENCY_SYMBOL) as unknown as Prisma.ProductUncheckedCreateInput;
    await prisma.product.upsert({
      where: { tenantId_sku: { tenantId: tenant.id, sku } },
      update: { ...write, slug },
      create: { ...write, tenantId: tenant.id, sku, slug },
    });
  }
  const count = await prisma.product.count({ where: { tenantId: tenant.id } });
  console.log(`  ✓ products upserted (${products.length}) — tenant now has ${count}`);
  console.log(`\n  Next: re-host images, import orders, grant features (see header).`);
  console.log(`  Live at https://${SLUG}.${(process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "pepweb.store").replace(/:\d+$/, "")}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
