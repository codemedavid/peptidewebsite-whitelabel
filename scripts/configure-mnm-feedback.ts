/**
 * ONE-SHOT tenant config for `mnm-pepsabuy` (2026-10-28), from the owner's
 * "MNM Website: Updates, Questions & Clarifications" feedback:
 *
 *   • ₱250 admin fee rides in the order total, charged ONCE per member per
 *     group buy (adminFee.oncePerGroupBuy); the separate Paid Access join
 *     step is switched off (groupbuy.paid_access override → false)
 *   • courier picker removed (no couriers / locations) → Shopee checkout note
 *   • protocols page points to the Peptide Library at www.feelsbonita.com
 *   • COA page: the generic sample reports (Janoshik / Chromate) are cleared;
 *     the lab is TJQXGD. The owner uploads TR30 + TR15 in Admin → Lab Reports
 *   • the "TEST RUN · Bunuan" round is closed (kept for history, not deleted)
 *   • products show as a text-only price list (Card Studio layout "text")
 *   • Track Order page hidden (members track through Shopee)
 *   • FAQ: every default question removed; only the owner's own
 *     international-shipping answer is kept
 *
 * Dry run by default — prints the before/after. `--apply` writes.
 *
 *   npx tsx --env-file=.env scripts/configure-mnm-feedback.ts [--apply]
 *
 * After --apply the storefront keeps serving its cached config until something
 * busts the tenant cache: press Save on any store-admin branding screen, or
 * redeploy (see memory: migration-script-cache-gap).
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const SLUG = "mnm-pepsabuy";
const TEST_ROUND_NAME = "TEST RUN · Bunuan (do not order)";
const APPLY = process.argv.includes("--apply");

const INTERNATIONAL_Q = "Do you ship internationally or nationwide only?";
const INTERNATIONAL_A = "We do not ship internationally. Orders are available within the Philippines only.";
type FaqItem = { q: string; a: string };
type FaqGroup = { id: string; label: string; icon: string; items: FaqItem[] };

/** The owner's FAQ is exactly what their feedback sent (2026-10-28): every
 *  stock default question removed, only their own answer kept. */
const MNM_FAQ: FaqGroup[] = [
  { id: "shipping", label: "Shipping & Delivery", icon: "shipping", items: [{ q: INTERNATIONAL_Q, a: INTERNATIONAL_A }] },
];

function nextConfig(config: Record<string, unknown>): Record<string, unknown> {
  const card = (config.cardDesign ?? {}) as Record<string, unknown>;
  return {
    ...config,
    adminFee: { enabled: true, label: "Admin fee", mode: "fixed", amount: 250, percent: 0, oncePerGroupBuy: true },
    couriers: [],
    shippingLocations: [],
    checkoutNote: "All shipping checkouts will be done via Shopee, c/o the member.",
    protocolsSub:
      "General guidelines and protocols. Always consult with a healthcare professional before use. " +
      "To access more protocols, please visit our Peptide Library at www.feelsbonita.com.",
    coaReports: [],
    coaPartners: [{ label: "TJQXGD", href: "" }],
    coaInfoBody:
      "Our certificates of analysis are issued by TJQXGD, a local testing laboratory in China. " +
      "New reports are added here as more batches are tested.",
    cardDesign: { ...card, layout: "text", preset: "custom" },
    showPageTrack: false,
    faqGroups: MNM_FAQ,
  };
}

const CHANGED_KEYS = [
  "adminFee", "couriers", "shippingLocations", "checkoutNote", "protocolsSub", "coaReports",
  "coaPartners", "coaInfoBody", "cardDesign", "showPageTrack", "faqGroups",
] as const;

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: SLUG },
    select: { id: true, branding: { select: { config: true } } },
  });
  if (!tenant) throw new Error(`tenant ${SLUG} not found`);
  const config = (tenant.branding?.config ?? {}) as Record<string, unknown>;
  const next = nextConfig(config);

  for (const key of CHANGED_KEYS) {
    console.log(`\n── ${key}\n  before: ${JSON.stringify(config[key] ?? null)}\n  after:  ${JSON.stringify(next[key])}`);
  }

  const paidAccess = await prisma.feature.findUnique({ where: { key: "groupbuy.paid_access" }, select: { id: true } });
  if (!paidAccess) throw new Error("feature groupbuy.paid_access is not registered");
  const round = await prisma.groupBuy.findFirst({
    where: { tenantId: tenant.id, name: TEST_ROUND_NAME },
    select: { id: true, status: true },
  });
  const roundOrders = round ? await prisma.storefrontOrder.count({ where: { groupBuyId: round.id } }) : 0;
  console.log(`\n── groupbuy.paid_access override → false`);
  console.log(`── test round: ${round ? `${round.id} (${round.status}, ${roundOrders} orders) → closed` : "not found, skipped"}`);

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply.");
    return;
  }

  await prisma.$transaction([
    prisma.branding.update({ where: { tenantId: tenant.id }, data: { config: next as Prisma.InputJsonValue } }),
    prisma.tenantFeatureOverride.upsert({
      where: { tenantId_featureId: { tenantId: tenant.id, featureId: paidAccess.id } },
      update: { enabled: false },
      create: { tenantId: tenant.id, featureId: paidAccess.id, enabled: false },
    }),
    ...(round && round.status !== "closed"
      ? [prisma.groupBuy.update({ where: { id: round.id }, data: { status: "closed", closedAt: new Date() } })]
      : []),
  ]);
  console.log("\nApplied. NEXT: bust the tenant cache — press Save on any store-admin branding screen, or redeploy.");
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
