"use server";

// Platform-operator side of the trial→Business upgrade (Super Admin →
// Upgrades). Approving a pending request is what actually flips the tenant to
// the Business plan and reactivates the storefront (status "active") — the
// store-owner submission (actions/upgrade.ts) never mutates the plan itself.
// Transitions follow lib/trial/upgrade-request.ts: only pending requests can
// be decided, and decisions are final.

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo/fixtures";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import {
  canTransitionUpgrade,
  normalizeUpgradeStatus,
  type UpgradeRequestStatus,
} from "@/lib/trial/upgrade-request";

export type UpgradeRequestRow = {
  id: string;
  tenantName: string;
  tenantSlug: string;
  fromPlan: string;
  toPlan: string;
  status: UpgradeRequestStatus;
  amountCents: number;
  creditCents: number;
  payMethod: string | null;
  proofUrl: string | null;
  createdAt: string;
};

export async function listUpgradeRequestsAction(): Promise<
  { rows: UpgradeRequestRow[] } | { error: string }
> {
  await requirePlatformUser();
  if (isDemoMode()) return { rows: [] };
  try {
    const rows = await prisma.upgradeRequest.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
      include: { tenant: { select: { name: true, slug: true } } },
    });
    return {
      rows: rows.map((r) => ({
        id: r.id,
        tenantName: r.tenant.name,
        tenantSlug: r.tenant.slug,
        fromPlan: r.fromPlan,
        toPlan: r.toPlan,
        status: normalizeUpgradeStatus(r.status),
        amountCents: r.amountCents,
        creditCents: r.creditCents,
        payMethod: r.payMethod,
        proofUrl: r.proofUrl,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch {
    return { error: "Upgrade requests aren't available yet — run db:push to add the table." };
  }
}

export async function decideUpgradeRequestAction(
  id: string,
  decision: "approved" | "rejected",
): Promise<{ ok: true } | { error: string }> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: "Not available in demo mode." };

  const request = await prisma.upgradeRequest.findUnique({
    where: { id },
    include: { tenant: { select: { id: true, slug: true } } },
  });
  if (!request) return { error: "Request not found." };
  // Friendly-error pre-check. The race-proof guard is the conditional updateMany
  // inside the transaction below — this read is only here to fail fast/readably.
  if (!canTransitionUpgrade(normalizeUpgradeStatus(request.status), decision)) {
    return { error: "This request has already been decided." };
  }

  // Resolve the target plan before opening the transaction (read-only), so a bad
  // plan key fails cleanly.
  let planId: string | null = null;
  if (decision === "approved") {
    const plan = await prisma.plan.findUnique({
      where: { key: request.toPlan },
      select: { id: true },
    });
    if (!plan) return { error: `The "${request.toPlan}" plan isn't set up in the database yet.` };
    planId = plan.id;
  }

  // Decide atomically. The status flip is a CONDITIONAL update guarded on the row
  // still being pending, so two concurrent decisions can't both apply — the
  // second sees count 0 and is rejected. On approval the plan flip + storefront
  // reactivation (status "active") land in the same transaction.
  try {
    const applied = await prisma.$transaction(async (tx) => {
      const flip = await tx.upgradeRequest.updateMany({
        where: { id, status: "pending" },
        data: { status: decision },
      });
      if (flip.count === 0) return false; // decided by a concurrent call
      if (decision === "approved" && planId) {
        await tx.tenant.update({
          where: { id: request.tenant.id },
          data: { planId, status: "active" },
        });
      }
      return true;
    });
    if (!applied) return { error: "This request has already been decided." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't apply the decision right now." };
  }

  // Bust the storefront caches (entitlements + trial state re-gate) and the
  // admin surfaces that show plan/MRR data.
  revalidateTenant(request.tenant.id, request.tenant.slug);
  revalidateTag("admin:data");
  revalidatePath("/admin");
  revalidatePath("/admin/upgrades");
  revalidatePath("/admin/tenants");
  return { ok: true };
}
