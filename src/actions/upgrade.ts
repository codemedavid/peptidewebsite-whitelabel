"use server";

// Store-owner side of the trial→Business upgrade (trial system). The owner
// reviews the server-computed order summary (Business monthly − trial credit),
// pays one of the platform's receiving accounts (the same operator-managed
// methods the get-started wizard charges through) and uploads proof; that files
// a PENDING UpgradeRequest the platform operator decides in Super Admin →
// Upgrades (actions/admin-upgrades.ts). Nothing here mutates the plan — only
// operator approval does.

import { prisma } from "@/lib/db/prisma";
import { isDemoMode } from "@/lib/demo/fixtures";
import { requireStoreOwner } from "@/lib/auth/staff-guard";
import { getTenantSlug } from "@/lib/tenant/headers";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { getPlanConfig } from "@/lib/platform/plan-config-server";
import { getPackagePayment } from "@/lib/platform/package-payment-server";
import { visiblePackagePaymentMethods, type PackagePaymentMethod } from "@/lib/platform/package-payment";
import { getTrialState } from "@/lib/trial/trial-info";
import { upgradeQuote, type UpgradeQuote } from "@/lib/trial/upgrade-quote";

export type UpgradeContext = {
  quote: UpgradeQuote;
  methods: PackagePaymentMethod[];
  /** An undecided request is already filed — the UI shows "in review". */
  pendingRequest: boolean;
  trialGoverned: boolean;
};

export async function getUpgradeContextAction(): Promise<UpgradeContext | { error: string }> {
  const tenantId = await requireStoreOwner();
  if (!tenantId) return { error: "You don't have permission to do that." };

  const [config, payment, trial] = await Promise.all([
    getPlanConfig(),
    getPackagePayment(),
    getTrialState(tenantId),
  ]);
  let pendingRequest = false;
  if (!isDemoMode()) {
    try {
      pendingRequest =
        (await prisma.upgradeRequest.count({ where: { tenantId, status: "pending" } })) > 0;
    } catch {
      pendingRequest = false; // table not pushed yet — the submit path reports it
    }
  }
  return {
    quote: upgradeQuote(config, trial.onTrial),
    methods: visiblePackagePaymentMethods(payment),
    pendingRequest,
    trialGoverned: trial.onTrial,
  };
}

const MAX_URL = 600;
const MAX_METHOD = 80;

export async function submitUpgradeRequestAction(input: {
  payMethod: string;
  proofUrl: string;
}): Promise<{ ok: true } | { error: string }> {
  const tenantId = await requireStoreOwner();
  if (!tenantId) return { error: "You don't have permission to do that." };
  if (isDemoMode()) return { error: "Upgrades aren't available in the demo store." };

  const payMethod = String(input?.payMethod ?? "").trim().slice(0, MAX_METHOD);
  const proofUrl = String(input?.proofUrl ?? "").trim().slice(0, MAX_URL);
  if (!payMethod) return { error: "Pick the payment method you used." };
  if (!/^https:\/\//.test(proofUrl)) return { error: "Upload your proof of payment first." };

  const [config, trial, tenant] = await Promise.all([
    getPlanConfig(),
    getTrialState(tenantId),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: { select: { key: true } } },
    }),
  ]);
  if (!tenant) return { error: "Store not found." };

  try {
    const open = await prisma.upgradeRequest.count({ where: { tenantId, status: "pending" } });
    if (open > 0) {
      return { error: "Your upgrade is already being reviewed — we'll activate it shortly." };
    }
    const quote = upgradeQuote(config, trial.onTrial);
    await prisma.upgradeRequest.create({
      data: {
        tenantId,
        fromPlan: tenant.plan.key,
        toPlan: "pro",
        amountCents: quote.dueTodayCents,
        creditCents: quote.creditCents,
        payMethod,
        proofUrl,
      },
    });
  } catch {
    return { error: "Couldn't file your upgrade right now — please try again or contact support." };
  }

  revalidateTenant(tenantId, await getTenantSlug());
  return { ok: true };
}
