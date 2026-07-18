/**
 * One-off: clear the Business (pro) first-month promo from the live DB.
 *
 * The ₱699 / 1-month trial offer was retired for new sign-ups (2026-07). The
 * code default no longer carries a pro `discountPriceCents`, but a stored
 * `plan_config` PlatformSetting row (set by scripts/apply-pepweb-pricing.ts)
 * still overrides defaults on every pricing surface — so the live marketing
 * site + wizard would keep quoting ₱699 first month until this row is fixed.
 *
 * This reads the stored row, prints it as a backup, strips ONLY the pro
 * plan's `discountPriceCents` (leaving every other operator edit intact), and
 * writes it back. Business then quotes flat ₱1,499 across site/wizard/checkout.
 * Equivalent to clearing the Business "First month" field on /admin/plans and
 * saving. Run `npm run db:sync-features` afterwards (mirrors the admin save).
 *
 *   npx tsx scripts/clear-business-first-month-promo.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { PLAN_CONFIG_KEY } from "../src/lib/platform/plan-config";

const prisma = new PrismaClient();

async function main() {
  const row = await prisma.platformSetting.findUnique({ where: { key: PLAN_CONFIG_KEY } });
  if (!row) {
    console.log("No stored plan_config row — defaults are already live (no promo). Nothing to do.");
    return;
  }

  console.log("── BACKUP: previous plan_config value ──");
  console.log(JSON.stringify(row.value));
  console.log("────────────────────────────────────────");

  const value = row.value as { plans?: Array<Record<string, unknown>> } | null;
  const plans = Array.isArray(value?.plans) ? value!.plans : [];
  let changed = false;
  const nextPlans = plans.map((p) => {
    if (p.key === "pro" && "discountPriceCents" in p) {
      changed = true;
      const { discountPriceCents, ...rest } = p;
      void discountPriceCents;
      return rest;
    }
    return p;
  });

  if (!changed) {
    console.log("Business plan has no stored first-month promo — nothing to clear.");
    return;
  }

  const next = { ...(value as object), plans: nextPlans };
  await prisma.platformSetting.update({
    where: { key: PLAN_CONFIG_KEY },
    data: { value: next as unknown as Prisma.InputJsonValue },
  });
  console.log("Cleared the Business first-month promo. Business now quotes flat monthly.");
  console.log("Run `npm run db:sync-features` to mirror the admin save action.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
