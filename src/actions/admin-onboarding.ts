"use server";

// Super Admin actions for the self-serve onboarding workflow. All operator-gated.
// They advance a submission through the setup statuses, publish the provisioned
// store (status → active, so it leaves the pending_setup "dark" state), and set
// the client's store credentials (both the dashboard password hash and the
// storefront #admin password) since the public flow doesn't collect one.

import { Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformUser } from "@/lib/auth/session";
import { isDemoMode, updateDemoOnboarding } from "@/lib/demo/fixtures";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { hashAdminPassword } from "@/lib/auth/tenant-admin";
import { ONBOARDING_STATUSES, type OnboardingStatus } from "@/lib/admin/onboarding-data";

export type AdminOnboardingResult = { ok: true } | { error: string };

function bust() {
  revalidateTag("admin:data");
  revalidatePath("/admin/onboarding");
}

/** Advance a submission's setup status (Start Setup / Request Revision / Mark Complete). */
export async function updateOnboardingStatusAction(
  id: string,
  status: OnboardingStatus,
): Promise<AdminOnboardingResult> {
  await requirePlatformUser();
  if (!ONBOARDING_STATUSES.includes(status)) return { error: "Unknown status." };

  if (isDemoMode()) {
    updateDemoOnboarding(id, { setupStatus: status });
    bust();
    return { ok: true };
  }

  const sub = await prisma.onboardingSubmission.findUnique({ where: { id }, select: { id: true } });
  if (!sub) return { error: "Submission not found." };
  await prisma.onboardingSubmission.update({ where: { id }, data: { setupStatus: status } });
  bust();
  revalidatePath(`/admin/onboarding/${id}`);
  return { ok: true };
}

/** Publish the provisioned store: tenant.status → active, submission → completed. */
export async function publishTenantAction(id: string): Promise<AdminOnboardingResult> {
  await requirePlatformUser();
  if (isDemoMode()) {
    updateDemoOnboarding(id, { setupStatus: "completed" });
    bust();
    return { ok: true };
  }

  const sub = await prisma.onboardingSubmission.findUnique({
    where: { id },
    select: { tenantId: true, slug: true },
  });
  if (!sub?.tenantId) return { error: "No tenant linked to this submission." };

  await prisma.$transaction([
    prisma.tenant.update({ where: { id: sub.tenantId }, data: { status: "active" } }),
    prisma.onboardingSubmission.update({ where: { id }, data: { setupStatus: "completed" } }),
  ]);

  revalidateTenant(sub.tenantId, sub.slug); // store goes live: bust host + tenant caches
  bust();
  revalidatePath(`/admin/onboarding/${id}`);
  return { ok: true };
}

/** Unpublish (revert to pending_setup) — hides the store again if needed. */
export async function unpublishTenantAction(id: string): Promise<AdminOnboardingResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { ok: true };

  const sub = await prisma.onboardingSubmission.findUnique({
    where: { id },
    select: { tenantId: true, slug: true },
  });
  if (!sub?.tenantId) return { error: "No tenant linked to this submission." };

  await prisma.tenant.update({ where: { id: sub.tenantId }, data: { status: "pending_setup" } });
  revalidateTenant(sub.tenantId, sub.slug);
  bust();
  revalidatePath(`/admin/onboarding/${id}`);
  return { ok: true };
}

/** Set the client's store credentials: dashboard password (hashed) + storefront
 *  #admin password (plaintext in branding.config), so they can sign into both. */
export async function setStorePasswordAction(
  slug: string,
  password: string,
): Promise<AdminOnboardingResult> {
  await requirePlatformUser();
  if (isDemoMode()) {
    return { error: 'Demo mode uses a fixed password ("admin"). Connect a database to set one.' };
  }
  const pwd = (password ?? "").trim();
  if (pwd.length < 6) return { error: "Use at least 6 characters." };
  if (pwd.length > 200) return { error: "That password is too long." };

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, branding: { select: { config: true } } },
  });
  if (!tenant) return { error: "Store not found." };

  const config = { ...((tenant.branding?.config ?? {}) as Record<string, unknown>), adminPassword: pwd };

  await prisma.$transaction([
    prisma.tenant.update({
      where: { id: tenant.id },
      data: { adminPasswordHash: hashAdminPassword(pwd) },
    }),
    prisma.branding.upsert({
      where: { tenantId: tenant.id },
      update: { config: config as Prisma.InputJsonValue },
      create: { tenantId: tenant.id, config: config as Prisma.InputJsonValue },
    }),
  ]);

  revalidateTenant(tenant.id, slug);
  bust();
  return { ok: true };
}
