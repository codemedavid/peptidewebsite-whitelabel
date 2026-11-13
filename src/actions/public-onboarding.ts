"use server";

// PUBLIC, UNAUTHENTICATED self-serve onboarding (the apex /get-started wizard).
//
// Pay-first flow (2026-11):
//   1. saveOnboardingLeadAction   — step 1 (business + WhatsApp) saved as an
//      unpaid "lead" row, no tenant. Returns an opaque token the wizard keeps.
//   2. submitOnboardingAction     — package + payment proof. CONVERTS that lead
//      (or creates a fresh row) and AUTO-PROVISIONS a tenant in status
//      "pending_setup" (kept dark by the status gate in lib/tenant/headers.ts
//      until the operator publishes it). Returns a fresh token for step 3.
//   3. updateOnboardingDetailsAction — the OPTIONAL post-payment details
//      (branding, products, order destination, payment methods), only while the
//      store is still pending_setup.
//   + previewStoreSlugAction — the store address the server would assign.
//
// Only the sha256 of a token is stored (accessTokenHash). Images arrive as URLs
// (already uploaded via /api/onboarding/upload), so payloads stay small.

import { headers } from "next/headers";
import { revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { planMeta } from "@/lib/admin/plans";
import { slugify, uniqueize } from "@/lib/storefront/product-mapping";
import { normalizeOrderNumberFormat } from "@/lib/orders/order-number-format";
import {
  onboardingSchema,
  onboardingLeadSchema,
  onboardingDetailsSchema,
  normalizeOnboardingCycle,
  STARTER_FEATURE_LIMIT,
  type OnboardingInput,
  type OnboardingLeadInput,
  type OnboardingDetailsInput,
  type OnboardingPayload,
} from "@/lib/onboarding/schema";
import { quoteFromConfig } from "@/lib/onboarding/pricing";
import { getPlanConfig } from "@/lib/platform/plan-config-server";
import { getPackagePayment } from "@/lib/platform/package-payment-server";
import { findVisiblePackagePaymentMethod } from "@/lib/platform/package-payment";
import { buildProvisioning } from "@/lib/onboarding/mapping";
import { baseStoreSlug, pickStoreSlug, storeRootDomain } from "@/lib/onboarding/store-slug";
import { hashAccessToken, isPlausibleAccessToken, newAccessToken } from "@/lib/onboarding/access-token";
import {
  LEAD_DEDUPE_WINDOW_MS,
  LEAD_STATUS,
  decideLeadWrite,
  detailsUpdateDecision,
  isOpenLead,
  submissionReference,
  type LeadCandidate,
} from "@/lib/onboarding/pay-first";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import {
  isDemoMode,
  createDemoTenant,
  addDemoOnboarding,
  listDemoOnboarding,
  listDemoTenants,
  type DemoOnboardingSubmission,
} from "@/lib/demo/fixtures";

const ROOT = storeRootDomain();
const MINUTE = 60_000;

/** Thrown inside the details transaction when the store went live meanwhile. */
class DetailsRefused extends Error {}

export type SubmitOnboardingResult =
  | { ok: true; slug: string; url: string; token: string; reference: string }
  | { error: string };
export type SaveLeadResult = { ok: true; token: string; slug: string; reference: string } | { error: string };
export type SlugPreviewResult = { ok: true; slug: string; url: string } | { error: string };
export type UpdateDetailsResult = { ok: true; reference: string } | { error: string };

// ──────────────────────────── shared guards ────────────────────────────

/** Only the apex marketing host may call these. Returns an error message or null. */
async function apexGuard(): Promise<string | null> {
  const host = ((await headers()).get("x-tenant-host") ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!isDemoMode() && host && host !== ROOT) return "Onboarding is only available from the main site.";
  return null;
}

/** Per-IP throttle for the public actions. Returns an error message or null. */
async function throttle(action: string, limit: number, windowMs: number): Promise<string | null> {
  const verdict = rateLimit(`onboarding:${action}:${await clientIp()}`, limit, windowMs);
  return verdict.ok ? null : "Too many attempts — please wait a moment and try again.";
}

/** Slugs already in use that could collide with this name's base slug. */
async function takenSlugsFor(name: string): Promise<string[]> {
  if (isDemoMode()) return listDemoTenants().map((t) => t.slug);
  const rows = await prisma.tenant.findMany({
    where: { slug: { startsWith: baseStoreSlug(name) } },
    select: { slug: true },
  });
  return rows.map((r) => r.slug);
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

function demoCandidate(s: DemoOnboardingSubmission): LeadCandidate {
  return {
    id: s.id,
    whatsapp: typeof s.data.whatsapp === "string" ? s.data.whatsapp : null,
    tenantId: s.tenantId,
    setupStatus: s.setupStatus,
    createdAt: new Date(s.createdAt),
  };
}

function findDemoByToken(token: string | undefined): DemoOnboardingSubmission | null {
  if (!isPlausibleAccessToken(token)) return null;
  const hash = hashAccessToken(token);
  return listDemoOnboarding().find((s) => s.accessTokenHash === hash) ?? null;
}

// ──────────────────────────── store address preview ────────────────────────────

/** The store address the server would actually assign for this business name
 *  right now (taken + reserved slugs accounted for). Debounced by the wizard. */
export async function previewStoreSlugAction(name: string): Promise<SlugPreviewResult> {
  const guard = (await apexGuard()) ?? (await throttle("preview", 60, MINUTE));
  if (guard) return { error: guard };
  const clean = typeof name === "string" ? name.trim().slice(0, 120) : "";
  if (clean.length < 2) return { error: "Enter your business name." };
  try {
    const slug = pickStoreSlug(clean, await takenSlugsFor(clean));
    return { ok: true, slug, url: `${slug}.${ROOT}` };
  } catch {
    return { error: "Could not check that address right now." };
  }
}

// ──────────────────────────── 1. lead ────────────────────────────

/** Save step 1 as an unpaid lead (no tenant). Never blocks the wizard: the
 *  caller logs a failure and carries on. */
export async function saveOnboardingLeadAction(
  input: OnboardingLeadInput & { leadToken?: string; website?: string },
): Promise<SaveLeadResult> {
  const guard = (await apexGuard()) ?? (await throttle("lead", 20, 10 * MINUTE));
  if (guard) return { error: guard };
  if (input?.website) return { error: "Submission rejected." }; // honeypot

  const parsed = onboardingLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Some details are missing or invalid." };
  }
  const lead = parsed.data;
  const token = newAccessToken();
  const accessTokenHash = hashAccessToken(token);
  const now = new Date();

  try {
    const slug = pickStoreSlug(lead.businessName, await takenSlugsFor(lead.businessName));

    if (isDemoMode()) {
      const all = listDemoOnboarding();
      const mine = findDemoByToken(input.leadToken);
      const decision = decideLeadWrite({
        whatsapp: lead.whatsapp,
        now,
        tokenMatch: mine ? demoCandidate(mine) : null,
        recent: all.filter((s) => s.setupStatus === LEAD_STATUS).map(demoCandidate),
      });
      const existing = decision.action === "update" ? all.find((s) => s.id === decision.id) : undefined;
      const sub: DemoOnboardingSubmission = {
        id: existing?.id ?? crypto.randomUUID(),
        slug,
        tenantId: null,
        setupStatus: LEAD_STATUS,
        createdAt: existing?.createdAt ?? now.toISOString(),
        accessTokenHash,
        data: { ...(existing?.data ?? {}), ...lead, email: "" },
      };
      addDemoOnboarding(sub);
      return { ok: true, token, slug, reference: submissionReference(sub.id) };
    }

    const candidateSelect = { id: true, whatsapp: true, tenantId: true, setupStatus: true, createdAt: true } as const;
    const [mine, recent] = await Promise.all([
      isPlausibleAccessToken(input.leadToken)
        ? prisma.onboardingSubmission.findUnique({
            where: { accessTokenHash: hashAccessToken(input.leadToken) },
            select: candidateSelect,
          })
        : null,
      prisma.onboardingSubmission.findMany({
        where: {
          setupStatus: LEAD_STATUS,
          tenantId: null,
          createdAt: { gte: new Date(now.getTime() - LEAD_DEDUPE_WINDOW_MS) },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: candidateSelect,
      }),
    ]);

    const decision = decideLeadWrite({ whatsapp: lead.whatsapp, now, tokenMatch: mine, recent });
    const fields = {
      businessName: lead.businessName,
      whatsapp: lead.whatsapp || null,
      contactPerson: lead.contactPerson || null,
      description: lead.description || null,
      slug,
      accessTokenHash,
    };

    let id: string | null = null;
    if (decision.action === "update") {
      // Guarded write: a lead converted (paid) in the meantime is left alone.
      const res = await prisma.onboardingSubmission.updateMany({
        where: { id: decision.id, setupStatus: LEAD_STATUS, tenantId: null },
        data: fields,
      });
      if (res.count > 0) id = decision.id;
    }
    if (!id) {
      const created = await prisma.onboardingSubmission.create({
        data: { ...fields, email: "", setupStatus: LEAD_STATUS, termsAccepted: false },
        select: { id: true },
      });
      id = created.id;
    }

    revalidateTag("admin:data");
    return { ok: true, token, slug, reference: submissionReference(id) };
  } catch (e) {
    console.error("[onboarding] lead save failed", e);
    return { error: "Could not save your details right now." };
  }
}

// ──────────────────────────── 2. pay & submit ────────────────────────────

export async function submitOnboardingAction(
  // Pre-defaults shape — the wizard omits keys the schema fills in (e.g. `email`,
  // which Step 1 no longer collects). Validated into an OnboardingPayload below.
  input: OnboardingInput,
  // The step-1 lead token, when the lead save succeeded: that row is converted
  // instead of creating a second one.
  leadToken?: string,
): Promise<SubmitOnboardingResult> {
  // 1. Host guard — only accept from the apex marketing host.
  const guard = await apexGuard();
  if (guard) return { error: guard };

  // 2. Validate. Branding / products / order / payment-method fields are all
  // optional (schema defaults) — they are collected after payment.
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Some details are missing or invalid." };
  }
  const payload = parsed.data;

  // 3. Gate on terms + proof + honeypot (the flow is "payment received").
  if (payload.website) return { error: "Submission rejected." }; // honeypot tripped
  if (!payload.termsAccepted) return { error: "Please accept the terms to continue." };
  if (!payload.paymentProofUrl) return { error: "Please upload your proof of payment." };

  // 4. The receiving method they paid with — must be one we currently offer.
  // Its qrph tag (not its name) decides the 2% processing fee.
  const method = findVisiblePackagePaymentMethod(await getPackagePayment(), payload.paidWithMethodId);
  if (!method) return { error: "Please choose how you paid." };

  const planKey = planMeta(payload.packageKey).key; // normalize aliases → starter|pro|enterprise

  // The ₱699 / 1-month Business trial offer is retired for new sign-ups
  // (2026-07): no new tenant is ever provisioned as a trial, regardless of any
  // stale `?trial=1` link or crafted payload.
  const trial = false;

  // Re-narrowed here rather than trusted from the client — the amount stamped
  // below and the tenant's subscription window both hang off it.
  const billingCycle = normalizeOnboardingCycle(payload.billingCycle);

  // Starter must commit to at least N included add-on features.
  const selectedFeatures = planKey === "starter" ? payload.selectedFeatures : [];
  if (planKey === "starter" && selectedFeatures.length < STARTER_FEATURE_LIMIT) {
    return { error: `Please pick at least ${STARTER_FEATURE_LIMIT} features for the Starter package.` };
  }

  const { brandConfig, settings } = buildProvisioning(payload);
  const orderNumberFormat = normalizeOrderNumberFormat({}, payload.businessName);
  const token = newAccessToken();
  const accessTokenHash = hashAccessToken(token);

  // ── Demo mode (no DB): file-backed tenant + submission. ──
  if (isDemoMode()) {
    const taken = new Set(await takenSlugsFor(payload.businessName));
    let slug = pickStoreSlug(payload.businessName, taken);
    let created = createDemoTenant({ name: payload.businessName, slug, plan: planKey, themeId: payload.themeId });
    for (let n = 0; "error" in created && n < 50; n++) {
      taken.add(slug);
      slug = pickStoreSlug(payload.businessName, taken);
      created = createDemoTenant({ name: payload.businessName, slug, plan: planKey, themeId: payload.themeId });
    }
    if ("error" in created) return { error: created.error };
    const lead = findDemoByToken(leadToken);
    const sub: DemoOnboardingSubmission = {
      id: lead && isOpenLead(lead) ? lead.id : crypto.randomUUID(),
      slug,
      tenantId: slug, // demo id == slug
      setupStatus: "tenant_created",
      createdAt: new Date().toISOString(),
      accessTokenHash,
      data: { ...(payload as unknown as Record<string, unknown>), paidWithMethod: method.method },
    };
    addDemoOnboarding(sub);
    return { ok: true, slug, url: `${slug}.${ROOT}`, token, reference: submissionReference(sub.id) };
  }

  // ── DB path. ──
  // Server-authoritative checkout total (operator-edited plan config + the QR PH
  // fee when that is how they paid) — the same math the wizard paybox shows.
  const quote = quoteFromConfig(await getPlanConfig(), {
    planKey,
    trial,
    billingCycle,
    extraFeatureCount: planKey === "starter" ? Math.max(0, selectedFeatures.length - STARTER_FEATURE_LIMIT) : 0,
    qrphFee: method.qrph,
  });

  const plan = await prisma.plan.findUnique({ where: { key: planKey }, select: { id: true } });
  if (!plan) return { error: `Plan not available: ${planKey}. Please contact support.` };

  // The lead to convert, if the browser still holds a valid token for one.
  const leadRow = isPlausibleAccessToken(leadToken)
    ? await prisma.onboardingSubmission.findUnique({
        where: { accessTokenHash: hashAccessToken(leadToken) },
        select: { id: true, tenantId: true, setupStatus: true },
      })
    : null;
  const leadId = leadRow && isOpenLead(leadRow) ? leadRow.id : null;

  const taken = new Set(await takenSlugsFor(payload.businessName));
  let slug = pickStoreSlug(payload.businessName, taken);
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
            // Seed the cycle the client actually paid for; the window itself
            // (start/end) stays operator-set on publish.
            subscriptionCycle: billingCycle,
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

        const data = {
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
          billingCycle,
          trial,
          amountDueCents: quote?.totalCents ?? 0,
          paidWithMethod: method.method,
          paymentFeeCents: quote?.paymentFeeCents ?? 0,
          selectedFeatures: selectedFeatures as unknown as Prisma.InputJsonValue,
          paymentProofUrl: payload.paymentProofUrl || null,
          termsAccepted: payload.termsAccepted,
          slug: tenant.slug,
          tenantId: tenant.id,
          setupStatus: "tenant_created",
          accessTokenHash,
        };

        // Convert the step-1 lead in place (guarded: only while still an open
        // lead); otherwise — no lead, or it was converted meanwhile — create.
        if (leadId) {
          const res = await tx.onboardingSubmission.updateMany({
            where: { id: leadId, setupStatus: LEAD_STATUS, tenantId: null },
            data,
          });
          if (res.count > 0) return { ...tenant, submissionId: leadId };
        }
        const sub = await tx.onboardingSubmission.create({ data, select: { id: true } });
        return { ...tenant, submissionId: sub.id };
      });

      revalidateTag(`tenant-host:${result.slug}.${ROOT}`);
      revalidateTag("admin:data");
      return {
        ok: true,
        slug: result.slug,
        url: `${result.slug}.${ROOT}`,
        token,
        reference: submissionReference(result.submissionId),
      };
    } catch (e) {
      // Slug race → pick the next free candidate and retry; anything else bubbles.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        taken.add(slug);
        slug = pickStoreSlug(payload.businessName, taken);
        continue;
      }
      // Never echo a raw DB/Prisma message to a public visitor — log it for the
      // operator and give the client a next step they can act on.
      console.error("[onboarding] submit failed:", e);
      return {
        error:
          "We couldn't finish your sign-up just now. Your payment proof is safe — please try again, or message us on WhatsApp.",
      };
    }
  }
  return { error: "That business name is taken — please tweak it and try again." };
}

