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
import { postHogHealthCheck, normalizeHost } from "@/lib/integrations/posthog";

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
