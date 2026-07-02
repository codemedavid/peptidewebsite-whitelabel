"use server";

// Super-admin actions for the per-tenant PostHog integration. The operator pastes
// each tenant's OWN project API key here; it is encrypted at rest (envelope.ts)
// and only ever decrypted server-side for capture / the connection test. The
// plaintext key is never returned to the browser. All three actions require a
// platform (super-admin) session, exactly like the other admin mutations.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getPlatformUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo/fixtures";
import {
  savePostHogCredentials,
  setPostHogEnabled,
  getPostHogCredentials,
  recordPostHogHealth,
} from "@/lib/integrations/store";
import { postHogHealthCheck, postHogCapture, normalizeHost } from "@/lib/integrations/posthog";
import {
  buildEmailBrand,
  buildSampleOrder,
  buildOrderPlacedPayload,
  buildStatusChangedPayload,
} from "@/lib/analytics/events";
import { storefrontOrigin } from "@/lib/tenant/resolve";

export type IntegrationResult = { ok: true } | { error: string };
export type TestResult = { ok: true; healthy: boolean } | { error: string };

const SLUG_RE = /^[a-z0-9-]{2,}$/;

/** Common guard: valid slug, live DB, platform session, resolved tenant id. */
async function guard(slug: string): Promise<{ tenantId: string } | { error: string }> {
  if (!SLUG_RE.test(slug)) return { error: "Invalid tenant slug." };
  if (isDemoMode()) return { error: "Integrations aren't available in demo mode." };
  if (!(await getPlatformUser())) return { error: "FORBIDDEN" };
  const t = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!t) return { error: "Tenant not found." };
  return { tenantId: t.id };
}

/** Save (or replace) the tenant's PostHog project key + host. Leaves it disabled. */
export async function savePostHogKeyAction(
  slug: string,
  input: { projectApiKey: string; host?: string },
): Promise<IntegrationResult> {
  const g = await guard(slug);
  if ("error" in g) return g;

  const key = (input.projectApiKey ?? "").trim();
  // PostHog project keys are public-ingest keys prefixed `phc_`. Accept anything
  // non-trivial but reject obvious mistakes (blank, a pasted URL, etc.).
  if (key.length < 10) {
    return { error: "Enter a valid PostHog project API key (it starts with phc_)." };
  }

  try {
    await savePostHogCredentials(g.tenantId, { projectApiKey: key, host: normalizeHost(input.host) });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the key." };
  }
  revalidatePath(`/admin/tenants/${slug}/integrations`);
  return { ok: true };
}

/** Turn the integration on/off. Refuses to enable an unconfigured integration. */
export async function setPostHogEnabledAction(
  slug: string,
  enabled: boolean,
): Promise<IntegrationResult> {
  const g = await guard(slug);
  if ("error" in g) return g;
  if (enabled && !(await getPostHogCredentials(g.tenantId))) {
    return { error: "Save a PostHog key before enabling." };
  }
  await setPostHogEnabled(g.tenantId, enabled);
  revalidatePath(`/admin/tenants/${slug}/integrations`);
  return { ok: true };
}

/** Probe the stored key by sending a throwaway capture; records health. */
export async function testPostHogConnectionAction(slug: string): Promise<TestResult> {
  const g = await guard(slug);
  if ("error" in g) return g;
  const creds = await getPostHogCredentials(g.tenantId);
  if (!creds) return { error: "Save a PostHog key first." };
  const healthy = await postHogHealthCheck(creds);
  await recordPostHogHealth(g.tenantId, healthy);
  revalidatePath(`/admin/tenants/${slug}/integrations`);
  return { ok: true, healthy };
}

/**
 * Fire one of EACH real event into the tenant's PostHog project from a sample
 * order — `order_placed`, then `order_status_changed` for shipped and delivered —
 * so the operator can verify their PostHog workflows/emails in one click without
 * placing a real order. Events are flagged `test: true`. The optional email is
 * set on the sample person so PostHog Messaging routes the test emails there.
 */
export async function sendPostHogTestEventsAction(
  slug: string,
  email?: string,
): Promise<{ ok: true; sent: number } | { error: string }> {
  const g = await guard(slug);
  if ("error" in g) return g;
  const creds = await getPostHogCredentials(g.tenantId);
  if (!creds) return { error: "Save a PostHog key first." };

  const e = (email ?? "").trim();
  if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
    return { error: "Enter a valid test email, or leave it blank." };
  }

  // Stamp the tenant's real branding onto the sample events so the operator's
  // PostHog email templates preview with this store's actual identity.
  const branding = await prisma.branding.findUnique({
    where: { tenantId: g.tenantId },
    select: { config: true },
  });
  const emailBrand = buildEmailBrand(
    (branding?.config ?? {}) as Record<string, unknown>,
    storefrontOrigin(slug),
  );

  const order = buildSampleOrder(e);
  const events = [
    buildOrderPlacedPayload(order, emailBrand),
    buildStatusChangedPayload(order, "processing", "shipped", emailBrand),
    buildStatusChangedPayload(order, "shipped", "delivered", emailBrand),
  ];

  let sent = 0;
  try {
    for (const ev of events) {
      await postHogCapture(creds, { ...ev, properties: { ...ev.properties, test: true } });
      sent++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't send test events.";
    return { error: sent > 0 ? `Sent ${sent}/${events.length}, then failed: ${msg}` : msg };
  }

  await recordPostHogHealth(g.tenantId, true);
  revalidatePath(`/admin/tenants/${slug}/integrations`);
  return { ok: true, sent };
}
