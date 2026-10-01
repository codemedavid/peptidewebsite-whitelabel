import "server-only";

import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import type { CommunityDrop, DropsResponse, EndDropResponse } from "@/lib/mobile/contract";
import type { CommunityActor } from "./actor.server";
import { loadProductCards, refKey } from "./cards.server";
import { insertMessage, type Outcome } from "./messages.server";
import { parseDropInput } from "./validate";
import { dropView } from "./view.server";

/**
 * Product drops: a moderator broadcasts a product (optionally one variation)
 * for a while. Posting writes a `drop` message into the chosen channel's
 * General topic in the same transaction, and pushes every approved member
 * (the route schedules that after the response).
 */

const MAX_LIVE = 20;

export async function listActiveDrops(db: TenantTx, actor: CommunityActor, now: Date): Promise<CommunityDrop[]> {
  const rows = await db.communityDrop.findMany({
    where: { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: "desc" },
    take: MAX_LIVE,
  });
  const cards = await loadProductCards(db, actor.tenant, rows.map((d) => ({ productId: d.productId, variationId: d.variationId })));
  return rows.flatMap((d) => {
    const card = cards.get(refKey({ productId: d.productId, variationId: d.variationId }));
    return card ? [dropView(d, card, now)] : [];
  });
}

export async function listDrops(actor: CommunityActor): Promise<DropsResponse> {
  return withTenant(actor.tenantId, async (db) => ({ drops: await listActiveDrops(db, actor, new Date()) }));
}

export async function createDrop(actor: CommunityActor, body: unknown): Promise<Outcome<CommunityDrop>> {
  if (!actor.isModerator) return { kind: "forbidden", message: "Only the store team can post drops." };
  const input = parseDropInput(body);
  if (!input.ok) return { kind: "invalid", message: input.error };
  const v = input.value;
  const now = new Date();
  return withTenant(actor.tenantId, async (db): Promise<Outcome<CommunityDrop>> => {
    const general = await db.communityTopic.findFirst({ where: { channelId: v.channelId, isGeneral: true } });
    if (!general) return { kind: "invalid", message: "Pick the channel that announces it." };
    const ref = { productId: v.productId, variationId: v.variationId };
    const card = (await loadProductCards(db, actor.tenant, [ref])).get(refKey(ref));
    if (!card) return { kind: "invalid", message: "That product isn't available." };

    const drop = await db.communityDrop.create({
      data: {
        tenantId: actor.tenantId,
        channelId: v.channelId,
        topicId: general.id,
        productId: v.productId,
        variationId: v.variationId,
        headline: v.headline,
        note: v.note,
        expiresAt: v.durationMinutes ? new Date(now.getTime() + v.durationMinutes * 60_000) : null,
        createdByKey: actor.authorKey ?? actor.key,
        createdAt: now,
      },
    });
    await insertMessage(
      db,
      actor,
      { type: "topic", id: general.id },
      { topicId: general.id, kind: "drop", body: v.headline, productId: v.productId, variationId: v.variationId, dropId: drop.id },
      now,
    );
    return { kind: "ok", value: dropView(drop, card, now) };
  });
}

export async function endDrop(actor: CommunityActor, dropId: string): Promise<Outcome<EndDropResponse>> {
  if (!actor.isModerator) return { kind: "forbidden", message: "Only the store team can end drops." };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(dropId)) return { kind: "not_found" };
  const res = await withTenant(actor.tenantId, (db) =>
    db.communityDrop.updateMany({ where: { id: dropId }, data: { isActive: false, endedAt: new Date() } }),
  );
  return res.count === 1 ? { kind: "ok", value: { ended: true } } : { kind: "not_found" };
}
