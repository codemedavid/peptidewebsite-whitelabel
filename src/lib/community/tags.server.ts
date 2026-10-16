import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { CommunityTagsResponse } from "@/lib/mobile/contract";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import type { CommunityActor } from "./actor.server";
import { communityTags, parseCommunityTagsInput } from "./tags";

/**
 * Saves the member-tag looks (branding.config.communityTags). Read-modify-write
 * under a row lock so the owner and an admin restyling different tags at the
 * same moment both keep their change.
 */
export async function saveCommunityTags(actor: CommunityActor, body: unknown): Promise<{ ok: true; value: CommunityTagsResponse } | { ok: false; error: string }> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "branding" WHERE "tenantId" = ${actor.tenantId} FOR UPDATE`;
    const row = await tx.branding.findUnique({ where: { tenantId: actor.tenantId }, select: { config: true } });
    const current = (row?.config ?? {}) as Record<string, unknown>;
    const parsed = parseCommunityTagsInput(body, communityTags(current));
    if (!parsed.ok) return parsed;
    const config = { ...current, communityTags: parsed.value } as Prisma.InputJsonValue;
    await tx.branding.upsert({ where: { tenantId: actor.tenantId }, update: { config }, create: { tenantId: actor.tenantId, config } });
    return { ok: true as const, value: { tags: parsed.value } };
  });
  if (result.ok) revalidateTenant(actor.tenantId, actor.slug);
  return result;
}
