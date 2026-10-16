import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-client";
import { FEATURES } from "@/lib/features/catalog";
import type { CustomerContext } from "@/lib/mobile/auth";
import type { PreviewPolicyResponse } from "@/lib/mobile/contract";
import { loadShopCatalog } from "@/lib/mobile/shop-catalog";
import { parseLines } from "@/lib/mobile/shop-orders";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import type { CommunityActor } from "./actor.server";
import { admitCustomer } from "./admission.server";
import { parsePreviewPolicyUpdate, previewFor, previewOrderBlocked, previewPolicyOf, type PreviewPolicy } from "./preview";

/**
 * Preview access on the server: the store team's policy (branding.config.previewAccess)
 * and the shop's half of enforcing it. The community's half is rules.ts, applied
 * through the actor (actor.server.ts) and withCommunity's `preview` opt-in.
 */

export function previewPolicyResponse(actor: CommunityActor): PreviewPolicyResponse {
  return { policy: previewPolicyOf(actor.tenant.branding?.config) };
}

/**
 * Saves the policy. Read-modify-write under a row lock (like the member tags),
 * so two team members switching different settings at once both keep theirs.
 */
export async function savePreviewPolicy(
  actor: CommunityActor,
  body: unknown,
): Promise<{ ok: true; value: PreviewPolicyResponse } | { ok: false; error: string }> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "branding" WHERE "tenantId" = ${actor.tenantId} FOR UPDATE`;
    const row = await tx.branding.findUnique({ where: { tenantId: actor.tenantId }, select: { config: true } });
    const current = (row?.config ?? {}) as Record<string, unknown>;
    const parsed = parsePreviewPolicyUpdate(body, previewPolicyOf(current));
    if (!parsed.ok) return parsed;
    const config = { ...current, previewAccess: parsed.value } as Prisma.InputJsonValue;
    await tx.branding.upsert({ where: { tenantId: actor.tenantId }, update: { config }, create: { tenantId: actor.tenantId, config } });
    return { ok: true as const, value: { policy: parsed.value } };
  });
  if (result.ok) revalidateTenant(actor.tenantId, actor.slug);
  return result;
}

/** Someone in preview has somewhere to post: a channel set to chat, or the store's DM. */
export async function previewCanPost(actor: CommunityActor): Promise<boolean> {
  if (!actor.preview) return true;
  if (actor.preview.messageStore) return true;
  const chat = await withTenant(actor.tenantId, (db) => db.communityChannel.count({ where: { previewAccess: "chat" } }));
  return chat > 0;
}

/**
 * The policy this shopper is under, or null for a full member. Stores without
 * the community, or with preview off, return null before touching membership.
 */
export async function customerPreview(ctx: CustomerContext): Promise<PreviewPolicy | null> {
  const policy = previewPolicyOf(ctx.tenant.branding?.config);
  if (!policy.enabled || !ctx.tenant.has(FEATURES.MOBILE_COMMUNITY)) return null;
  const member = await admitCustomer(ctx.tenant, ctx.tenantId, ctx.customer);
  return previewFor(policy, member.status);
}

/**
 * POST /shop/orders in preview: an order needs the switch for each kind of
 * line in it — joinGroupBuys for lines in the live round, placeOrders for the
 * rest. Whether a line is in the round is the catalog's own answer (isGroupBuy).
 * True = refuse. A cart that doesn't parse isn't judged here; placement
 * refuses it with its own message.
 */
export async function previewBlocksOrder(ctx: CustomerContext, policy: PreviewPolicy, rawLines: unknown): Promise<boolean> {
  if (policy.placeOrders && policy.joinGroupBuys) return false;
  if (!policy.placeOrders && !policy.joinGroupBuys) return true;
  const lines = parseLines(rawLines);
  if (!lines.ok) return false;
  const catalog = await loadShopCatalog({ tenantId: ctx.tenantId, slug: ctx.slug, customer: ctx });
  const inRound = new Set(catalog.products.filter((p) => p.isGroupBuy).map((p) => p.id));
  const groupBuy = lines.lines.some((l) => inRound.has(l.productId));
  const onHand = lines.lines.some((l) => !inRound.has(l.productId));
  return previewOrderBlocked(policy, groupBuy, onHand);
}
