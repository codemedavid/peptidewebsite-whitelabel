"use server";

// Subscription-payment actions — the write half of the tenant Billing feature.
//
//   • submitSubscriptionPaymentAction  (TENANT side, requireStorefrontAdmin)
//       The store owner files a proof-of-payment for their subscription term
//       from the store admin's Billing view. Written through withTenant so the
//       row is tenant-scoped like every other storefront write.
//
//   • confirm / rejectSubscriptionPaymentAction  (OPERATOR side, requirePlatformUser)
//       The platform operator reviews a filed payment on the tenant-detail
//       Billing tab. Transitions are owned by lib/subscription/payments.ts
//       (test:subscription-payments) — illegal transitions are refused here.
//
// Both fail closed on demo mode (no DB) and revalidate the tenant + admin caches.

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-client";
import { requireStorefrontAdmin } from "@/lib/auth/storefront-admin";
import { requirePlatformUser } from "@/lib/auth/session";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { isDemoMode } from "@/lib/demo/fixtures";
import {
  applyReview,
  isSubscriptionPaymentStatus,
  normalizePaymentMethodWith,
  parsePaymentAmountCents,
  paymentMethodOptions,
  tenantInvoiceRowsFrom,
  type SubscriptionPaymentReview,
  type TenantInvoiceRow,
} from "@/lib/subscription/payments";
import { getPackagePayment } from "@/lib/platform/package-payment-server";
import {
  visiblePackagePaymentMethods,
  type PackagePaymentMethod,
} from "@/lib/platform/package-payment";

export type SubscriptionPaymentActionResult = { ok: true } | { error: string };

const MAX_REFERENCE_LEN = 120;

/** A valid hosted proof URL, or null. Rejects `data:`/`javascript:` — a proof
 *  must be a real ImageKit URL uploaded via uploadStorefrontImageAction. */
function safeProofUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  return /^https:\/\//i.test(raw.trim()) ? raw.trim() : null;
}

export type SubmitSubscriptionPaymentInput = {
  /** Raw peso amount the tenant typed (e.g. "1499" or "₱1,499.00"). */
  amount: string;
  method?: string;
  reference?: string;
  /** ISO date / datetime-local string of when they paid. */
  paidAt?: string;
  /** Proof screenshot, already uploaded via uploadStorefrontImageAction. */
  proofUrl?: string;
};

/**
 * Tenant files a proof-of-payment against their current subscription term. The
 * cycle + term are snapshotted from the operator-set window so the row keeps its
 * context even if the window later changes.
 */
export async function submitSubscriptionPaymentAction(
  input: SubmitSubscriptionPaymentInput,
): Promise<SubscriptionPaymentActionResult> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Sign in to the store admin to submit a payment." };
  if (isDemoMode()) return { error: "Connect a database to submit subscription payments." };

  const amountCents = parsePaymentAmountCents(input.amount ?? "");
  if (amountCents == null) return { error: "Enter a valid payment amount." };

  // Normalize the method against the platform's live receiving accounts
  // (/admin/payments) — the same options the Billing form offers. Fail-open to
  // the raw→Other rule if the platform config can't be read.
  let method = "Other";
  try {
    const channels = visiblePackagePaymentMethods(await getPackagePayment());
    method = normalizePaymentMethodWith(
      input.method ?? "",
      paymentMethodOptions(channels.map((m) => m.method)),
    );
  } catch {
    method = normalizePaymentMethodWith(input.method ?? "", paymentMethodOptions([]));
  }
  const reference = (input.reference ?? "").trim().slice(0, MAX_REFERENCE_LEN);
  const proofUrl = safeProofUrl(input.proofUrl);

  const paid = input.paidAt ? new Date(input.paidAt) : null;
  const paidAt = paid && !Number.isNaN(paid.getTime()) ? paid : null;

  // Snapshot the current window (cycle + term) for context on the row.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { subscriptionCycle: true, subscriptionStartsAt: true, subscriptionEndsAt: true },
  });

  try {
    await withTenant(tenantId, (db) =>
      db.subscriptionPayment.create({
        data: {
          tenantId,
          amountCents,
          method,
          reference,
          proofUrl,
          paidAt,
          cycle: tenant?.subscriptionCycle ?? null,
          periodStart: tenant?.subscriptionStartsAt ?? null,
          periodEnd: tenant?.subscriptionEndsAt ?? null,
          status: "pending",
        },
      }),
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the payment." };
  }

  revalidateTenant(tenantId);
  revalidateTag("admin:data");
  return { ok: true };
}

