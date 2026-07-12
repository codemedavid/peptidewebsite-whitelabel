"use server";

// PUBLIC, UNAUTHENTICATED self-serve onboarding (jonina.store/get-started).
//
// Unlike actions/onboarding.ts#createTenant (operator-gated, needs a Supabase
// owner), this is the front-door sign-up. It stores the full submission and
// AUTO-PROVISIONS a tenant in status "pending_setup" (kept dark by the status
// gate in lib/tenant/headers.ts until the operator publishes it). Images arrive
// as URLs (already uploaded via /api/onboarding/upload), so the payload stays
// well under the server-action body-size limit.

import { headers } from "next/headers";
import { revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { planMeta } from "@/lib/admin/plans";
import { slugify, uniqueize } from "@/lib/storefront/product-mapping";
import { normalizeOrderNumberFormat } from "@/lib/orders/order-number-format";
import { onboardingSchema, STARTER_FEATURE_LIMIT, type OnboardingPayload } from "@/lib/onboarding/schema";
import { buildProvisioning } from "@/lib/onboarding/mapping";
import {
  isDemoMode,
  createDemoTenant,
  addDemoOnboarding,
  type DemoOnboardingSubmission,
} from "@/lib/demo/fixtures";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").replace(/:\d+$/, "");

// Labels a sign-up can never claim: the platform hosts + Next/runtime reserved
// segments. Mirrors RESERVED_SUBDOMAINS in lib/tenant/resolve.ts.
const RESERVED_SLUGS = new Set([
  "www", "admin", "app", "api", "marketing", "tenant", "static", "_next", "assets", "public",
]);

export type SubmitOnboardingResult =
  | { ok: true; slug: string; url: string }
  | { error: string };

/** Derive a 2+ char base slug; "store" when the name slugifies to nothing usable. */
function baseSlug(name: string): string {
  const s = slugify(name);
  return s && s !== "product" && s.length >= 2 ? s : "store";
}

/** Build per-product create rows with unique slug + sku within the new tenant. */
function productCreates(payload: OnboardingPayload) {
  const writes = buildProvisioning(payload).productWrites;
  const takenSlugs = new Set<string>();
  const takenSkus = new Set<string>();
  return writes.map((w, i) => {
    const slug = uniqueize(slugify(w.name), takenSlugs);
    takenSlugs.add(slug);
    const skuBase = (slug.toUpperCase().replace(/[^A-Z0-9]/g, "") || `SKU${i + 1}`).slice(0, 32);
    const sku = uniqueize(skuBase, takenSkus);
    takenSkus.add(sku);
    return {
      sku,
      slug,
      name: w.name,
      description: w.description,
      priceCents: w.priceCents,
      currency: w.currency,
      stock: w.stock,
      status: w.status,
      active: w.active,
      images: w.images as unknown as Prisma.InputJsonValue,
      metadata: w.metadata as unknown as Prisma.InputJsonValue,
    };
  });
}

export async function submitOnboardingAction(
  input: OnboardingPayload,
): Promise<SubmitOnboardingResult> {
  // 1. Host guard — only accept from the apex marketing host.
  const host = ((await headers()).get("x-tenant-host") ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!isDemoMode() && host && host !== ROOT) {
    return { error: "Onboarding is only available from the main site." };
  }

  // 2. Validate.
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Some details are missing or invalid." };
  }
  const payload = parsed.data;

  // 3. Gate on terms + proof + honeypot (the flow is "payment received").
  if (payload.website) return { error: "Submission rejected." }; // honeypot tripped
  if (!payload.termsAccepted) return { error: "Please accept the terms to continue." };
  if (!payload.paymentProofUrl) return { error: "Please upload your proof of payment." };

  const planKey = planMeta(payload.packageKey).key; // normalize aliases → starter|pro|enterprise

  // The ₱699 1-month trial only exists for the Business (pro) package.
  const trial = planKey === "pro" && payload.trial;

  // Starter must commit to at least N included add-on features (extras beyond N
  // are billed per STARTER_EXTRA_FEATURE_PRICE_CENTS; the schema caps the max at
  // the full feature set). Other tiers ignore the field.
  const selectedFeatures = planKey === "starter" ? payload.selectedFeatures : [];
  if (planKey === "starter" && selectedFeatures.length < STARTER_FEATURE_LIMIT) {
    return { error: `Please pick at least ${STARTER_FEATURE_LIMIT} features for the Starter package.` };
  }

  const { brandConfig, settings } = buildProvisioning(payload);
  const orderNumberFormat = normalizeOrderNumberFormat({}, payload.businessName);

  // ── Demo mode (no DB): file-backed tenant + submission. ──
  if (isDemoMode()) {
    const demoBase = baseSlug(payload.businessName);
    let slug = RESERVED_SLUGS.has(demoBase) ? `${demoBase}-store` : demoBase;
    let created = createDemoTenant({ name: payload.businessName, slug, plan: planKey, themeId: payload.themeId });
    for (let n = 2; "error" in created && n < 50; n++) {
      slug = `${demoBase}-${n}`;
      created = createDemoTenant({ name: payload.businessName, slug, plan: planKey, themeId: payload.themeId });
    }
    if ("error" in created) return { error: created.error };
    const sub: DemoOnboardingSubmission = {
      id: crypto.randomUUID(),
      slug,
      tenantId: slug, // demo id == slug
      setupStatus: "tenant_created",
      createdAt: new Date().toISOString(),
      data: payload as unknown as Record<string, unknown>,
    };
    addDemoOnboarding(sub);
    return { ok: true, slug, url: `${slug}.${ROOT}` };
  }

  // ── DB path. ──
  const plan = await prisma.plan.findUnique({ where: { key: planKey }, select: { id: true } });
  if (!plan) return { error: `Plan not available: ${planKey}. Please contact support.` };

  // Seed the candidate slug from existing tenants (one read), then retry on the
  // unique-constraint race below.
  const existing = await prisma.tenant.findMany({ select: { slug: true } });
  const taken = new Set<string>([...existing.map((t) => t.slug), ...RESERVED_SLUGS]);
  let slug = uniqueize(baseSlug(payload.businessName), taken);

  const products = productCreates(payload);

  // Retry loop: a concurrent sign-up with the same name can win the slug between
  // our read and write → Prisma P2002. Re-derive and retry a handful of times.
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: payload.businessName,
            slug,
            status: "pending_setup",
            planId: plan.id,
            orderNumberFormat,
            branding: {
              create: {
                themeId: payload.themeId,
                ...(payload.logoUrl ? { logoUrl: payload.logoUrl } : {}),
                config: brandConfig as unknown as Prisma.InputJsonValue,
              },
            },
            settings: {
              create: {
                storeName: settings.storeName,
                supportEmail: settings.supportEmail,
                currency: settings.currency,
              },
            },
            ...(products.length ? { products: { create: products } } : {}),
          },
          select: { id: true, slug: true },
        });

        await tx.onboardingSubmission.create({
          data: {
            businessName: payload.businessName,
            businessType: payload.businessType,
            description: payload.description || null,
            contactPerson: payload.contactPerson || null,
            email: payload.email,
            whatsapp: payload.whatsapp || null,
            facebook: payload.facebook || null,
            themeStyle: payload.themeStyle ?? null,
            themeId: payload.themeId,
            primaryColor: payload.primaryColor || null,
            secondaryColor: payload.secondaryColor || null,
            logoUrl: payload.logoUrl || null,
            bannerUrls: payload.bannerUrls as unknown as Prisma.InputJsonValue,
            inspirationUrls: payload.inspirationUrls as unknown as Prisma.InputJsonValue,
            inspirationNotes: payload.inspirationNotes || null,
            products: payload.products as unknown as Prisma.InputJsonValue,
            orderDestination: payload.orderDestination,
            orderDestinationValue: payload.orderDestinationValue || null,
            paymentMethods: payload.paymentMethods as unknown as Prisma.InputJsonValue,
            packageKey: planKey,
            trial,
            selectedFeatures: selectedFeatures as unknown as Prisma.InputJsonValue,
            paymentProofUrl: payload.paymentProofUrl || null,
            termsAccepted: payload.termsAccepted,
            slug: tenant.slug,
            tenantId: tenant.id,
            setupStatus: "tenant_created",
          },
        });

        return tenant;
      });

      revalidateTag(`tenant-host:${result.slug}.${ROOT}`);
      revalidateTag("admin:data");
      return { ok: true, slug: result.slug, url: `${result.slug}.${ROOT}` };
    } catch (e) {
      // Slug race → pick the next free candidate and retry; anything else bubbles.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        taken.add(slug);
        slug = uniqueize(baseSlug(payload.businessName), taken);
        continue;
      }
      const msg = e instanceof Error ? e.message : "Could not create your store.";
      return { error: msg };
    }
  }
  return { error: "That business name is taken — please tweak it and try again." };
}
