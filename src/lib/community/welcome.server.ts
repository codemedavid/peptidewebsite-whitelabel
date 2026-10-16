import "server-only";

import type { TenantTx } from "@/lib/db/tenant-client";
import type { CommunityActor } from "./actor.server";
import { STORE_KEY, customerKey, dmPair } from "./keys";
import { ORDER_BOT_AUTHOR } from "./order-bot";
import { communityWelcome, welcomeRows } from "./welcome";

/**
 * The store's welcome DMs (branding.config.communityWelcome) — one or more
 * messages, each text, a photo or a video with a caption, sent in order. Sent
 * from the inbox, the first time a member opens Chats — one door however they were
 * admitted (open join, the owner approving, re-applying).
 *
 * Every member is stamped `welcomedAt` on that first visit, welcome on or off,
 * so switching the message on later greets NEW members rather than everyone
 * who already joined. The stamp is claimed with a conditional update, so two
 * racing first visits send it once.
 */

export async function welcomeIfNew(db: TenantTx, actor: CommunityActor, now: Date): Promise<void> {
  if (!actor.customerId || actor.welcomed) return;
  const claimed = await db.communityMember.updateMany({
    where: { customerId: actor.customerId, welcomedAt: null },
    data: { welcomedAt: now },
  });
  if (claimed.count !== 1) return;

  const rows = welcomeRows(communityWelcome(actor.tenant.branding?.config), actor.customerId);
  if (rows.length === 0) return;

  const pair = dmPair(STORE_KEY, customerKey(actor.customerId))!;
  const conversation = await db.communityConversation.upsert({
    where: { tenantId_lowKey_highKey: { tenantId: actor.tenantId, ...pair } },
    create: { tenantId: actor.tenantId, ...pair },
    update: {},
    select: { id: true },
  });
  // A millisecond apart, so the thread (ordered by createdAt) keeps the
  // owner's order.
  const at = (i: number) => new Date(now.getTime() + i);
  await db.communityMessage.createMany({
    data: rows.map((row, i) => ({
      tenantId: actor.tenantId,
      conversationId: conversation.id,
      senderKey: STORE_KEY,
      authorKey: ORDER_BOT_AUTHOR,
      ...row,
      createdAt: at(i),
    })),
  });
  await db.communityConversation.updateMany({
    where: { id: conversation.id },
    data: { lastMessageAt: at(rows.length - 1), messageCount: { increment: rows.length } },
  });
}
