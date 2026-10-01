import "server-only";

import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db/tenant-client";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { storeDisplayName } from "@/lib/mobile/store-name";
import { getTenantContext } from "@/lib/tenant/context";
import { ACTIVE_ORDERS_WHERE } from "@/lib/orders/trash";
import { normalizeStatusHistory } from "@/lib/orders/db-mapping";
import { STORE_KEY, customerKey, dmPair } from "./keys";
import {
  ORDER_BOT_AUTHOR,
  ORDER_MESSAGE_KIND,
  orderBotClientId,
  orderUpdatePush,
  orderUpdateReason,
  orderUpdateText,
} from "./order-bot";
import { notifyOrderUpdate } from "./push.server";

/**
 * The order bot's DB side. Called once per committed order save (see
 * applyOrderStatusChange and the bulk status action), after the response:
 *
 *   1. Only an order placed from a signed-in customer ACCOUNT has someone to
 *      tell — guest orders are matched to no one (emails aren't verified).
 *   2. Only stores with the app community (MOBILE_COMMUNITY) have the chat.
 *   3. The bot writes into the ONE store ⇄ customer DM (opened if new), as a
 *      `store` message authored "bot", then pushes the customer's phones.
 *
 * Idempotent through the message clientId (orderBotClientId). Never throws:
 * the order is already saved, and a chat hiccup must not look like it wasn't.
 */

export type OrderUpdateInput = {
  tenantId: string;
  orderId: string;
  statusChanged: boolean;
  /** The tracking number BEFORE this save. */
  prevTracking: string;
};

const BLOCKED_MEMBER = new Set(["rejected", "revoked"]);

type Posted = { customerId: string; conversationId: string; orderNumber: string; push: string } | null;

async function postOrderUpdate(input: OrderUpdateInput): Promise<Posted> {
  return withTenant(input.tenantId, async (db): Promise<Posted> => {
    const order = await db.storefrontOrder.findFirst({
      where: { ...ACTIVE_ORDERS_WHERE, id: input.orderId },
      select: {
        status: true,
        statusHistory: true,
        orderNumber: true,
        courier: true,
        trackingNumber: true,
        customerAccountId: true,
        customerAccount: { select: { status: true, communityMember: { select: { status: true } } } },
      },
    });
    const customerId = order?.customerAccountId;
    if (!order || !customerId || order.customerAccount?.status !== "active") return null;
    if (BLOCKED_MEMBER.has(order.customerAccount.communityMember?.status ?? "")) return null;

    const reason = orderUpdateReason({
      statusChanged: input.statusChanged,
      status: order.status,
      prevTracking: input.prevTracking,
      tracking: order.trackingNumber,
    });
    if (!reason) return null;

    const clientId = orderBotClientId(input.orderId, normalizeStatusHistory(order.statusHistory).length, order.trackingNumber);
    const facts = {
      orderNumber: order.orderNumber,
      status: order.status,
      courier: order.courier,
      trackingNumber: order.trackingNumber,
    };

    const pair = dmPair(STORE_KEY, customerKey(customerId))!;
    const conversation =
      (await db.communityConversation.findFirst({ where: pair, select: { id: true } })) ??
      (await db.communityConversation.create({ data: { ...pair, tenantId: input.tenantId }, select: { id: true } }));

    // Already posted (a replayed save): nothing new to say, nothing to push.
    if (await db.communityMessage.findFirst({ where: { senderKey: STORE_KEY, clientId }, select: { id: true } })) return null;

    const now = new Date();
    await db.communityMessage.create({
      data: {
        tenantId: input.tenantId,
        conversationId: conversation.id,
        senderKey: STORE_KEY,
        authorKey: ORDER_BOT_AUTHOR,
        kind: ORDER_MESSAGE_KIND,
        body: orderUpdateText(facts),
        clientId,
        createdAt: now,
      },
    });
    await db.communityConversation.updateMany({
      where: { id: conversation.id },
      data: { lastMessageAt: now, messageCount: { increment: 1 } },
    });
    return {
      customerId,
      conversationId: conversation.id,
      orderNumber: order.orderNumber,
      push: orderUpdatePush({ ...facts, reason }).body,
    };
  });
}

export async function sendOrderUpdate(input: OrderUpdateInput): Promise<void> {
  try {
    if (!(await hasFeature(input.tenantId, FEATURES.MOBILE_COMMUNITY))) return;
    let posted: Posted;
    try {
      posted = await postOrderUpdate(input);
    } catch (e) {
      // A race on the unique conversation pair (the customer opened the chat
      // at that instant) or on the clientId (a replayed save). One retry
      // re-reads the winner's row: the conversation now exists, and a replay
      // finds its message already posted.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      posted = await postOrderUpdate(input);
    }
    if (!posted) return;
    const tenant = await getTenantContext(input.tenantId);
    await notifyOrderUpdate({
      tenantId: input.tenantId,
      customerId: posted.customerId,
      conversationId: posted.conversationId,
      orderNumber: posted.orderNumber,
      body: posted.push,
      storeName: storeDisplayName(tenant),
    });
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? ` (${String((e as { code: unknown }).code)})` : "";
    console.error(`[order-bot] order update failed: ${e instanceof Error ? e.name : "Error"}${code}`);
  }
}
