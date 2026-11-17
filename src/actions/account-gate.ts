"use server";

// Store-admin switch for the members-only sign-in wall
// (lib/storefront/account-gate.ts). Lives beside the Customers list because
// the wall is made of customer accounts: it needs the same entitlement, and
// the same staff grant, as managing those accounts.

import { prisma } from "@/lib/db/prisma";
import { isDemoMode } from "@/lib/demo/fixtures";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { getTenantSlug } from "@/lib/tenant/headers";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { patchBrandingConfig } from "@/lib/tenant/branding-config-write";
import { requireStaffPermission } from "@/lib/auth/staff-guard";
import { normalizeAccountGate, type AccountGateConfig } from "@/lib/storefront/account-gate";

type Fail = { error: string };

const NOT_SIGNED_IN = "Not signed in to the store admin.";
const UNAVAILABLE = "Customer accounts aren't available on this store.";

async function gateTenant(): Promise<{ tenantId: string } | Fail> {
  const ctx = await requireStaffPermission("customers");
  if (!ctx) return { error: NOT_SIGNED_IN };
  if (isDemoMode()) return { error: "Not available in demo mode." };
  if (!(await hasFeature(ctx.tenantId, FEATURES.STORE_CUSTOMER_ACCOUNTS))) return { error: UNAVAILABLE };
  return { tenantId: ctx.tenantId };
}

export async function getAccountGateAction(): Promise<({ ok: true } & AccountGateConfig) | Fail> {
  const t = await gateTenant();
  if ("error" in t) return t;
  const row = await prisma.branding.findUnique({ where: { tenantId: t.tenantId }, select: { config: true } });
  const config = (row?.config ?? {}) as { accountGate?: unknown };
  return { ok: true, ...normalizeAccountGate(config.accountGate) };
}

export async function setAccountGateAction(input: unknown): Promise<({ ok: true } & AccountGateConfig) | Fail> {
  try {
    const t = await gateTenant();
    if ("error" in t) return t;
    const next = normalizeAccountGate(input);

    await patchBrandingConfig(t.tenantId, { accountGate: next });
    revalidateTenant(t.tenantId, await getTenantSlug());
    return { ok: true, ...next };
  } catch (err) {
    console.error("setAccountGateAction", (err as Error)?.message);
    return { error: "Couldn't save. Please try again." };
  }
}
