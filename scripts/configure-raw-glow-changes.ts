/**
 * ONE-SHOT tenant config for `raw-glow-wellness` (2026-10-22). Owner-requested
 * changes, read-modify-write into the shared branding.config blob:
 *
 *  1. Darker purple. `main` was #C4A1FF (pale lavender) — it colours the hero
 *     headline, page titles and the calculator results, which read too light on
 *     a laptop. Deepened to #5E3591 (~9:1 on the #FFFAFE background).
 *  2. Hero copy → "Natural Glow" / "starts here". The second line's highlight
 *     moves from pink to the brand button purple so the whole headline is purple.
 *  3. Shipping: add "Shopee Checkout" and "Lalamove" couriers. Neither has
 *     locations (noLocation:true → no zone picker, ₱0 added at checkout). The
 *     tenant had no saved couriers, so it fell back to SEED_COURIERS; we persist
 *     the seed list + the two new ones so J&T (and its zones) keeps working.
 *
 * Idempotent: re-running won't duplicate couriers.
 *
 *   npx tsx scripts/configure-raw-glow-changes.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { SEED_COURIERS } from "../src/storefront/data";
import type { Courier } from "../src/storefront/types";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const SLUG = "raw-glow-wellness";
const DARK_PURPLE = "#5E3591";
const HEADLINE_ACCENT = "#8552B8";

const NEW_COURIERS: Courier[] = [
  {
    id: "c-shopee",
    name: "Shopee Checkout",
    trackingUrl: "",
    active: true,
    noLocation: true,
    note: "We'll send you a Shopee checkout link to complete your order.",
  },
  { id: "c-lalamove", name: "Lalamove", trackingUrl: "", active: true, noLocation: true },
];

function withCouriers(base: Courier[]): Courier[] {
  const have = new Set(base.map((c) => c.name.trim().toLowerCase()));
  return [...base, ...NEW_COURIERS.filter((c) => !have.has(c.name.toLowerCase()))];
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!tenant) throw new Error(`tenant "${SLUG}" not found`);

  const branding = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  const config = (branding?.config ?? {}) as Record<string, unknown>;
  const base: Courier[] = Array.isArray(config.couriers) ? (config.couriers as Courier[]) : SEED_COURIERS;

  console.log(`BEFORE ${SLUG}: main=${config.main} heroLine1=${JSON.stringify(config.heroLine1)} heroLine2=${JSON.stringify(config.heroLine2)} heroHighlight=${config.heroHighlight}`);
  console.log(`  couriers: ${Array.isArray(config.couriers) ? base.map((c) => c.name).join(", ") : "(unset → seed)"}`);

  const next: Record<string, unknown> = {
    ...config,
    main: DARK_PURPLE,
    heroLine1: "Natural Glow",
    heroLine2: "starts here",
    heroHighlight: HEADLINE_ACCENT,
    couriers: withCouriers(base),
  };

  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: { config: next as Prisma.InputJsonValue },
  });

  const after = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  const a = (after?.config ?? {}) as Record<string, unknown>;
  console.log(`AFTER  ${SLUG}: main=${a.main} heroLine1=${JSON.stringify(a.heroLine1)} heroLine2=${JSON.stringify(a.heroLine2)} heroHighlight=${a.heroHighlight}`);
  console.log(`  couriers: ${(a.couriers as Courier[]).map((c) => c.name).join(", ")}`);
  console.log("done — the storefront caches branding: press Save on any store-admin branding screen (or redeploy) to see it live.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
