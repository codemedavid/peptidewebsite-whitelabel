"use server";

// Super Admin actions for settling a tenant's subscription due date straight
// from /admin/calendar — the operator's "this one paid" tick.
//
// Sibling of admin-calendar.ts (the operator's own schedule entries, which never
// touch a tenant). These two DO touch a tenant, in exactly the three ways
// lib/admin/calendar-settlement.ts plans:
//
//   • a CONFIRMED SubscriptionPayment lands in the ledger My Income rolls up;
//   • the tenant's subscription window rolls forward, which is what clears the
//     near-due countdown on their store admin (near-due.ts reads the window,
//     never the ledger);
//   • optionally the next term is re-priced, stored both as the term total and
//     as its monthly equivalent so MRR stays a per-month figure.
//
// Both writes go through ONE transaction: a payment recorded without its window
// roll would leave the tenant reading "due soon" despite having paid, which is
// the exact confusion this feature removes.
//
// Operator-gated, demo-blocked, and validated in the pure core
// (npm run test:calendar-paid) so the boundary rules are testable without a DB.

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformUser } from "@/lib/auth/session";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { isDemoMode } from "@/lib/demo/fixtures";
import {
  buildSettlementIndex,
  planSettlement,
  planSettlementReversal,
} from "@/lib/admin/calendar-settlement";

export type CalendarPaymentResult = { ok: true } | { error: string };

const DEMO_BLOCKED = "Connect a database to record subscription payments.";

/** Shown when subscription_payments hasn't been pushed yet ([[live-db-state]]). */
const NOT_PUSHED =
  "Could not save — has the subscription_payments table been pushed? (npm run db:push)";

const TENANT_SELECT = {
  id: true,
  slug: true,
  status: true,
  subscriptionStartsAt: true,
  subscriptionEndsAt: true,
  subscriptionCycle: true,
} as const;

function bust(tenantId: string, slug: string) {
  revalidateTenant(tenantId, slug);
  revalidatePath("/admin/calendar");
  revalidatePath("/admin/income");
  revalidatePath(`/admin/tenants/${slug}`);
  revalidateTag("admin:data");
}

export type MarkSubscriptionPaidInput = {
  tenantId: string;
  /** The due date being settled, "YYYY-MM-DD". */
  dueDay: string;
  /** Peso amount received, as typed. */
  amount: string;
  /** When the money landed; defaults to the due date. */
  paidDay?: string;
  method?: string;
  /** Cycle going forward — monthly | quarterly | semi_annual | yearly. */
  cycle?: string;
  /** Peso amount to charge for the NEXT term; blank leaves pricing alone. */
  billAmount?: string;
  /** Overrides the cycle-derived next due date. */
  nextDueDay?: string;
};

/**
 * Record a subscription payment against a tenant's due date and roll their
 * window forward. Settling the same due date twice writes a second payment, but
 * buildSettlementIndex keeps the later one, so the calendar shows a single paid
 * chip rather than a stack.
 */
export async function markSubscriptionPaidAction(
  input: MarkSubscriptionPaidInput,
): Promise<CalendarPaymentResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: DEMO_BLOCKED };

  const tenantId = (input.tenantId ?? "").trim();
  if (!tenantId) return { error: "Missing the tenant to settle." };

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: TENANT_SELECT });
  if (!tenant) return { error: "That tenant no longer exists." };

  const parsed = planSettlement({
    tenant,
    dueDay: input.dueDay,
    amount: input.amount,
    paidDay: input.paidDay,
    method: input.method,
    cycle: input.cycle,
    billAmount: input.billAmount,
    nextDueDay: input.nextDueDay,
    now: new Date(),
  });
  if (!parsed.ok) return { error: parsed.error };

  const { payment, nextWindow, nextBilling } = parsed.value;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.subscriptionPayment.create({
        data: { ...payment, reviewedAt: new Date(), submittedAt: payment.paidAt },
      });

      // The window roll and the re-price are what the TENANT sees; without them
      // the countdown keeps nagging a tenant who has already paid.
      const tenantData: {
        subscriptionStartsAt?: Date;
        subscriptionEndsAt?: Date;
        subscriptionCycle?: string;
        subscriptionAmountCents?: number;
        subscriptionPriceCents?: number;
      } = {};
      if (nextWindow) {
        tenantData.subscriptionStartsAt = nextWindow.startsAt;
        tenantData.subscriptionEndsAt = nextWindow.endsAt;
        tenantData.subscriptionCycle = payment.cycle;
      }
      if (nextBilling) {
        tenantData.subscriptionAmountCents = nextBilling.termCents;
        tenantData.subscriptionPriceCents = nextBilling.monthlyCents;
      }
      if (Object.keys(tenantData).length > 0) {
        await tx.tenant.update({ where: { id: tenantId }, data: tenantData });
      }
    });
  } catch {
    return { error: NOT_PUSHED };
  }

  bust(tenantId, tenant.slug);
  return { ok: true };
}

/**
 * Undo a calendar mark-paid: delete the payment and, when the window still
 * carries this settlement's fingerprint, roll it back to the term the payment
 * covered. A window the operator has since edited by hand is left standing —
 * planSettlementReversal decides which, so the rule is testable.
 */
export async function undoSubscriptionPaidAction(
  paymentId: string,
): Promise<CalendarPaymentResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: DEMO_BLOCKED };

  const id = (paymentId ?? "").trim();
  if (!id) return { error: "Missing the payment to undo." };

  const row = await prisma.subscriptionPayment
    .findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        amountCents: true,
        status: true,
        method: true,
        periodStart: true,
        periodEnd: true,
        paidAt: true,
        submittedAt: true,
        reviewNote: true,
        tenant: { select: { slug: true, subscriptionStartsAt: true, subscriptionEndsAt: true } },
      },
    })
    .catch(() => null);
  if (!row) return { error: "That payment no longer exists." };

  // Round-trip through the index so `fromCalendar` is decided by one rule.
  const settlement = [...buildSettlementIndex([row]).values()][0];
  if (!settlement) return { error: "That payment is no longer confirmed." };

  const parsed = planSettlementReversal({ settlement, tenant: row.tenant });
  if (!parsed.ok) return { error: parsed.error };

  const { restore } = parsed.value;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.subscriptionPayment.delete({ where: { id } });
      if (restore) {
        await tx.tenant.update({
          where: { id: row.tenantId },
          data: { subscriptionStartsAt: restore.startsAt, subscriptionEndsAt: restore.endsAt },
        });
      }
    });
  } catch {
    return { error: "Could not undo that payment." };
  }

  bust(row.tenantId, row.tenant.slug);
  return { ok: true };
}
