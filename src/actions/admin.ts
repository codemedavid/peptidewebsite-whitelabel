"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo/fixtures";
import { isValidPlanKey, isValidStatus } from "@/lib/admin/plan-options";
import { validateWhatsapp } from "@/lib/admin/whatsapp";
import { revalidateTenant, revalidateTenantVisibility } from "@/lib/tenant/revalidate";
import { addBillingCycle, isBillingCycle } from "@/lib/subscription/billing-cycle";
import { resolvePriceCentsInput } from "@/lib/subscription/plan-fee";
import { writeSubscriptionWindow, type WindowWrite } from "@/lib/subscription/persist-window";
export type AdminActionResult = { ok: true; status?: string } | { error: string };

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").replace(/:\d+$/, "");

/**
 * Suspend / reactivate a tenant. A suspended tenant's storefront is bounced to
 * /unknown-tenant by getTenantId(), so this is a real kill-switch.
 */
export async function suspendTenantAction(slug: string): Promise<AdminActionResult> {
  await requirePlatformUser();
  // Built-in demo tenants are immutable fixtures — say so instead of faking a
  // status the UI would toast as "reactivated".
  if (isDemoMode()) return { error: "Suspending built-in demo tenants isn't supported." };
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, status: true },
  });
  if (!tenant) return { error: "Tenant not found." };
  const next = tenant.status === "suspended" ? "active" : "suspended";
  // Conditional flip: only apply if the status is still the one we read, so a
  // concurrent toggle can't double-flip (same pattern as admin-upgrades).
  const flipped = await prisma.tenant.updateMany({
    where: { id: tenant.id, status: tenant.status },
    data: { status: next },
  });
  if (flipped.count === 0) return { error: "The tenant's status just changed — refresh and try again." };
  // Bust the host-resolver + tenant caches on every host (custom domains
  // included) so the kill-switch — and a reactivation — takes effect on the
  // next storefront request instead of after the resolver's 5-minute TTL.
  await revalidateTenantVisibility(tenant.id);
  revalidateTag("admin:data");
  revalidatePath("/admin");
  revalidatePath("/admin/tenants");
  revalidatePath(`/admin/tenants/${slug}`);
  return { ok: true, status: next };
}

/**
 * Reassign a tenant's package plan and lifecycle status (Super Admin → tenant
 * settings). `planKey` must be a canonical key (starter | pro | enterprise) —
 * it's resolved to the Plan row's id before writing Tenant.planId. Changing the
 * plan re-gates the tenant's features (the storefront derives entitlements from
 * the plan's feature set) and updates MRR/plan distribution — revalidateTenant
 * busts the entitlement + host-resolver caches so the change takes effect on the
 * next storefront request (a status flip to "suspended" really goes offline).
 */
export async function setTenantPlanAction(
  slug: string,
  planKey: string,
  status: string,
): Promise<AdminActionResult> {
  await requirePlatformUser();
  if (!isValidPlanKey(planKey)) return { error: "Unknown plan." };
  if (!isValidStatus(status)) return { error: "Unknown status." };
  // Built-in demo tenants are immutable fixtures — say so instead of faking a
  // status change the UI would render as applied.
  if (isDemoMode()) return { error: "Changing built-in demo tenants isn't supported." };
  // Independent reads — resolve the tenant and the target plan row in parallel.
  const [tenant, plan] = await Promise.all([
    prisma.tenant.findUnique({ where: { slug }, select: { id: true } }),
    prisma.plan.findUnique({ where: { key: planKey }, select: { id: true } }),
  ]);
  if (!tenant) return { error: "Tenant not found." };
  if (!plan) return { error: `The "${planKey}" plan isn't set up in the database yet.` };
  await prisma.tenant.update({ where: { id: tenant.id }, data: { planId: plan.id, status } });
  // Bust the storefront caches (entitlements re-gate, host resolver picks up a
  // suspend — custom domains included) in addition to the admin surface.
  await revalidateTenantVisibility(tenant.id);
  revalidateTag("admin:data");
  revalidatePath("/admin");
  revalidatePath("/admin/tenants");
  revalidatePath(`/admin/tenants/${slug}`);
  revalidatePath(`/admin/tenants/${slug}/settings`);
  return { ok: true, status };
}

/**
 * Connect (or update / clear) the tenant owner's WhatsApp number for one-tap
 * follow-up from the Super Admin tenants console. The number is normalized to a
 * bare dial string before persisting; an empty input clears it. Operator-only —
 * tenants can't see or edit this.
 */
