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
import { revalidateTenant, revalidateTenantVisibility } from "@/lib/tenant/revalidate";
import { hashAdminPassword } from "@/lib/auth/tenant-admin";
import { hashPassword } from "@/lib/auth/password-hash";
import { normalizeLoginEmail } from "@/lib/auth/login-email";
import { isValidEmail } from "@/lib/analytics/events";
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
    select: { tenantId: true },
  });
  if (!sub?.tenantId) return { error: "No tenant linked to this submission." };

  await prisma.$transaction([
    prisma.tenant.update({ where: { id: sub.tenantId }, data: { status: "active" } }),
    prisma.onboardingSubmission.update({ where: { id }, data: { setupStatus: "completed" } }),
  ]);

  // Store goes live: bust host + tenant caches on every host, custom domains included.
  await revalidateTenantVisibility(sub.tenantId);
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
    select: { tenantId: true },
  });
  if (!sub?.tenantId) return { error: "No tenant linked to this submission." };

  await prisma.tenant.update({ where: { id: sub.tenantId }, data: { status: "pending_setup" } });
  await revalidateTenantVisibility(sub.tenantId);
  bust();
  revalidatePath(`/admin/onboarding/${id}`);
  return { ok: true };
}

/** Parse a "YYYY-MM-DD" date-input value into a UTC Date (null when invalid). */
function parseDay(s: string | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Manage the ₱699 1-month Business trial: mark the submission active (full
 *  package) or trial with an explicit start/end window. Pro-only. */
export async function setTrialAction(
  id: string,
  input: { trial: boolean; startsAt?: string; endsAt?: string },
): Promise<AdminOnboardingResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: "Connect a database to manage trials." };

  const sub = await prisma.onboardingSubmission.findUnique({
    where: { id },
    select: { id: true, packageKey: true },
  });
  if (!sub) return { error: "Submission not found." };

  if (!input.trial) {
    await prisma.onboardingSubmission.update({
      where: { id },
      data: { trial: false, trialStartsAt: null, trialEndsAt: null },
    });
  } else {
    if (sub.packageKey !== "pro") {
      return { error: "Trials are only available on the Business package." };
    }
    const startsAt = parseDay(input.startsAt);
    const endsAt = parseDay(input.endsAt);
    if (!startsAt || !endsAt) return { error: "Set both the trial start and end dates." };
    if (endsAt <= startsAt) return { error: "The trial end date must be after the start date." };
    await prisma.onboardingSubmission.update({
      where: { id },
      data: { trial: true, trialStartsAt: startsAt, trialEndsAt: endsAt },
    });
  }

  bust();
  revalidatePath(`/admin/onboarding/${id}`);
  return { ok: true };
}

/** Set the client's store credentials — both stored as hashes, never plaintext:
 *
 *   • Tenant.adminPasswordHash        → the platform /dashboard login
 *   • Tenant.storeAdminPasswordHash   → the storefront `<slug>/#admin` login
 *
 *  The `#admin` login also needs an EMAIL. If the tenant has none yet we seed it
 *  from the onboarding submission the client filled in, so setting a password
 *  here produces a credential that actually works instead of a half-configured
 *  store nobody can sign into. The operator can correct it later in tenant
 *  settings, which is where the email is owned. */
export async function setStorePasswordAction(
  slug: string,
  password: string,
): Promise<AdminOnboardingResult> {
  await requirePlatformUser();
  if (isDemoMode()) {
    return { error: "Demo mode has no database. Connect one to set store credentials." };
  }
  const pwd = (password ?? "").trim();
  if (pwd.length < 6) return { error: "Use at least 6 characters." };
  if (pwd.length > 200) return { error: "That password is too long." };

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, storeAdminEmail: true },
  });
  if (!tenant) return { error: "Store not found." };

  const data: {
    adminPasswordHash: string;
    storeAdminPasswordHash: string;
    storeAdminEmail?: string;
  } = {
    adminPasswordHash: hashAdminPassword(pwd),
    storeAdminPasswordHash: hashPassword(pwd),
  };

  if (!tenant.storeAdminEmail) {
    const submission = await prisma.onboardingSubmission.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      select: { email: true },
    });
    const email = normalizeLoginEmail(submission?.email);
    if (isValidEmail(email)) data.storeAdminEmail = email;
  }

  await prisma.tenant.update({ where: { id: tenant.id }, data });

  revalidateTenant(tenant.id, slug);
  bust();
  return { ok: true };
}
