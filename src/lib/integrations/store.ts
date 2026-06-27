// Tenant integration credential store — the encrypted-at-rest home for each
// tenant's PostHog project key. Reads/writes the existing TenantIntegration table
// through withTenant() so Layer-1 tenant scoping (and RLS, where enabled) applies.
//
// Two read shapes, on purpose:
//   • getPostHogStatus()  — non-secret metadata for the admin UI (NEVER the key).
//   • getEnabledPostHogTarget() — decrypts the key for server-side capture, and
//     only when the integration is enabled. A decrypt failure (e.g. ENCRYPTION_KEY
//     rotated) yields null, so capture safely no-ops instead of throwing.

import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db/tenant-client";
import { encryptSecret, decryptSecret, type EncryptedBlob } from "@/lib/crypto/envelope";
import { normalizeHost } from "@/lib/integrations/posthog";

export const POSTHOG_PROVIDER = "posthog";

export interface PostHogStatus {
  configured: boolean; // a key is stored
  enabled: boolean;
  host: string;
  healthOk: boolean | null;
  lastHealthCheckAt: Date | null;
}

export interface PostHogTargetCreds {
  projectApiKey: string;
  host: string;
}

type Row = {
  enabled: boolean;
  encryptedCredentials: unknown;
  dataKeyId: string;
  config: unknown;
  healthOk: boolean | null;
  lastHealthCheckAt: Date | null;
};

function hostOf(config: unknown): string {
  const c = (config ?? {}) as { host?: string };
  return normalizeHost(c.host);
}

async function findRow(tenantId: string): Promise<Row | null> {
  return withTenant(tenantId, (db) =>
    db.tenantIntegration.findFirst({ where: { provider: POSTHOG_PROVIDER } }),
  ) as Promise<Row | null>;
}

/** Non-secret status for the admin panel. Returns null when nothing is configured. */
export async function getPostHogStatus(tenantId: string): Promise<PostHogStatus | null> {
  const row = await findRow(tenantId);
  if (!row) return null;
  return {
    configured: true,
    enabled: row.enabled,
    host: hostOf(row.config),
    healthOk: row.healthOk,
    lastHealthCheckAt: row.lastHealthCheckAt,
  };
}

/** Decrypted key + host for capture — only when enabled and readable; else null. */
export async function getEnabledPostHogTarget(tenantId: string): Promise<PostHogTargetCreds | null> {
  const row = await findRow(tenantId);
  if (!row || !row.enabled) return null;
  try {
    const projectApiKey = decryptSecret(row.encryptedCredentials as EncryptedBlob, row.dataKeyId);
    if (!projectApiKey) return null;
    return { projectApiKey, host: hostOf(row.config) };
  } catch {
    return null; // key unreadable (rotated ENCRYPTION_KEY) → capture no-ops
  }
}

/**
 * Decrypt the stored key regardless of enabled state — for the admin's "Test
 * connection", which must work BEFORE the integration is switched on. Returns
 * null when nothing is stored or the key is unreadable.
 */
export async function getPostHogCredentials(tenantId: string): Promise<PostHogTargetCreds | null> {
  const row = await findRow(tenantId);
  if (!row) return null;
  try {
    const projectApiKey = decryptSecret(row.encryptedCredentials as EncryptedBlob, row.dataKeyId);
    if (!projectApiKey) return null;
    return { projectApiKey, host: hostOf(row.config) };
  } catch {
    return null;
  }
}

/**
 * Persist (create or replace) the tenant's PostHog credentials. Encrypts the key;
 * stores host as non-secret config. Creating a row leaves it DISABLED until the
 * operator toggles it on; re-saving a key never flips an already-enabled row.
 */
export async function savePostHogCredentials(
  tenantId: string,
  input: { projectApiKey: string; host?: string },
): Promise<void> {
  const sealed = encryptSecret(input.projectApiKey.trim());
  const config = { host: normalizeHost(input.host) } as Prisma.InputJsonValue;
  const encryptedCredentials = sealed.encryptedCredentials as unknown as Prisma.InputJsonValue;

  const existing = await findRow(tenantId);
  if (existing) {
    await withTenant(tenantId, (db) =>
      db.tenantIntegration.updateMany({
        where: { provider: POSTHOG_PROVIDER },
        data: { encryptedCredentials, dataKeyId: sealed.dataKeyId, config },
      }),
    );
    return;
  }
  await withTenant(tenantId, (db) =>
    db.tenantIntegration.create({
      data: {
        tenantId,
        provider: POSTHOG_PROVIDER,
        enabled: false,
        encryptedCredentials,
        dataKeyId: sealed.dataKeyId,
        config,
      },
    }),
  );
}

/** Flip the on/off toggle (never touches the stored credentials). */
export async function setPostHogEnabled(tenantId: string, enabled: boolean): Promise<void> {
  await withTenant(tenantId, (db) =>
    db.tenantIntegration.updateMany({ where: { provider: POSTHOG_PROVIDER }, data: { enabled } }),
  );
}

/** Record the result of a "Test connection" health probe. */
export async function recordPostHogHealth(tenantId: string, ok: boolean): Promise<void> {
  await withTenant(tenantId, (db) =>
    db.tenantIntegration.updateMany({
      where: { provider: POSTHOG_PROVIDER },
      data: { healthOk: ok, lastHealthCheckAt: new Date() },
    }),
  );
}
