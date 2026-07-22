/**
 * READ-ONLY: print exactly what /admin/income computes from the LIVE database —
 * the same inputs and roll-up as src/lib/admin/income-data.ts (minus Next
 * runtime), so the operator can verify the page's numbers are real, not mock.
 *
 *   npx tsx --env-file=.env scripts/inspect-income.ts
 */
import { PrismaClient } from "@prisma/client";
import { buildIncomeAnalytics } from "../src/lib/admin/income-analytics";
import { normalizePlanConfig, defaultPlanConfig, PLAN_CONFIG_KEY } from "../src/lib/platform/plan-config";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const peso = (c: number) => "₱" + Math.round(c / 100).toLocaleString("en-PH");

async function main() {
  const now = new Date();

  // Plan config (operator-edited prices), falling back to defaults.
  let planConfig = defaultPlanConfig();
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: PLAN_CONFIG_KEY } });
    if (row) planConfig = normalizePlanConfig(row.value);
  } catch {
    console.log("(plan_config not readable — using default prices)");
  }

  // Tenants, fail-open on missing subscription columns (same as the page).
  let tenants;
  try {
    tenants = (
      await prisma.tenant.findMany({
        select: {
          id: true,
          name: true,
          status: true,
          plan: { select: { key: true } },
          subscriptionStartsAt: true,
          subscriptionEndsAt: true,
          subscriptionCycle: true,
          subscriptionPriceCents: true,
        },
      })
    ).map((t) => ({ ...t, planKey: t.plan.key }));
  } catch {
    console.log("(subscription columns missing — page would degrade to no windows)");
    tenants = (
      await prisma.tenant.findMany({
        select: { id: true, name: true, status: true, plan: { select: { key: true } } },
      })
    ).map((t) => ({ ...t, planKey: t.plan.key }));
  }

  let payments: Array<{ tenantId: string; amountCents: number; status: string; paidAt: Date | null; submittedAt: Date }> = [];
  try {
    payments = await prisma.subscriptionPayment.findMany({
      select: { tenantId: true, amountCents: true, status: true, paidAt: true, submittedAt: true },
    });
  } catch {
    console.log("(subscription_payments table missing — page would show an empty ledger)");
  }

  console.log(`tenants: ${tenants.length} (active: ${tenants.filter((t) => t.status === "active").length})`);
  console.log(`windows set: ${tenants.filter((t) => "subscriptionEndsAt" in t && t.subscriptionEndsAt).length}`);
  console.log(`ledger rows: ${payments.length} (confirmed: ${payments.filter((p) => p.status === "confirmed").length})`);

  const out = buildIncomeAnalytics({ tenants, payments, planConfig }, now);
  console.log("\n=== /admin/income would show ===");
  console.log(`MRR: ${peso(out.mrrCents)}  (${out.activeBilledCount} active tenants)`);
  console.log(`Collected this month: ${peso(out.collectedThisMonthCents)} (${out.collectedPct}% of expected, ${out.paidTenantCountThisMonth} paid)`);
  console.log(`Projected next 3 mo: ${peso(out.projectedNext3moCents)} (at-risk excluded: ${peso(out.atRiskMonthlyCents)}/mo)`);
  console.log(`Monthly actuals ${out.monthly.labels.join(",")}: ${out.monthly.actualCents.map(peso).join(", ")}`);
  console.log(`Upcoming renewals: ${out.upcoming.length} (next 30d: ${out.upcoming30dCount} → ${peso(out.upcoming30dTotalCents)})`);
  for (const u of out.upcoming.slice(0, 10)) {
    console.log(`  - ${u.name} [${u.planLabel}] ${peso(u.monthlyCents)}/mo renews ${u.renewsIso.slice(0, 10)} (${u.urgency})`);
  }
  console.log(`Plan breakdown: ${out.planBreakdown.map((p) => `${p.label} ${p.tenantCount}× ${peso(p.mrrCents)} (${p.pctOfMrr}%)`).join(" | ") || "(none)"}`);
  console.log(`At-risk: ${out.atRisk.map((r) => `${r.name} ${peso(r.monthlyCents)} (${r.note})`).join(" | ") || "(none)"}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
