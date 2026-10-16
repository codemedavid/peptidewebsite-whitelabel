"use server";

// Storefront Assessment quiz — submissions + the owner's quiz settings.
//
// Gate: FEATURES.STORE_ASSESSMENT (operator-grantable, default OFF) on every
// action. The public submit additionally needs the owner's switch on, is
// rate-limited per client, and resolves the tenant from the request host —
// never from the payload. Admin actions need the "assessments" staff grant:
// a submission holds self-reported medical history.
//
// Single-row writes go through updateMany/deleteMany so forTenant() scopes them.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-client";
import { requireStaffPermission } from "@/lib/auth/staff-guard";
import { getTenantIdOrNull, getTenantSlug } from "@/lib/tenant/headers";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { isDemoMode } from "@/lib/demo/fixtures";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import {
  normalizeAssessmentConfig,
  validateAssessmentSubmission,
  type AssessmentConfig,
} from "@/lib/storefront/assessment";

type Fail = { error: string };

export type AssessmentStatus = "new" | "contacted" | "archived";

export type AssessmentResponseRow = {
  id: string;
  fullName: string;
  email: string;
  ageRange: string;
  location: string;
  conditions: string[];
  goals: string[];
  experience: string;
  frequency: string;
  status: AssessmentStatus;
  createdAt: string;
};

const NO_ACCESS = "You don't have access to Assessments.";
const UNAVAILABLE = "The assessment isn't available right now.";
const NOT_FOUND = "That submission no longer exists.";
const STATUSES: readonly AssessmentStatus[] = ["new", "contacted", "archived"];
const SUBMIT_LIMIT = 5;
const SUBMIT_WINDOW_MS = 60 * 60_000;
const ADMIN_LIST_LIMIT = 500;

async function readAssessmentConfig(tenantId: string): Promise<AssessmentConfig> {
  const branding = await prisma.branding.findUnique({ where: { tenantId }, select: { config: true } });
  const config = (branding?.config ?? {}) as Record<string, unknown>;
  return normalizeAssessmentConfig(config.assessment);
}

async function assessmentsAdmin(): Promise<string | null> {
  const ctx = await requireStaffPermission("assessments");
  if (!ctx) return null;
  return (await hasFeature(ctx.tenantId, FEATURES.STORE_ASSESSMENT)) ? ctx.tenantId : null;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function toRow(r: {
  id: string;
  fullName: string;
  email: string;
  ageRange: string;
  location: string;
  conditions: unknown;
  goals: unknown;
  experience: string;
  frequency: string;
  status: string;
  createdAt: Date;
}): AssessmentResponseRow {
  return {
    id: r.id,
    fullName: r.fullName,
    email: r.email,
    ageRange: r.ageRange,
    location: r.location,
    conditions: strings(r.conditions),
    goals: strings(r.goals),
    experience: r.experience,
    frequency: r.frequency,
    status: (STATUSES as readonly string[]).includes(r.status) ? (r.status as AssessmentStatus) : "new",
    createdAt: r.createdAt.toISOString(),
  };
}

/** Public: record one customer's answers. The recommendation itself is built
 *  client-side from the catalog, so a failed save never blocks the result. */
export async function submitAssessmentAction(input: unknown): Promise<{ ok: true } | Fail> {
  if (isDemoMode()) return { ok: true };
  const tenantId = await getTenantIdOrNull();
  if (!tenantId || !(await hasFeature(tenantId, FEATURES.STORE_ASSESSMENT))) return { error: UNAVAILABLE };

  const config = await readAssessmentConfig(tenantId);
  if (!config.enabled) return { error: UNAVAILABLE };

  const limit = rateLimit(`assessment:${tenantId}:${await clientIp()}`, SUBMIT_LIMIT, SUBMIT_WINDOW_MS);
  if (!limit.ok) return { error: "You've sent a few assessments already — please try again later." };

  const parsed = validateAssessmentSubmission(input, config);
  if (!parsed.ok) return parsed;
  const a = parsed.value;

  try {
    await withTenant(tenantId, (db) =>
      db.assessmentResponse.create({
        data: {
          tenantId,
          fullName: a.fullName,
          email: a.email,
          ageRange: a.ageRange,
          location: a.location,
          conditions: a.conditions,
          goals: a.goals,
          experience: a.experience,
          frequency: a.frequency,
        },
      }),
    );
    return { ok: true };
  } catch (err) {
    console.error("[assessment] submit failed", err);
    return { error: "We couldn't save your answers, but your recommendation is below." };
  }
}

export async function listAssessmentResponsesAction(): Promise<
  { ok: true; responses: AssessmentResponseRow[] } | Fail
> {
  const tenantId = await assessmentsAdmin();
  if (!tenantId) return { error: NO_ACCESS };
  if (isDemoMode()) return { ok: true, responses: [] };
  const rows = await withTenant(tenantId, (db) =>
    db.assessmentResponse.findMany({ orderBy: { createdAt: "desc" }, take: ADMIN_LIST_LIMIT }),
  );
  return { ok: true, responses: rows.map(toRow) };
}

export async function updateAssessmentStatusAction(id: string, status: string): Promise<{ ok: true } | Fail> {
  const tenantId = await assessmentsAdmin();
  if (!tenantId) return { error: NO_ACCESS };
  if (!(STATUSES as readonly string[]).includes(status)) return { error: "Unknown status." };
  if (isDemoMode()) return { ok: true };
  const result = await withTenant(tenantId, (db) =>
    db.assessmentResponse.updateMany({ where: { id }, data: { status } }),
  );
  return result.count ? { ok: true } : { error: NOT_FOUND };
}

export async function deleteAssessmentResponseAction(id: string): Promise<{ ok: true } | Fail> {
  const tenantId = await assessmentsAdmin();
  if (!tenantId) return { error: NO_ACCESS };
  if (isDemoMode()) return { ok: true };
  const result = await withTenant(tenantId, (db) => db.assessmentResponse.deleteMany({ where: { id } }));
  return result.count ? { ok: true } : { error: NOT_FOUND };
}

/** The owner's quiz settings (copy, on/off, goal → product keywords). */
export async function saveAssessmentConfigAction(
  input: unknown,
): Promise<{ ok: true; config: AssessmentConfig } | Fail> {
  const tenantId = await assessmentsAdmin();
  if (!tenantId) return { error: NO_ACCESS };
  if (isDemoMode()) return { error: "Quiz settings need the live database." };

  const normalized = normalizeAssessmentConfig(input);
  const branding = await prisma.branding.findUnique({ where: { tenantId }, select: { config: true } });
  const config = { ...((branding?.config ?? {}) as Record<string, unknown>), assessment: normalized };
  await prisma.branding.upsert({
    where: { tenantId },
    update: { config: config as Prisma.InputJsonValue },
    create: { tenantId, config: config as Prisma.InputJsonValue },
  });
  revalidateTenant(tenantId, await getTenantSlug());
  return { ok: true, config: normalized };
}