export async function setTenantWhatsappAction(slug: string, raw: string): Promise<AdminActionResult> {
  await requirePlatformUser();
  if (isDemoMode()) {
    // Built-in demo tenants are immutable fixtures; report success without persisting.
    return { ok: true };
  }
  const trimmed = raw.trim();
  let digits: string | null = null;
  if (trimmed) {
    const v = validateWhatsapp(trimmed);
    if ("error" in v) return { error: v.error };
    digits = v.digits;
  }
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) return { error: "Tenant not found." };
  await prisma.tenant.update({ where: { id: tenant.id }, data: { ownerWhatsapp: digits } });
  revalidateTag("admin:data");
  revalidatePath("/admin");
  revalidatePath("/admin/tenants");
  revalidatePath(`/admin/tenants/${slug}`);
  return { ok: true };
}

/** Parse a "YYYY-MM-DD" date-input value into a UTC Date (null when invalid). */
function parseDay(s: string | undefined | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Bust every surface that renders a tenant's subscription window. */
function revalidateSubscriptionSurfaces(tenantId: string, slug: string): void {
  // tenant:${id} (via revalidateTenant) is the tag the subscription resolver
  // and the store-admin banner read through; admin:data + the tenant pages are
  // the platform-side views.
  revalidateTenant(tenantId, slug);
  revalidateTag("admin:data");
  revalidatePath("/admin");
  revalidatePath("/admin/tenants");
  revalidatePath(`/admin/tenants/${slug}`);
}

/**
 * Set (or clear) a tenant's paid-subscription window from the Super Admin
 * tenant-detail page — the operator setter the subscription-duration display
 * machinery was waiting on.
 *
 * The operator picks a billing cycle (monthly | quarterly | semi_annual |
 * yearly) and a start date; the due date is auto-calculated one calendar term
 * on (addBillingCycle) unless an explicit `endsAt` overrides it. Passing
 * `cycle: null` clears the whole window, so the tenant returns to the
 * byte-identical no-banner legacy state.
 *
 * Server is the authority: it re-derives/validates the window regardless of what
 * the client computed, so the due date can never be saved on or before the start.
 */
export async function setSubscriptionWindowAction(
  slug: string,
  input: {
    cycle: string | null;
    startsAt?: string;
    endsAt?: string;
    amountCents?: number | null;
    priceCents?: number | null;
  },
): Promise<AdminActionResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: "Connect a database to manage subscriptions." };

  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) return { error: "Tenant not found." };

  // Build the exact write for both branches so a single resilient persist call
  // covers clear and set. `subscriptionPriceCents` is a pending-db:push column
  // ([[live-db-state]]) — persistWindow drops it on retry so a not-yet-migrated
  // DB can't crash the save.
  let data: WindowWrite;

  // Clear the window — no cycle chosen.
  if (!input.cycle) {
    data = {
      subscriptionCycle: null,
      subscriptionStartsAt: null,
      subscriptionEndsAt: null,
      subscriptionAmountCents: null,
      subscriptionPriceCents: null,
    };
  } else {
    if (!isBillingCycle(input.cycle)) return { error: "Unknown billing cycle." };
    const startsAt = parseDay(input.startsAt);
    if (!startsAt) return { error: "Set a valid subscription start date." };
    // Auto-calc the due date from the cycle; an explicit endsAt is the operator's
    // manual override.
    const endsAt = parseDay(input.endsAt) ?? addBillingCycle(startsAt, input.cycle);
    if (endsAt.getTime() <= startsAt.getTime()) {
      return { error: "The due date must be after the start date." };
    }

    // What the tenant paid for the term (centavos). Optional — null clears it.
    let amountCents: number | null = null;
    if (input.amountCents != null) {
      if (!Number.isFinite(input.amountCents) || input.amountCents < 0) {
        return { error: "Enter a valid subscription amount." };
      }
      amountCents = Math.round(input.amountCents);
    }

    // The tenant's recurring monthly price / payment due (centavos). Optional —
    // null clears it and the Plan fee / MRR fall back to the plan-config price.
    // Validated + clamped centrally (0 is a valid comped value).
    const priceResult = resolvePriceCentsInput(input.priceCents);
    if ("error" in priceResult) return { error: priceResult.error };

    data = {
      subscriptionCycle: input.cycle,
      subscriptionStartsAt: startsAt,
      subscriptionEndsAt: endsAt,
      subscriptionAmountCents: amountCents,
      subscriptionPriceCents: priceResult.value,
    };
  }

  try {
    await writeSubscriptionWindow(
      (patch) => prisma.tenant.update({ where: { id: tenant.id }, data: patch }),
      data,
    );
  } catch (err) {
    // Never let a write failure bubble as an uncaught Server Action error — that
    // surfaces to the operator as the opaque "Server Components render" digest.
    console.error("setSubscriptionWindowAction: write failed", err);
    return { error: "Couldn't save the subscription window. Please try again." };
  }

  revalidateSubscriptionSurfaces(tenant.id, slug);
  return { ok: true };
}

