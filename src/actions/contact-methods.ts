"use server";

// Contact Methods — the store OWNER edits where shoppers reach the store about
// orders (the checkout hand-off channels) and, in the Pepweb app, where a member
// who forgot their password asks for a new one. Same field the operator's
// BrandingEditor writes (branding.config.contactChannels); this is the owner's
// own path, used by the website view (AdminContactMethods) and the app (bridged
// in lib/mobile/admin-bridge.ts). Owner-only: these decide where every order goes.

import { prisma } from "@/lib/db/prisma";
import { requireStoreOwner } from "@/lib/auth/staff-guard";
import { isDemoMode } from "@/lib/demo/fixtures";
import { getTenantSlug } from "@/lib/tenant/headers";
import { patchBrandingConfig } from "@/lib/tenant/branding-config-write";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { normalizeContactChannels } from "@/lib/storefront/contact-channels";
import { parseOwnerContactChannels } from "@/lib/storefront/contact-methods";
import type { ContactChannel } from "@/storefront/types";

type Fail = { error: string };
const NO_ACCESS = "Only the store owner can change contact methods.";

/** The store's full channel set (every type, on or off), for the editor. */
export async function getStoreContactMethodsAction(): Promise<{ ok: true; channels: ContactChannel[] } | Fail> {
  const tenantId = await requireStoreOwner();
  if (!tenantId) return { error: NO_ACCESS };
  if (isDemoMode()) return { ok: true, channels: normalizeContactChannels([]) };
  const row = await prisma.branding.findUnique({ where: { tenantId }, select: { config: true } });
  const config = (row?.config ?? {}) as { contactChannels?: unknown };
  return { ok: true, channels: normalizeContactChannels(config.contactChannels) };
}

/** Save the owner's channels. Enabled ones must have a valid destination. */
export async function saveStoreContactMethodsAction(
  input: unknown,
): Promise<{ ok: true; channels: ContactChannel[] } | Fail> {
  const tenantId = await requireStoreOwner();
  if (!tenantId) return { error: NO_ACCESS };
  const raw = input && typeof input === "object" ? (input as { channels?: unknown }).channels : undefined;
  const parsed = parseOwnerContactChannels(raw);
  if (!parsed.ok) return { error: parsed.error };
  if (isDemoMode()) return { ok: true, channels: parsed.channels };

  try {
    await patchBrandingConfig(tenantId, { contactChannels: parsed.channels });
    revalidateTenant(tenantId, await getTenantSlug());
    return { ok: true, channels: parsed.channels };
  } catch (e) {
    console.error("[contact-methods] save failed", e);
    return { error: "Couldn't save your contact methods. Please try again." };
  }
}
