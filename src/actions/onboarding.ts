"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getPlatformUser } from "@/lib/auth/session";
import { isDemoMode, type DemoBranding } from "@/lib/demo/fixtures";
import {
  normalizeOrderNumberFormat,
  validatePrefix,
  type OrderNumberFormat,
} from "@/lib/orders/order-number-format";
import {
  createTenantDemoAction,
  saveBrandingDemoAction,
  saveFeaturesDemoAction,
  saveOrderFormatDemoAction,
  type CreateTenantState,
} from "@/actions/demo";
import type { DemoFeatureMap } from "@/lib/demo/fixtures";
import { revalidateTenant } from "@/lib/tenant/revalidate";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").replace(/:\d+$/, "");

const createTenantSchema = z.object({
  name: z.string().min(2),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers and hyphens only"),
  planKey: z.enum(["starter", "pro", "enterprise"]).default("starter"),
  themeId: z.string().min(1).default("clinical-white"),
  ownerUserId: z.string().min(1), // Supabase auth user id of the client owner
  ownerEmail: z.string().email(),
  orderNumberFormat: z.custom<OrderNumberFormat>().optional(),
});

/**
 * "Create Tenant" — step 1 of onboarding. Platform-operator only.
 * Provisions tenant + default branding/settings + owner membership in one txn.
 * The tenant is instantly live at slug.<ROOT> (no deploy).
 */
export async function createTenant(input: z.infer<typeof createTenantSchema>) {
  const operator = await getPlatformUser();
  if (!operator) throw new Error("FORBIDDEN");

  const data = createTenantSchema.parse(input);

  const plan = await prisma.plan.findUnique({ where: { key: data.planKey } });
  if (!plan) throw new Error(`Plan not seeded: ${data.planKey}`);

  const orderNumberFormat = normalizeOrderNumberFormat(data.orderNumberFormat ?? {}, data.name);

  const tenant = await prisma.$transaction(async (tx) => {
    const t = await tx.tenant.create({
      data: {
        name: data.name,
        slug: data.slug,
        status: "trial",
        planId: plan.id,
        orderNumberFormat,
        branding: { create: { themeId: data.themeId } },
        settings: { create: { storeName: data.name } },
        members: {
          create: { userId: data.ownerUserId, email: data.ownerEmail, role: "owner" },
        },
      },
    });
    return t;
  });

  // Invalidate the host→tenant cache for the new subdomain.
  revalidateTag(`tenant-host:${data.slug}.${ROOT}`);

  return { id: tenant.id, slug: tenant.slug };
}

const saveBrandingSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,}$/, "Invalid tenant slug."),
  themeId: z.string().min(1),
  colors: z.record(z.string()).optional(), // role → HSL triple
  fonts: z.object({ heading: z.string().optional(), body: z.string().optional() }).optional(),
  config: z.record(z.unknown()).optional(), // full storefront Brand config (Partial<Brand>)
});

/**
 * Persist a tenant's branding (theme, role colors, fonts) to the Branding row.
 * Platform-operator only (the editor lives in the platform admin app).
 */
export async function saveBranding(
  input: z.infer<typeof saveBrandingSchema>,
): Promise<{ ok: true } | { error: string }> {
  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const parsed = saveBrandingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const tenant = await prisma.tenant.findUnique({
    where: { slug: data.slug },
    select: { id: true },
  });
  if (!tenant) return { error: `Tenant not found: ${data.slug}` };

  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: {
      themeId: data.themeId,
      colors: data.colors ?? {},
      fonts: data.fonts ?? {},
      ...(data.config ? { config: data.config as Prisma.InputJsonValue } : {}),
    },
    create: {
      tenantId: tenant.id,
      themeId: data.themeId,
      colors: data.colors ?? {},
      fonts: data.fonts ?? {},
      config: (data.config ?? {}) as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/admin");
  revalidateTenant(tenant.id, data.slug); // storefront re-reads branding
  return { ok: true };
}

const saveOrderFormatSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,}$/, "Invalid tenant slug."),
  format: z.custom<OrderNumberFormat>(),
});

/**
 * Persist a tenant's order-number format to the Tenant.orderNumberFormat Json
 * column. Applies to new orders only — orderSeq and existing orders are
 * untouched. Platform-operator only.
 */
export async function saveOrderFormat(
  input: z.infer<typeof saveOrderFormatSchema>,
): Promise<{ ok: true } | { error: string }> {
  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const parsed = saveOrderFormatSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { slug, format } = parsed.data;

  const prefixError = validatePrefix(String(format.prefix).toUpperCase());
  if (prefixError) return { error: prefixError };

  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!tenant) return { error: `Tenant not found: ${slug}` };

  const orderNumberFormat = normalizeOrderNumberFormat(format, tenant.name);
  await prisma.tenant.update({ where: { id: tenant.id }, data: { orderNumberFormat } });

  revalidatePath("/admin");
  revalidatePath(`/admin/tenants/${slug}/settings`);
  return { ok: true };
}

const saveFeaturesSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,}$/, "Invalid tenant slug."),
  // key → desired on/off. The editor sends explicit booleans for plan-permitted
  // features only; locked (out-of-plan) features are never included.
  map: z.record(z.boolean()),
});

