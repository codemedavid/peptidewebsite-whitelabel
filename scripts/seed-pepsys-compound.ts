/**
 * Provision the tenant `pepsys-compound` — "Pep-sy's Compound".
 *
 * Idempotent: upserts the Tenant + Branding + TenantSettings rows, so re-running
 * re-applies the brief without duplicating anything. Existing catalog, orders and
 * owner-authored collections (COA reports, protocols, FAQ, payment methods) are
 * left alone — this script owns identity, palette, typography and contact copy.
 *
 * Run from the project root:
 *   npx tsx scripts/seed-pepsys-compound.ts
 *
 * ── Brief ────────────────────────────────────────────────────────────────────
 *   Business  Pep-sy's Compound — "Premium Peptide Solutions"
 *   Currency  PHP (₱)
 *   Theme     Light, white background, rounded, playful wellness-lab
 *   Palette   Teal #3EDAD6 (primary) · Pink #FF7EB6 (secondary)
 *             Navy #0E3A47 (headings) · Yellow #FFD84D + Cyan #36C5F0 (accents)
 *   Fonts     Poppins (headings) / Inter (body)
 *
 * ── How the five brief colors map onto the Brand color roles ─────────────────
 * The storefront Brand exposes more color roles than the brief names, and two of
 * them are load-bearing for legibility, so the mapping is deliberate:
 *
 *   button      #3EDAD6  teal — the primary CTA fill.
 *   button2     #FF7EB6  pink — the CTA gradient end ("secondary").
 *   buttonText  #0E3A47  navy on teal = 7.1:1. White on teal is 1.7:1 and would
 *                        fail WCAG AA outright, so CTA text is navy, not white.
 *   main        #0E3A47  navy — headings + brand mark, exactly as briefed.
 *   text        #0E3A47  navy — body copy.
 *   accent      #D6336C  Brand.accent renders as TEXT (links, chips, the outline-
 *                        button label, focus rings — see --brand-accent in
 *                        storefront.css). #FF7EB6 on white is 2.35:1 and is
 *                        unreadable there, so accent is the same pink family
 *                        deepened to 4.6:1 while #FF7EB6 keeps the fill role.
 *   background  #F6FDFD  a breath of teal so white cards have something to sit
 *                        on; still reads as a white page.
 *   surface     #FFFFFF  pure white cards.
 *
 * Cyan is softened to #BFE9F8 and drives the hairline that frames every card and
 * panel. Yellow #FFD84D is deliberately NOT wired to a role: every remaining
 * Brand slot renders type, and yellow tops out at 1.3:1 on a white page. It is
 * left for the announcement banner and Card Studio, where it sits behind dark
 * text as a fill rather than as ink.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { hexToHslTriple } from "../src/lib/theme/color";
import { BRAND } from "../src/storefront/data";
import type { Brand } from "../src/storefront/types";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const SLUG = "pepsys-compound";
const NAME = "Pep-sy's Compound";
const TAGLINE = "Premium Peptide Solutions";
const PLAN_KEY = "pro";
const STATUS = "active";
/** Base light theme the role overrides sit on top of (teal-leaning, light mode). */
const THEME_ID = "ocean-breeze";
/** Playful wellness-lab = generous rounding. */
const RADIUS = "1rem";
/** Storefront #admin password. Change it in admin → Tenant → Settings. */

/**
 * No logo is seeded. The owner uploads it from the white-label store admin,
 * which writes an ImageKit URL — the way every other live tenant carries its
 * logo. Blank renders the letter-tile fallback instead of a broken image.
 * main() carries an already-uploaded logo forward, so re-running never clobbers
 * one.
 */
const LOGO_URL = "";
const SUPPORT_EMAIL = "peptidewhisperer@gmail.com";
const SECONDARY_EMAIL = "thepeptidepulse@gmail.com";
const WHATSAPP = "639062349763";
/** Telegram invite hash. channelUrl() (storefront/checkout.ts) renders a
 *  non-numeric destination as `https://t.me/<dest>`, so "+k3Sf…" reproduces the
 *  invite link the owner supplied. */
const TELEGRAM = "+k3SfL4WjnMQ3NGRl";
const TIKTOK = "peptidepulse20";

const COLORS = {
  teal: "#3EDAD6",
  pink: "#FF7EB6",
  pinkInk: "#D6336C", // AA-legible member of the pink family, for text roles
  navy: "#0E3A47",
  yellow: "#FFD84D", // reserved for banner/badge fills — see header note
  cyanHairline: "#BFE9F8", // #36C5F0 softened to a frame weight
  background: "#F6FDFD",
  surface: "#FFFFFF",
} as const;

/** Role colors as HSL triples — the same shape the branding editor writes. */
const ROLE_COLORS: Record<string, string> = {
  main: hexToHslTriple(COLORS.navy),
  accent: hexToHslTriple(COLORS.pinkInk),
  button: hexToHslTriple(COLORS.teal),
  buttonText: hexToHslTriple(COLORS.navy),
  background: hexToHslTriple(COLORS.background),
  surface: hexToHslTriple(COLORS.surface),
  text: hexToHslTriple(COLORS.navy),
};

const FONTS = { heading: "Poppins", body: "Inter" };