export type BillingPaymentChannel = Pick<
  PackagePaymentMethod,
  "id" | "method" | "account" | "number" | "note" | "qrUrl"
>;

/**
 * The platform's receiving accounts for the tenant Billing page — how the store
 * owner actually pays their provider. Same source the public /get-started
 * checkout shows (package_payment PlatformSetting, operator-edited on
 * /admin/payments). Fails open to an empty list; the form then falls back to
 * the default method catalogue.
 */
export async function getBillingPaymentInfoAction(): Promise<
  { instructions: string; channels: BillingPaymentChannel[] } | { error: string }
> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Sign in to the store admin to view payment options." };
  try {
    const config = await getPackagePayment();
    return {
      instructions: config.instructions,
      channels: visiblePackagePaymentMethods(config).map(({ id, method, account, number, note, qrUrl }) => ({
        id,
        method,
        account,
        number,
        note,
        qrUrl,
      })),
    };
  } catch {
    return { instructions: "", channels: [] };
  }
}

/** Most-recent rows the tenant invoice table shows (metrics are operator-side). */
const INVOICE_HISTORY_LIMIT = 60;

/**
 * The tenant's own invoice history for the store-admin Billing page. Read-only
 * and tenant-scoped (withTenant). Fails open to an empty list on read errors —
 * e.g. the subscription_payments table not yet pushed ([[live-db-state]]) — so
 * the Billing page renders without a history rather than erroring.
 */
export async function listMySubscriptionPaymentsAction(): Promise<
  { payments: TenantInvoiceRow[] } | { error: string }
> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Sign in to the store admin to view billing history." };
  if (isDemoMode()) return { payments: [] };

  try {
    const rows = await withTenant(tenantId, (db) =>
      db.subscriptionPayment.findMany({
        where: { tenantId },
        orderBy: { submittedAt: "desc" },
        take: INVOICE_HISTORY_LIMIT,
        select: { id: true, amountCents: true, status: true, method: true, paidAt: true, submittedAt: true },
      }),
    );
    return { payments: tenantInvoiceRowsFrom(rows) };
  } catch {
    return { payments: [] };
  }
}

/** Confirm / reject a filed payment. Shared operator-side core. */
async function reviewSubscriptionPayment(
  paymentId: string,
  action: SubscriptionPaymentReview,
): Promise<SubscriptionPaymentActionResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: "Connect a database to review subscription payments." };
  if (!paymentId) return { error: "Missing payment id." };

  const payment = await prisma.subscriptionPayment.findUnique({
    where: { id: paymentId },
    select: { id: true, status: true, tenantId: true, tenant: { select: { slug: true } } },
  });
  if (!payment) return { error: "Payment not found." };
  if (!isSubscriptionPaymentStatus(payment.status)) return { error: "Payment has an unknown status." };

  const next = applyReview(payment.status, action);
  if (!next) return { error: `Cannot ${action} a payment that is already ${payment.status}.` };

  await prisma.subscriptionPayment.update({
    where: { id: paymentId },
    data: { status: next, reviewedAt: new Date() },
  });

  revalidateTenant(payment.tenantId, payment.tenant.slug);
  revalidateTag("admin:data");
  revalidatePath(`/admin/tenants/${payment.tenant.slug}`);
  return { ok: true };
}

export async function confirmSubscriptionPaymentAction(
  paymentId: string,
): Promise<SubscriptionPaymentActionResult> {
  return reviewSubscriptionPayment(paymentId, "confirm");
}

export async function rejectSubscriptionPaymentAction(
  paymentId: string,
): Promise<SubscriptionPaymentActionResult> {
  return reviewSubscriptionPayment(paymentId, "reject");
}