/**
 * Persist a tenant's feature toggles as TenantFeatureOverride rows (DB path).
 * Plan is the ceiling; overrides only diff from it:
 *   - in plan + on   → no override (delete any revoke)
 *   - in plan + off  → override enabled=false (revoke)
 *   - out of plan    → grant/clear (the admin editor doesn't surface these, but
 *                       we handle them so callers can grant beta access too)
 * Platform-operator only. Storefront entitlements re-resolve on next request.
 */
export async function saveFeatures(
  input: z.infer<typeof saveFeaturesSchema>,
): Promise<{ ok: true } | { error: string }> {
  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const parsed = saveFeaturesSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { slug, map } = parsed.data;

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, plan: { select: { features: { select: { feature: { select: { key: true } } } } } } },
  });
  if (!tenant) return { error: `Tenant not found: ${slug}` };

  const planKeys = new Set(tenant.plan.features.map((pf) => pf.feature.key));
  const keys = Object.keys(map);
  const features = await prisma.feature.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
  const idByKey = new Map(features.map((f) => [f.key, f.id]));

  await prisma.$transaction(async (tx) => {
    for (const [key, on] of Object.entries(map)) {
      const featureId = idByKey.get(key);
      if (!featureId) continue; // feature not seeded — nothing to override
      const where = { tenantId_featureId: { tenantId: tenant.id, featureId } };
      const inPlan = planKeys.has(key);
      if (on === inPlan) {
        // desired state already matches the plan default → no override needed
        await tx.tenantFeatureOverride.deleteMany({ where: { tenantId: tenant.id, featureId } });
      } else {
        // diverges from plan → record an explicit grant (on) / revoke (off)
        await tx.tenantFeatureOverride.upsert({
          where,
          update: { enabled: on, expiresAt: null },
          create: { tenantId: tenant.id, featureId, enabled: on },
        });
      }
    }
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/tenants/${slug}`);
  revalidatePath(`/admin/tenants/${slug}/features`);
  revalidateTenant(tenant.id, slug); // storefront re-reads entitlements (nav + route guards)
  return { ok: true };
}

// ──────────────────────────── Demo ⇄ DB switches ────────────────────────────
// The admin wizard and branding editor call these; they route to the demo
// (file-backed) or DB-backed implementation based on isDemoMode(). This keeps
// the app fully runnable without a database while the real flow persists to PG.

/** Wizard create-tenant action. Demo → fixtures; DB → Prisma (operator = initial owner). */
export async function createTenantAction(
  prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  if (isDemoMode()) return createTenantDemoAction(prev, formData);

  const operator = await getPlatformUser();
  if (!operator) return { error: "Platform operators only." };

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const planKey = String(formData.get("plan") ?? "starter");
  const themeId = String(formData.get("themeId") ?? "clinical-white");

  // Order-number format (same fields as the demo wizard).
  const prefix = String(formData.get("orderPrefix") ?? "").trim().toUpperCase();
  const prefixError = validatePrefix(prefix);
  if (prefixError) return { error: prefixError };
  const orderNumberFormat = normalizeOrderNumberFormat(
    {
      prefix,
      separator: String(formData.get("orderSeparator") ?? "-"),
      scheme: String(formData.get("orderScheme") ?? "sequential"),
      digits: Number(formData.get("orderDigits") ?? 4),
    },
    name,
  );

  const parsed = createTenantSchema.safeParse({
    name,
    slug,
    planKey,
    themeId,
    ownerUserId: operator.id,
    ownerEmail: operator.email,
    orderNumberFormat,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await createTenant(parsed.data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create tenant.";
    // Surface the common case (duplicate slug) in plain language.
    if (msg.includes("Unique constraint")) return { error: `Slug "${slug}" is already taken.` };
    return { error: msg };
  }

  revalidatePath("/admin");
  return { createdSlug: slug };
}

/**
 * Branding editor save action. Demo → fixtures (lossless); DB → Branding row.
 * Note: hero typography (branding.hero) has no Branding column yet, so the DB
 * path persists the theme/colors/fonts the row supports; logo/favicon assets go
 * through the dedicated upload actions in actions/branding.ts.
 */
export async function saveBrandingAction(
  slug: string,
  branding: DemoBranding,
): Promise<{ ok: true } | { error: string }> {
  if (isDemoMode()) return saveBrandingDemoAction(slug, branding);
  return saveBranding({
    slug,
    themeId: branding.themeId ?? "clinical-white",
    colors: branding.colors,
    fonts: branding.fonts,
    config: branding.config,
  });
}

/** Order-number editor save action. Demo → fixtures; DB → Tenant.orderNumberFormat. */
export async function saveOrderFormatAction(
  slug: string,
  format: OrderNumberFormat,
): Promise<{ ok: true } | { error: string }> {
  if (isDemoMode()) return saveOrderFormatDemoAction(slug, format);
  return saveOrderFormat({ slug, format });
}

/** Features editor save action. Demo → file-backed map; DB → TenantFeatureOverride rows. */
export async function saveFeaturesAction(
  slug: string,
  map: Record<string, boolean>,
): Promise<{ ok: true } | { error: string }> {
  if (isDemoMode()) return saveFeaturesDemoAction(slug, map as DemoFeatureMap);
  return saveFeatures({ slug, map });
}
