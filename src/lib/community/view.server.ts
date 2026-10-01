import "server-only";

import type { CommunityDrop as DropRow, CommunityMessage as MessageRow } from "@prisma/client";
import type { TenantTx } from "@/lib/db/tenant-client";
import type {
  CommunityDrop,
  CommunityMessage,
  MessageKind,
  MessagePreview,
  OrderRefCard,
  ProductCard,
  ThreadType,
} from "@/lib/mobile/contract";
import type { CommunityActor } from "./actor.server";
import { loadProductCards, loadProtocolCards, refKey, type ProductRef } from "./cards.server";
import { STORE_KEY } from "./keys";
import { loadParticipants, publicParticipant, type MemberCard } from "./participants.server";
import { canDeleteMessage, canEditMessage } from "./rules";
import { isOrderBotMessage, orderIdFromBotClientId } from "./order-bot";
import { firstName, previewText } from "./text";

/**
 * Message rows → the app's CommunityMessage, for a whole page at once. Every
 * lookup (senders, quoted messages, product cards, drops, staff names) is ONE
 * batched query, so a page costs a fixed handful of round trips inside the
 * caller's withTenant() transaction — never one per message.
 */

const MESSAGE_KINDS = new Set<MessageKind>(["text", "image", "file", "product", "protocol", "drop", "system", "order"]);

/** Order bot messages → the order they're about, in ONE query (only bot rows can name an order). */
async function loadOrderRefs(db: TenantTx, rows: MessageRow[]): Promise<Map<string, OrderRefCard>> {
  const ids = [...new Set(rows.filter((r) => isOrderBotMessage(r)).map((r) => orderIdFromBotClientId(r.clientId)))].filter(
    (x): x is string => !!x,
  );
  if (ids.length === 0) return new Map();
  const orders = await db.storefrontOrder.findMany({ where: { id: { in: ids } }, select: { id: true, orderNumber: true } });
  return new Map(orders.map((o) => [o.id, { id: o.id, number: o.orderNumber }]));
}

export function threadOf(m: Pick<MessageRow, "topicId" | "conversationId">): { type: ThreadType; id: string } {
  return m.topicId ? { type: "topic", id: m.topicId } : { type: "dm", id: m.conversationId ?? "" };
}

export function dropView(d: DropRow, product: ProductCard, now: Date): CommunityDrop {
  const expired = d.expiresAt !== null && d.expiresAt.getTime() <= now.getTime();
  return {
    id: d.id,
    product,
    headline: d.headline,
    note: d.note,
    expiresAt: d.expiresAt?.toISOString() ?? null,
    isActive: d.isActive && !expired,
    createdAt: d.createdAt.toISOString(),
    topicId: d.topicId,
  };
}

async function staffNames(db: TenantTx, authorKeys: Iterable<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>([["owner", "Store owner"]]);
  const ids = [...new Set([...authorKeys].filter((k) => k.startsWith("s:")).map((k) => k.slice(2)))];
  if (ids.length === 0) return out;
  const rows = await db.storefrontStaff.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } });
  for (const r of rows) out.set(`s:${r.id}`, r.fullName || r.email);
  return out;
}

export type ViewContext = {
  participants: Map<string, MemberCard>;
  cards: Map<string, ProductCard>;
};