/** Permanently delete a tenant and all its data (cascades via FK). */
export async function deleteTenantAction(slug: string): Promise<AdminActionResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: "Deleting built-in demo tenants isn't supported." };
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, domains: { select: { hostname: true } } },
  });
  if (!tenant) return { error: "Tenant not found." };
  // Capture the hostnames BEFORE the delete cascades the Domain rows away,
  // then bust — otherwise the host resolver keeps returning the dead tenant
  // (→ 500s on its storefront) for up to 5 minutes.
  const hostnames = tenant.domains.map((d) => d.hostname);
  await prisma.tenant.delete({ where: { id: tenant.id } });
  revalidateTenant(tenant.id, slug, hostnames);
  revalidateTag("admin:data");
  revalidatePath("/admin");
  revalidatePath("/admin/tenants");
  return { ok: true };
}

/* ============================================================
   Custom domains (per-tenant)

   A custom domain like `shop.acme.com` is a simple host → tenant mapping.
   The operator handles two steps outside this app: (1) attach the domain to
   the hosting project (Vercel dashboard) for TLS + routing, and (2) ensure
   the customer pointed DNS at the platform. Once both are done, saving the
   hostname here is what makes resolveTenantByHost() route requests to the
   right tenant.
   ============================================================ */

/** Normalize user input to a bare hostname, or return an error string. */
function normalizeHostname(raw: string): { host: string } | { error: string } {
  let h = raw.trim().toLowerCase();
  h = h.replace(/^https?:\/\//, ""); // strip scheme
  h = h.replace(/\/.*$/, ""); // strip path
  h = h.replace(/:\d+$/, ""); // strip port
  h = h.replace(/\.$/, ""); // strip trailing dot
  if (!h) return { error: "Enter a domain." };
  // RFC-ish hostname check: labels of letters/digits/hyphens, a dotted TLD.
  if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(h)) {
    return { error: "That doesn't look like a valid domain (e.g. shop.acme.com)." };
  }
  // Platform subdomains (slug.<root>) are handled automatically — they don't go
  // through the custom-domain table, so reject them here to avoid confusion.
  if (h === ROOT || h.endsWith(`.${ROOT}`)) {
    return { error: `${ROOT} subdomains are automatic — only add domains you own elsewhere.` };
  }
  return { host: h };
}

async function tenantIdForSlug(slug: string): Promise<string | null> {
  const t = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  return t?.id ?? null;
}

/** Attach a custom domain to a tenant. Operator asserts DNS + Vercel are set. */
export async function addTenantDomainAction(slug: string, rawHost: string): Promise<AdminActionResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: "Custom domains aren't available for demo tenants." };

  const norm = normalizeHostname(rawHost);
  if ("error" in norm) return norm;
  const { host } = norm;

  const tenantId = await tenantIdForSlug(slug);
  if (!tenantId) return { error: "Tenant not found." };

  const existing = await prisma.domain.findUnique({
    where: { hostname: host },
    select: { tenantId: true },
  });
  if (existing) {
    return existing.tenantId === tenantId
      ? { error: "That domain is already added to this tenant." }
      : { error: "That domain is already in use by another tenant." };
  }

  await prisma.domain.create({
    data: { tenantId, hostname: host, verified: true },
  });
  revalidateTag(`tenant-host:${host}`);
  revalidatePath(`/admin/tenants/${slug}/settings`);

  return { ok: true };
}

/** Remove a custom domain from a tenant. */
export async function removeTenantDomainAction(slug: string, rawHost: string): Promise<AdminActionResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: "Custom domains aren't available for demo tenants." };

  const norm = normalizeHostname(rawHost);
  if ("error" in norm) return norm;
  const { host } = norm;

  const domain = await prisma.domain.findUnique({
    where: { hostname: host },
    select: { id: true, tenant: { select: { slug: true } } },
  });
  if (!domain || domain.tenant.slug !== slug) return { error: "Domain not found for this tenant." };

  await prisma.domain.delete({ where: { id: domain.id } });
  revalidateTag(`tenant-host:${host}`);
  revalidatePath(`/admin/tenants/${slug}/settings`);
  return { ok: true };
}

/** Mark one verified domain as the tenant's primary (canonical) hostname. */
export async function setPrimaryTenantDomainAction(slug: string, rawHost: string): Promise<AdminActionResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: "Custom domains aren't available for demo tenants." };

  const norm = normalizeHostname(rawHost);
  if ("error" in norm) return norm;
  const { host } = norm;

  const tenantId = await tenantIdForSlug(slug);
  if (!tenantId) return { error: "Tenant not found." };

  const domain = await prisma.domain.findUnique({
    where: { hostname: host },
    select: { id: true, tenantId: true },
  });
  if (!domain || domain.tenantId !== tenantId) return { error: "Domain not found for this tenant." };

  // Exactly one primary per tenant.
  await prisma.$transaction([
    prisma.domain.updateMany({ where: { tenantId }, data: { isPrimary: false } }),
    prisma.domain.update({ where: { id: domain.id }, data: { isPrimary: true } }),
  ]);
  revalidatePath(`/admin/tenants/${slug}/settings`);
  return { ok: true };
}