/** Full storefront Brand blob: the shipped defaults with this store's brief on top. */
const CONFIG: Brand = {
  ...BRAND,

  name: NAME,
  logoUrl: LOGO_URL,
  logoCurve: 22,
  ctaLabel: "Shop Now",
  industry: "premium peptides",
  currency: "₱",

  main: COLORS.navy,
  accent: COLORS.pinkInk,
  button: COLORS.teal,
  button2: COLORS.pink,
  buttonText: COLORS.navy,
  background: COLORS.background,
  surface: COLORS.surface,
  text: COLORS.navy,
  headerBg: COLORS.surface,
  headerText: COLORS.navy,
  borderColor: COLORS.cyanHairline,
  borderWidth: 1,

  headingFont: FONTS.heading,
  bodyFont: FONTS.body,
  buttonFont: FONTS.heading,

  adminLoginTitle: "Store Admin",
  adminLoginSub: "Enter your store password to continue.",

  heroVariant: "centered",
  heroShowChip: true,
  heroChipLabel: "Lab-verified · Research use only",
  heroLine1: "Premium peptide",
  heroLine2: "solutions.",
  heroSub:
    "Research-grade peptides with third-party lab verification, clear protocols and discreet nationwide delivery across the Philippines.",
  heroCta1: "Shop Now",
  heroCta2: "Talk to us",
  heroCta2LinkType: "custom",
  heroCta2LinkUrl: `https://wa.me/${WHATSAPP}`,
  // The second headline line. Left unset it takes the default accent → button2
  // gradient, whose #FF7EB6 end lands at 2.35:1; #FFD84D would be 1.3:1. Pinned
  // to the legible pink so the biggest text on the page actually reads.
  heroHighlight: COLORS.pinkInk,

  catalogEyebrow: "Catalog",
  catalogTitle: "Shop the compound",

  footerBlurb: `${TAGLINE} — lab-verified, transparently priced, shipped discreetly nationwide.`,
  footerSocials: [
    { label: "TikTok", href: `https://www.tiktok.com/@${TIKTOK}`, icon: "tiktok", show: true },
    { label: "Telegram", href: `https://t.me/${TELEGRAM}`, icon: "telegram", show: true },
    { label: "WhatsApp", href: `https://wa.me/${WHATSAPP}`, icon: "whatsapp", show: true },
  ],
  footerColumns: [
    {
      title: "Shop",
      links: [
        { label: "All Products", href: "#catalog" },
        { label: "Track Order", href: "#track" },
      ],
    },
    {
      title: "Support",
      links: [
        { label: "FAQ", href: "#faq" },
        { label: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}` },
        { label: SECONDARY_EMAIL, href: `mailto:${SECONDARY_EMAIL}` },
      ],
    },
    {
      title: "Resources",
      links: [
        { label: "Lab Reports", href: "#coa" },
        { label: "Protocols", href: "#protocols" },
        { label: "Calculator", href: "#calculator" },
      ],
    },
  ],

  checkoutTitle: "Complete your order",
  checkoutNote:
    "Send your order through your preferred app and we'll confirm availability, total and shipping.",
  contactChannels: [
    { type: "whatsapp", destination: WHATSAPP, enabled: true },
    { type: "telegram", destination: TELEGRAM, enabled: true },
    { type: "messenger", destination: "", enabled: false },
    { type: "viber", destination: "", enabled: false },
    { type: "gmail", destination: SUPPORT_EMAIL, enabled: true },
    { type: "instagram", destination: "", enabled: false },
  ],
  metaDescription: `${NAME} — ${TAGLINE}. Lab-verified research peptides with clear protocols and discreet nationwide delivery.`,
};

async function main() {
  const plan = await prisma.plan.findUnique({ where: { key: PLAN_KEY } });
  if (!plan) throw new Error(`Plan not seeded: ${PLAN_KEY}. Run: npm run db:seed`);

  // ── Logo ownership: the Branding.logoUrl COLUMN, never the config blob ──────
  // page.tsx resolves the header logo as `config.logoUrl || branding.logoUrl`,
  // so a non-empty config.logoUrl silently shadows the column. The store-admin
  // uploader (uploadBrandingAsset, actions/branding.ts) writes ONLY the column —
  // so any value here makes uploads look broken. An earlier version of this
  // script seeded "/assets/logo.jpg", which is exactly what shadowed two real
  // uploads.
  //
  // Therefore: config.logoUrl is pinned empty and the column is left untouched
  // on update. The column is the single source of truth, and every future upload
  // shows up immediately.
  const existing = await prisma.branding.findFirst({
    where: { tenant: { slug: SLUG } },
    select: { logoUrl: true },
  });
  const uploadedLogo = existing?.logoUrl ?? LOGO_URL;

  const config = { ...CONFIG, logoUrl: "" } as unknown as Prisma.InputJsonValue;
  const branding = {
    themeId: THEME_ID,
    colors: ROLE_COLORS,
    fonts: FONTS,
    config,
    radius: RADIUS,
  };

  const tenant = await prisma.tenant.upsert({
    where: { slug: SLUG },
    update: { name: NAME, status: STATUS, planId: plan.id },
    create: { name: NAME, slug: SLUG, status: STATUS, planId: plan.id },
  });

  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: branding, // no logoUrl — the owner's upload owns that column
    create: { tenantId: tenant.id, logoUrl: LOGO_URL, ...branding },
  });

  const settings = { storeName: NAME, supportEmail: SUPPORT_EMAIL, currency: "PHP" };
  await prisma.tenantSettings.upsert({
    where: { tenantId: tenant.id },
    update: settings,
    create: { tenantId: tenant.id, ...settings },
  });

  const root = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").replace(/:\d+$/, "");
  console.log(`✓ ${NAME} (${SLUG}) — ${PLAN_KEY}/${STATUS}, theme ${THEME_ID}`);
  console.log(`  live at   https://${SLUG}.${root}`);
  console.log(`  local at  http://${SLUG}.lvh.me:3100`);
  console.log("  #admin sign-in: set the email + password in admin → tenant settings");
  console.log(
    uploadedLogo
      ? `  logo: branding.logoUrl = ${uploadedLogo} (config.logoUrl cleared so it shows)`
      : `  logo: none — upload it from the store admin (letter-tile fallback until then)`,
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
