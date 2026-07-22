// Server loader for the Super Admin "My Income" page (/admin/income).
// Gathers the pure buildIncomeAnalytics inputs from the live DB (or the demo
// fixtures) and returns the JSON-safe IncomeAnalytics the client view renders.
//
// Fail-open like the rest of the admin loaders (see loadTenantSubscriptionSignals
// in data.ts): a not-yet-migrated subscription column or a missing
// subscription_payments table degrades to "no windows / empty ledger" instead of
// taking the page down.

import "server-only";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode, listDemoTenants } from "@/lib/demo/fixtures";
import { getPlanConfig } from "@/lib/platform/plan-config-server";
import { planMeta } from "@/lib/admin/plans";
import {
  buildIncomeAnalytics,
  type IncomeAnalytics,
  type IncomePaymentInput,
  type IncomeTenantInput,
} from "@/lib/admin/income-analytics";

const DAY_MS = 86_400_000;
/** Ledger history window: covers the 6 chart months plus slack. */
const LEDGER_MONTHS_BACK = 8;

/** Tenant rows with the subscription window columns, degrading to no windows
 *  when those columns aren't on the DB yet (pending db:push). */
async function loadIncomeTenants(): Promise<IncomeTenantInput[]> {
  const baseSelect = {
    id: true,
    name: true,
    status: true,
    plan: { select: { key: true } },
  } as const;
  try {
    const rows = await prisma.tenant.findMany({
      select: {
        ...baseSelect,
        subscriptionStartsAt: true,
        subscriptionEndsAt: true,
        subscriptionCycle: true,
        subscriptionPriceCents: true,
      },
    });
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      planKey: t.plan.key,
      status: t.status,
      subscriptionPriceCents: t.subscriptionPriceCents,
      subscriptionStartsAt: t.subscriptionStartsAt,
      subscriptionEndsAt: t.subscriptionEndsAt,
      subscriptionCycle: t.subscriptionCycle,
    }));
  } catch {
    try {
      const rows = await prisma.tenant.findMany({ select: baseSelect });
      return rows.map((t) => ({ id: t.id, name: t.name, planKey: t.plan.key, status: t.status }));
    } catch {
      return [];
    }
  }
}

/** Ledger rows for the chart window; [] when the subscription_payments table
 *  isn't on the DB yet. */
async function loadIncomePayments(now: Date): Promise<IncomePaymentInput[]> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - LEDGER_MONTHS_BACK, 1));
  try {
    return await prisma.subscriptionPayment.findMany({
      where: { submittedAt: { gte: since } },
      select: { tenantId: true, amountCents: true, status: true, paidAt: true, submittedAt: true },
    });
  } catch {
    return [];
  }
}

/** Deterministic demo inputs so the demo console shows a meaningful income
 *  page: every demo tenant is an active subscriber; each paid its plan fee in
 *  the past months; the current month is partially collected; one tenant is
 *  overdue and one due soon (index-derived, no randomness). */
function demoIncomeInputs(now: Date): { tenants: IncomeTenantInput[]; payments: IncomePaymentInput[] } {
  const demo = listDemoTenants();
  const tenants: IncomeTenantInput[] = demo.map((t, i) => {
    // Renewal dates fan out across the next month; index 0 is 4 days overdue,
    // index 1 is due in 3 days (inside NEAR_DUE_DAYS).
    const offsetDays = i === 0 ? -4 : i === 1 ? 3 : 6 + i * 5;
    const endsAt = new Date(now.getTime() + offsetDays * DAY_MS);
    return {
      id: t.id,
      name: t.name,
      planKey: t.plan,
      status: "active",
      subscriptionStartsAt: new Date(endsAt.getTime() - 30 * DAY_MS),
      subscriptionEndsAt: endsAt,
      subscriptionCycle: "monthly",
    };
  });
  const payments: IncomePaymentInput[] = [];
  for (let m = 1; m <= 6; m++) {
    const paidAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 15));
    for (const t of tenants) {
      payments.push({
        tenantId: t.id,
        amountCents: planMeta(t.planKey).priceCents,
        status: "confirmed",
        paidAt,
        submittedAt: paidAt,
      });
    }
  }
  // Current month: the first ~60% of tenants have already paid.
  const paidCount = Math.ceil(tenants.length * 0.6);
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(10, now.getUTCDate())));
  for (const t of tenants.slice(0, paidCount)) {
    payments.push({
      tenantId: t.id,
      amountCents: planMeta(t.planKey).priceCents,
      status: "confirmed",
      paidAt: thisMonth,
      submittedAt: thisMonth,
    });
  }
  return { tenants, payments };
}

/** The /admin/income page's data: real tenants + subscription-payment ledger
 *  (or the deterministic demo equivalent), rolled up by the pure core. */
export async function getIncomeAnalytics(): Promise<IncomeAnalytics> {
  const now = new Date();
  const planConfig = await getPlanConfig();
  if (isDemoMode()) {
    const { tenants, payments } = demoIncomeInputs(now);
    return buildIncomeAnalytics({ tenants, payments, planConfig }, now);
  }
  const [tenants, payments] = await Promise.all([loadIncomeTenants(), loadIncomePayments(now)]);
  return buildIncomeAnalytics({ tenants, payments, planConfig }, now);
}
