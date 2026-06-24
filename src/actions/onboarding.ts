"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getPlatformUser } from "@/lib/auth/session";
import {
  isDemoMode,
  getDemoFeatures,
  saveDemoFeatures,
  type DemoBranding,
} from "@/lib/demo/fixtures";
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
import { PLAN_FEATURES, planFeatureSet, type FeatureKey } from "@/lib/features/catalog";

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

  // Invalidate the host→tenant cache for the new subdomain + admin data caches.
  revalidateTag(`tenant-host:${data.slug}.${ROOT}`);
  revalidateTag("admin:data");

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

  // Partition once, then run a single batched transaction: one deleteMany for
  // everything matching its plan default plus one upsert per divergence. The
  // previous per-key interactive transaction issued ~30 sequential round trips
  // and tripped Prisma's 5s transaction timeout on remote databases.
  const matchesPlan: string[] = [];
  const diverges: { featureId: string; enabled: boolean }[] = [];
  for (const [key, on] of Object.entries(map)) {
    const featureId = idByKey.get(key);
    if (!featureId) continue; // feature not seeded — nothing to override
    if (on === planKeys.has(key)) matchesPlan.push(featureId);
    else diverges.push({ featureId, enabled: on });
  }
  await prisma.$transaction([
    prisma.tenantFeatureOverride.deleteMany({
      where: { tenantId: tenant.id, featureId: { in: matchesPlan } },
    }),
    ...diverges.map(({ featureId, enabled }) =>
      prisma.tenantFeatureOverride.upsert({
        where: { tenantId_featureId: { tenantId: tenant.id, featureId } },
        update: { enabled, expiresAt: null },
        create: { tenantId: tenant.id, featureId, enabled },
      }),
    ),
  ]);

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

/**
 * Ensure a catalog feature has its DB rows (the Feature row + a PlanFeature link
 * for every plan whose ceiling includes it), idempotently. Mirrors prisma/seed.ts
 * so a feature added after a DB was seeded self-registers the first time it's
 * touched — `setTenantFeatureAction` relies on this so its toggle never fails
 * with "feature not registered". Returns null for a key not in the catalog.
 */
async function ensureFeatureRegistered(key: string): Promise<{ id: string }> {
  const feature = await prisma.feature.upsert({
    where: { key },
    update: {},
    create: { key },
    select: { id: true },
  });

  const planKeys = Object.entries(PLAN_FEATURES)
    .filter(([, keys]) => (keys as readonly string[]).includes(key))
    .map(([planKey]) => planKey);
  if (planKeys.length) {
    const plans = await prisma.plan.findMany({
      where: { key: { in: planKeys } },
      select: { id: true },
    });
    if (plans.length) {
      await prisma.$transaction(
        plans.map((p) =>
          prisma.planFeature.upsert({
            where: { planId_featureId: { planId: p.id, featureId: feature.id } },
            update: {},
            create: { planId: p.id, featureId: feature.id },
          }),
        ),
      );
    }
  }
  return feature;
}

/**
 * Toggle a SINGLE feature for one tenant WITHOUT disturbing its other overrides
 * — for focused, in-context switches (e.g. the "Admin fee" section in tenant
 * settings) so the operator needn't open the full Features editor. Merge-safe in
 * demo mode (the bulk editor REPLACES the whole override map). DB path mirrors
 * `saveFeatures`: matches plan default → drop the override; diverges → upsert it.
 * Platform operator only.
 */
export async function setTenantFeatureAction(
  slug: string,
  key: string,
  enabled: boolean,
): Promise<{ ok: true } | { error: string }> {
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Invalid tenant slug." };
  if (!/^[a-z0-9_.]+$/.test(key)) return { error: "Invalid feature key." };

  if (isDemoMode()) {
    saveDemoFeatures(slug, { ...getDemoFeatures(slug), [key]: enabled });
    revalidatePath("/admin");
    revalidatePath(`/admin/tenants/${slug}/settings`);
    revalidateTenant(slug, slug);
    return { ok: true };
  }

  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, plan: { select: { key: true } } },
  });
  if (!tenant) return { error: `Tenant not found: ${slug}` };

  // Self-heal: a feature added to the catalog after this DB was seeded has no
  // Feature/PlanFeature rows, so the toggle would fail and trap the operator.
  // Register it on demand exactly as prisma/seed.ts would — Feature row plus the
  // plan links for every plan whose ceiling includes it — so it behaves as the
  // catalog declares (e.g. admin_fee is default-on) instead of erroring.
  const feature = await ensureFeatureRegistered(key);

  // Plan default comes from the catalog (the source of truth we just synced the
  // DB to), so it's correct even on the first toggle that created the rows.
  const planHas = planFeatureSet(tenant.plan.key).has(key as FeatureKey);
  if (enabled === planHas) {
    // Back to the plan default → no override row needed.
    await prisma.tenantFeatureOverride.deleteMany({
      where: { tenantId: tenant.id, featureId: feature.id },
    });
  } else {
    await prisma.tenantFeatureOverride.upsert({
      where: { tenantId_featureId: { tenantId: tenant.id, featureId: feature.id } },
      update: { enabled, expiresAt: null },
      create: { tenantId: tenant.id, featureId: feature.id, enabled },
    });
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/tenants/${slug}`);
  revalidatePath(`/admin/tenants/${slug}/features`);
  revalidatePath(`/admin/tenants/${slug}/settings`);
  revalidateTenant(tenant.id, slug);
  return { ok: true };
}