export async function buildMessageViews(
  db: TenantTx,
  actor: CommunityActor,
  rows: MessageRow[],
  now = new Date(),
): Promise<CommunityMessage[]> {
  if (rows.length === 0) return [];
  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => !!x))];
  const dropIds = [...new Set(rows.map((r) => r.dropId).filter((x): x is string => !!x))];
  const [replies, drops] = await Promise.all([
    replyIds.length ? db.communityMessage.findMany({ where: { id: { in: replyIds } } }) : Promise.resolve([] as MessageRow[]),
    dropIds.length ? db.communityDrop.findMany({ where: { id: { in: dropIds } } }) : Promise.resolve([] as DropRow[]),
  ]);

  const refs: ProductRef[] = [
    ...rows.filter((r) => r.productId && !r.deletedAt).map((r) => ({ productId: r.productId!, variationId: r.variationId })),
    ...drops.map((d) => ({ productId: d.productId, variationId: d.variationId })),
  ];
  const keys = new Set([...rows, ...replies].map((r) => r.senderKey));
  const [participants, cards, names, orderRefs] = await Promise.all([
    loadParticipants(db, actor.tenant, keys),
    loadProductCards(db, actor.tenant, refs),
    actor.isModerator ? staffNames(db, rows.map((r) => r.authorKey ?? "")) : Promise.resolve(new Map<string, string>()),
    loadOrderRefs(db, rows),
  ]);
  const protocols = rows.some((r) => r.protocolId) ? loadProtocolCards(actor.tenant) : new Map();
  const replyById = new Map(replies.map((r) => [r.id, r]));
  const dropById = new Map(drops.map((d) => [d.id, d]));

  return rows.map((r) => {
    const thread = threadOf(r);
    const deleted = !!r.deletedAt;
    const sender = participants.get(r.senderKey);
    const reply = r.replyToId ? replyById.get(r.replyToId) : undefined;
    const drop = r.dropId ? dropById.get(r.dropId) : undefined;
    const dropCard = drop ? cards.get(refKey({ productId: drop.productId, variationId: drop.variationId })) : undefined;
    const kind = (MESSAGE_KINDS.has(r.kind as MessageKind) ? r.kind : "text") as MessageKind;
    return {
      id: r.id,
      threadId: thread.id,
      threadType: thread.type,
      sender: kind === "system" || !sender ? null : publicParticipant(sender),
      authorName: actor.isModerator && r.senderKey === STORE_KEY && r.authorKey ? (names.get(r.authorKey) ?? null) : null,
      mine: r.senderKey === actor.key,
      clientId: r.senderKey === actor.key && !isOrderBotMessage(r) ? (r.clientId ?? null) : null,
      kind,
      body: deleted ? null : r.body,
      product: !deleted && r.productId ? (cards.get(refKey({ productId: r.productId, variationId: r.variationId })) ?? null) : null,
      protocol: !deleted && r.protocolId ? (protocols.get(r.protocolId) ?? null) : null,
      image: !deleted && r.imageUrl ? { url: r.imageUrl, width: r.imageWidth ?? 0, height: r.imageHeight ?? 0 } : null,
      file:
        !deleted && r.fileUrl
          ? { url: r.fileUrl, name: r.fileName ?? "File", size: r.fileSize ?? 0, mime: r.fileMime ?? "application/octet-stream" }
          : null,
      drop: !deleted && drop && dropCard ? dropView(drop, dropCard, now) : null,
      order: !deleted && isOrderBotMessage(r) ? (orderRefs.get(orderIdFromBotClientId(r.clientId) ?? "") ?? null) : null,
      replyTo:
        reply && !deleted
          ? {
              id: reply.id,
              senderName: participants.get(reply.senderKey)?.name ?? "Member",
              senderHue: participants.get(reply.senderKey)?.avatarHue ?? null,
              senderIsTeam: participants.get(reply.senderKey)?.isTeam ?? false,
              text: previewText({ kind: reply.kind, body: reply.body, deleted: !!reply.deletedAt, fileName: reply.fileName }),
            }
          : null,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      deletedAt: r.deletedAt?.toISOString() ?? null,
      canEdit: canEditMessage(actor, r, now),
      canDelete: canDeleteMessage(actor, r, thread.type),
    };
  });
}

/** Inbox preview line for a thread's latest message. */
export function messagePreview(
  actor: CommunityActor,
  row: Pick<MessageRow, "kind" | "body" | "senderKey" | "fileName" | "deletedAt" | "createdAt">,
  participants: Map<string, MemberCard>,
): MessagePreview {
  const sender = participants.get(row.senderKey);
  const author =
    row.kind === "system" || row.kind === "order"
      ? null
      : row.senderKey === actor.key
        ? "You"
        : sender?.isTeam
          ? sender.name
          : firstName(sender?.name ?? "Member");
  return {
    author,
    text: previewText({ kind: row.kind, body: row.body, deleted: !!row.deletedAt, fileName: row.fileName }),
    at: row.createdAt.toISOString(),
  };
}