// ──────────────────────────── 3. optional details ────────────────────────────

/** The optional post-payment details. Updates the submission and re-applies
 *  provisioning to the still-pending tenant (never a published store). */
export async function updateOnboardingDetailsAction(
  token: string,
  details: OnboardingDetailsInput,
): Promise<UpdateDetailsResult> {
  const guard = (await apexGuard()) ?? (await throttle("details", 20, 10 * MINUTE));
  if (guard) return { error: guard };
  if (!isPlausibleAccessToken(token)) return { error: detailsUpdateDecisionError(null) };

  const parsed = onboardingDetailsSchema.safeParse(details);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Some details are missing or invalid." };
  }
  const d = parsed.data;
  const hash = hashAccessToken(token);

  if (isDemoMode()) {
    const s = findDemoByToken(token);
    const verdict = detailsUpdateDecision(
      s ? { tenantId: s.tenantId, tenantStatus: s.setupStatus === "completed" ? "active" : "pending_setup" } : null,
    );
    if (!verdict.ok || !s) return { error: verdict.ok ? detailsUpdateDecisionError(null) : verdict.error };
    addDemoOnboarding({ ...s, detailsSubmittedAt: new Date().toISOString(), data: { ...s.data, ...d } });
    return { ok: true, reference: submissionReference(s.id) };
  }

  try {
    const sub = await prisma.onboardingSubmission.findUnique({
      where: { accessTokenHash: hash },
      select: {
        id: true,
        businessName: true,
        businessType: true,
        description: true,
        contactPerson: true,
        email: true,
        whatsapp: true,
        facebook: true,
        packageKey: true,
        billingCycle: true,
        selectedFeatures: true,
        tenantId: true,
        tenant: { select: { id: true, slug: true, status: true } },
      },
    });
    const verdict = detailsUpdateDecision(
      sub ? { tenantId: sub.tenantId, tenantStatus: sub.tenant?.status ?? null } : null,
    );
    if (!verdict.ok) return { error: verdict.error };
    if (!sub?.tenant) return { error: detailsUpdateDecisionError(null) };
    const tenant = sub.tenant;

    // Rebuild the full payload (stored step-1/package answers + the new details)
    // so provisioning maps it exactly as a one-shot sign-up would.
    const full = onboardingSchema.safeParse({
      businessName: sub.businessName,
      businessType: sub.businessType,
      description: sub.description ?? "",
      contactPerson: sub.contactPerson ?? "",
      email: sub.email,
      whatsapp: sub.whatsapp ?? "",
      facebook: sub.facebook ?? "",
      packageKey: sub.packageKey,
      billingCycle: normalizeOnboardingCycle(sub.billingCycle),
      selectedFeatures: Array.isArray(sub.selectedFeatures) ? sub.selectedFeatures : [],
      termsAccepted: true,
      ...d,
    });
    if (!full.success) {
      return { error: full.error.issues[0]?.message ?? "Some details are missing or invalid." };
    }
    const payload = full.data;
    const { brandConfig } = buildProvisioning(payload);
    const products = productCreates(payload);

    await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction: the operator may have just published.
      const live = await tx.tenant.findUnique({ where: { id: tenant.id }, select: { status: true } });
      if (live?.status !== "pending_setup") throw new DetailsRefused();

      await tx.onboardingSubmission.update({
        where: { id: sub.id },
        data: {
          themeStyle: d.themeStyle ?? null,
          themeId: d.themeId,
          primaryColor: d.primaryColor || null,
          secondaryColor: d.secondaryColor || null,
          logoUrl: d.logoUrl || null,
          bannerUrls: d.bannerUrls as unknown as Prisma.InputJsonValue,
          inspirationUrls: d.inspirationUrls as unknown as Prisma.InputJsonValue,
          inspirationNotes: d.inspirationNotes || null,
          products: d.products as unknown as Prisma.InputJsonValue,
          orderDestination: d.orderDestination,
          orderDestinationValue: d.orderDestinationValue || null,
          paymentMethods: d.paymentMethods as unknown as Prisma.InputJsonValue,
          detailsSubmittedAt: new Date(),
        },
      });

      // Merge over what's there so anything the operator already set survives
      // unless the client just answered it.
      const branding = await tx.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
      const prior = (branding?.config ?? {}) as Record<string, unknown>;
      const config = { ...prior, ...brandConfig } as unknown as Prisma.InputJsonValue;
      await tx.branding.upsert({
        where: { tenantId: tenant.id },
        update: { themeId: payload.themeId, ...(payload.logoUrl ? { logoUrl: payload.logoUrl } : {}), config },
        create: {
          tenantId: tenant.id,
          themeId: payload.themeId,
          ...(payload.logoUrl ? { logoUrl: payload.logoUrl } : {}),
          config,
        },
      });

      // Products only when the store has none yet — never duplicate a catalog.
      if (products.length && (await tx.product.count({ where: { tenantId: tenant.id } })) === 0) {
        await tx.product.createMany({ data: products.map((p) => ({ ...p, tenantId: tenant.id })) });
      }
    });

    revalidateTenant(tenant.id, tenant.slug);
    revalidateTag("admin:data");
    return { ok: true, reference: submissionReference(sub.id) };
  } catch (e) {
    if (e instanceof DetailsRefused) {
      return { error: detailsUpdateDecisionError({ tenantId: "x", tenantStatus: "active" }) };
    }
    console.error("[onboarding] details update failed", e);
    return { error: "Could not save your details right now — please message us on WhatsApp." };
  }
}

function detailsUpdateDecisionError(sub: Parameters<typeof detailsUpdateDecision>[0]): string {
  const v = detailsUpdateDecision(sub);
  return v.ok ? "" : v.error;
}
