import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode, getDemoBranding, saveDemoBranding } from "@/lib/demo/fixtures";

/**
 * The ONE write path for branding.config.
 *
 * branding.config is a single JSON column holding a store's whole configured
 * life — payment methods, categories, promo codes, shipping, group-buy rules,
 * community settings. Dozens of features each own one key of it, and every one
 * of them saves by reading the whole blob, changing its key, and writing the
 * whole blob back. Done as two separate statements, two saves landing together
 * both read the same old blob and the second write erases the first one's
 * change: the owner edits categories while an order bumps a promo counter, and
 * one of the two silently disappears.
 *
 * So the read and the write happen inside one transaction that holds the
 * branding row's lock (`SELECT … FOR UPDATE`). A second writer waits for the
 * first to commit and then reads ITS result, so every key change survives.
 * Lock + read are one statement, keeping this to one extra round trip over the
 * old unlocked save.
 *
 * `mutate` receives the freshly locked config and returns the next one, or
 * null to abort without writing. It must be pure and fast: it runs while the
 * row is locked, so never await I/O inside it — compute anything slow first.
 *
 * Demo mode has no database; it reads and writes the demo fixture file keyed
 * by `demoKey` (the slug the demo store is filed under), defaulting to tenantId.
 */

export type BrandingConfig = Record<string, unknown>;

export async function updateBrandingConfig(
  tenantId: string,
  mutate: (current: BrandingConfig) => BrandingConfig | null,
  opts: { demoKey?: string } = {},
): Promise<BrandingConfig | null> {
  if (isDemoMode()) {
    const key = opts.demoKey ?? tenantId;
    const next = mutate((getDemoBranding(key).config ?? {}) as BrandingConfig);
    if (next) saveDemoBranding(key, { config: next });
    return next;
  }

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ config: unknown }>>`
      SELECT "config" FROM "branding" WHERE "tenantId" = ${tenantId} FOR UPDATE`;
    const next = mutate((rows[0]?.config ?? {}) as BrandingConfig);
    if (!next) return null;
    const config = next as Prisma.InputJsonValue;
    await tx.branding.upsert({
      where: { tenantId },
      update: { config },
      create: { tenantId, config },
    });
    return next;
  });
}

/**
 * Shallow-merge `patch` into branding.config under the row lock — the common
 * "this feature owns these keys" save. Keys the patch doesn't name are kept.
 */
export async function patchBrandingConfig(
  tenantId: string,
  patch: BrandingConfig,
  opts: { demoKey?: string } = {},
): Promise<BrandingConfig> {
  const next = await updateBrandingConfig(tenantId, (current) => ({ ...current, ...patch }), opts);
  // The merge never returns null, so neither does the update.
  return next as BrandingConfig;
}
