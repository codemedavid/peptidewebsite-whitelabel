/**
 * One-off: apply the Pepweb monthly pricelist + inclusions to the live DB.
 *
 * The 2026-07-16 landing redesign moved the code defaults to monthly pricing
 * (₱799 / ₱1,499 / ₱2,999 + setup fees), but a stored `plan_config`
 * PlatformSetting row from the old one-time model overrides defaults on every
 * pricing surface. This resets that row to defaultPlanConfig() — exactly what
 * /admin/plans "Reset to defaults → Save" persists — printing the old value
 * first as a backup. Run `npm run db:sync-features` afterwards (mirrors the
 * admin save action's catalog sync).
 *
 *   npx tsx scripts/apply-pepweb-pricing.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { PLAN_CONFIG_KEY, defaultPlanConfig } from "../src/lib/platform/plan-config";
import { formatPesos } from "../src/lib/admin/plans";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.platformSetting.findUnique({ where: { key: PLAN_CONFIG_KEY } });
  if (existing) {
    console.log("── BACKUP: previous plan_config value ──");
    console.log(JSON.stringify(existing.value));
    console.log("────────────────────────────────────────");
  } else {
    console.log("No stored plan_config row — defaults were already live.");
  }

  const config = defaultPlanConfig();
  await prisma.platformSetting.upsert({
    where: { key: PLAN_CONFIG_KEY },
    update: { value: config as unknown as Prisma.InputJsonValue },
    create: { key: PLAN_CONFIG_KEY, value: config as unknown as Prisma.InputJsonValue },
  });

  console.log("Applied new pricelist:");
  for (const p of config.plans) {
    const promo = p.discountPriceCents ? ` (first month ${formatPesos(p.discountPriceCents)})` : "";
    const setup = p.setupFeeCents
      ? p.setupFeeWaived
        ? ` + setup ${formatPesos(p.setupFeeCents)} WAIVED`
        : ` + setup ${formatPesos(p.setupFeeCents)}`
      : "";
    console.log(`  ${p.name}: ${formatPesos(p.priceCents)}/mo${promo}${setup} — ${p.feats.length} inclusions`);
  }
  console.log(`  Trial price: ${formatPesos(config.trialPriceCents)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
