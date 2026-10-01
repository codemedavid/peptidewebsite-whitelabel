import "server-only";

import { Prisma, type CommunityMessage as MessageRow } from "@prisma/client";
import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import type { CommunityMessage, MessagesResponse, ThreadType } from "@/lib/mobile/contract";
import type { CommunityActor } from "./actor.server";
import { loadProductCards, loadProtocolCards, refKey } from "./cards.server";
import { decodeCursor, decodePollCursor, encodeCursor, encodePollCursor, type Cursor } from "./cursor";
import { canDeleteMessage, canEditMessage } from "./rules";
import { resolveThread, threadInfo, threadWhere, type ThreadAccess } from "./thread-access.server";
import { findOwnUpload } from "./uploads.server";
import { nextReadMarker } from "./unread";
import { parseEditBody, parseMessageBody } from "./validate";
import { buildMessageViews } from "./view.server";

/**
 * Thread messages: newest-first pages, polling (?after=) with edits/deletes,
 * idempotent sends, the 15-minute edit, delete-for-everyone, read markers.
 */

const PAGE = 30;
const MAX_PAGE = 100;
const MAX_POLL = 100;
const CLIENT_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const SEND_KINDS = new Set(["text", "image", "file", "product", "protocol"]);
const EMPTY_CURSOR: Cursor = { createdAt: new Date(0), id: "0" };

export type Outcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "not_found" }
  | { kind: "forbidden"; message: string }
  | { kind: "invalid"; message: string };

const NOT_FOUND = { kind: "not_found" } as const;
const invalid = (message: string) => ({ kind: "invalid", message }) as const;
const forbidden = (message: string) => ({ kind: "forbidden", message }) as const;

const after = (c: Cursor): Prisma.CommunityMessageWhereInput => ({
  OR: [{ createdAt: { gt: c.createdAt } }, { createdAt: c.createdAt, id: { gt: c.id } }],
});
const before = (c: Cursor): Prisma.CommunityMessageWhereInput => ({
  OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }],
});
const atOrBefore = (c: Cursor): Prisma.CommunityMessageWhereInput => ({
  OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lte: c.id } }],
});
const NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

export async function listMessages(
  actor: CommunityActor,
  type: ThreadType,
  id: string,
  params: URLSearchParams,
): Promise<Outcome<MessagesResponse>> {
  const now = new Date();
  const limit = Math.min(Math.max(Number(params.get("limit")) || PAGE, 1), MAX_PAGE);
  return withTenant(actor.tenantId, async (db): Promise<Outcome<MessagesResponse>> => {
    const access = await resolveThread(db, actor, type, id);
    if (!access) return NOT_FOUND;
    const where = threadWhere(access);
    const thread = threadInfo(actor, access);

    const rawAfter = params.get("after");
    if (rawAfter) {
      const poll = decodePollCursor(rawAfter);
      if (!poll) return invalid("Reload this chat.");
      const [fresh, changed] = await Promise.all([
        db.communityMessage.findMany({ where: { ...where, ...after(poll) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_POLL }),
        db.communityMessage.findMany({
          where: {
            ...where,
            AND: [atOrBefore(poll), { OR: [{ editedAt: { gt: poll.at } }, { deletedAt: { gt: poll.at } }] }],
          },
          orderBy: NEWEST_FIRST,
          take: MAX_POLL,
        }),
      ]);
      const newest = fresh.length ? fresh[fresh.length - 1] : poll;
      const views = await buildMessageViews(db, actor, [...fresh.reverse(), ...changed], now);
      return {
        kind: "ok",
        value: {
          thread,
          messages: views.slice(0, fresh.length),
          olderCursor: null,
          pollCursor: encodePollCursor({ createdAt: newest.createdAt, id: newest.id, at: now }),
          changed: views.slice(fresh.length),
        },
      };
    }

    const older = decodeCursor(params.get("before"));
    if (params.get("before") && !older) return invalid("Reload this chat.");
    const rows = await db.communityMessage.findMany({
      where: { ...where, ...(older ? before(older) : {}) },
      orderBy: NEWEST_FIRST,
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const newest = older ? null : (page[0] ?? EMPTY_CURSOR);
    return {
      kind: "ok",
      value: {
        thread,
        messages: await buildMessageViews(db, actor, page, now),
        olderCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
        // An older page doesn't move the poll position; the app keeps its own.
        pollCursor: encodePollCursor({ ...(newest ?? EMPTY_CURSOR), at: now }),
        changed: [],
      },
    };
  });
}

// ── send ─────────────────────────────────────────────────────────────────────

type Draft = Omit<Prisma.CommunityMessageUncheckedCreateInput, "tenantId" | "senderKey" | "authorKey" | "clientId" | "createdAt">;

async function buildDraft(
  db: TenantTx,
  actor: CommunityActor,
  access: ThreadAccess,
  body: Record<string, unknown>,
): Promise<{ ok: true; draft: Draft } | { ok: false; message: string }> {
  const kind = String(body.kind ?? "");
  if (!SEND_KINDS.has(kind)) return { ok: false, message: "That kind of message isn't supported." };
  const text = parseMessageBody(kind, body.body);
  if (!text.ok) return { ok: false, message: text.error };
  const draft: Draft = { ...threadWhere(access), kind, body: text.value };

  if (kind === "product") {
    const ref = { productId: String(body.productId ?? ""), variationId: body.variationId ? String(body.variationId) : null };
    const cards = await loadProductCards(db, actor.tenant, [ref]);
    if (!ref.productId || !cards.has(refKey(ref))) return { ok: false, message: "That product isn't available." };
    Object.assign(draft, ref);
  } else if (kind === "protocol") {
    const protocolId = String(body.protocolId ?? "");
    if (!loadProtocolCards(actor.tenant).has(protocolId)) return { ok: false, message: "That protocol isn't available." };
    draft.protocolId = protocolId;
  } else if (kind === "image" || kind === "file") {
    // Only this participant's own upload of this tenant, and every detail comes
    // from the upload record — never from the request body.
    const u = body.upload as Record<string, unknown> | undefined;
    const record = u && u.kind === kind ? await findOwnUpload(db, actor, u.url, kind) : null;
    if (!record) return { ok: false, message: "Upload the file again." };
    if (kind === "image") {
      Object.assign(draft, { imageUrl: record.url, imageWidth: record.width, imageHeight: record.height });
    } else {
      Object.assign(draft, { fileUrl: record.url, fileName: record.name, fileSize: record.size, fileMime: record.mime });
    }
  }

  if (body.replyToId !== undefined && body.replyToId !== null) {
    const quoted = await db.communityMessage.findFirst({
      where: { id: String(body.replyToId), ...threadWhere(access) },
      select: { id: true },
    });
    if (!quoted) return { ok: false, message: "The message you replied to is gone." };
    draft.replyToId = quoted.id;
  }
  return { ok: true, draft };
}

/** Write a message and bump the thread's counters in the SAME transaction. */
export async function insertMessage(
  db: TenantTx,
  actor: CommunityActor,
  access: { type: ThreadType; id: string },
  data: Draft & { clientId?: string | null },
  now: Date,
): Promise<MessageRow> {
  const row = await db.communityMessage.create({
    data: { ...data, tenantId: actor.tenantId, senderKey: actor.key, authorKey: actor.authorKey, createdAt: now },
  });
  const bump = { lastMessageAt: now, messageCount: { increment: 1 } };
  if (access.type === "topic") await db.communityTopic.updateMany({ where: { id: access.id }, data: bump });
  else await db.communityConversation.updateMany({ where: { id: access.id }, data: bump });
  return row;
}

export type SendResult = { message: CommunityMessage; created: boolean; access: ThreadAccess };

export async function sendMessage(
  actor: CommunityActor,
  type: ThreadType,
  id: string,
  body: Record<string, unknown>,
): Promise<Outcome<SendResult>> {
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  if (!CLIENT_ID_RE.test(clientId)) return invalid("Couldn't send that message. Try again.");
  const now = new Date();
  try {
    return await withTenant(actor.tenantId, async (db): Promise<Outcome<SendResult>> => {
      const access = await resolveThread(db, actor, type, id);
      if (!access) return NOT_FOUND;
      // Idempotent: the same clientId from the same sender is the same message.
      const existing = await db.communityMessage.findFirst({ where: { senderKey: actor.key, clientId } });
      if (existing) {
        const sameThread = type === "topic" ? existing.topicId === id : existing.conversationId === id;
        if (!sameThread) return invalid("Couldn't send that message. Try again.");
        const [message] = await buildMessageViews(db, actor, [existing], now);
        return { kind: "ok", value: { message, created: false, access } };
      }
      if (!access.canPost) return forbidden(access.postBlockedReason ?? "You can't post here.");
      const built = await buildDraft(db, actor, access, body);
      if (!built.ok) return invalid(built.message);
      const row = await insertMessage(db, actor, access, { ...built.draft, clientId }, now);
      const [message] = await buildMessageViews(db, actor, [row], now);
      return { kind: "ok", value: { message, created: true, access } };
    });
  } catch (e) {
    // Two racing retries of one clientId: the loser re-reads the winner.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return sendMessage(actor, type, id, body);
    }
    throw e;
  }
}

// ── edit / delete ────────────────────────────────────────────────────────────

async function loadOwnThread(db: TenantTx, actor: CommunityActor, messageId: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(messageId)) return null;
  const row = await db.communityMessage.findFirst({ where: { id: messageId } });
  if (!row) return null;
  const type: ThreadType = row.topicId ? "topic" : "dm";
  const access = await resolveThread(db, actor, type, row.topicId ?? row.conversationId ?? "");
  return access ? { row, access } : null;
}

export async function editMessage(actor: CommunityActor, messageId: string, body: unknown): Promise<Outcome<CommunityMessage>> {
  const text = parseEditBody(body);
  if (!text.ok) return invalid(text.error);
  const now = new Date();
  return withTenant(actor.tenantId, async (db): Promise<Outcome<CommunityMessage>> => {
    const found = await loadOwnThread(db, actor, messageId);
    if (!found) return NOT_FOUND;
    if (!canEditMessage(actor, found.row, now)) return forbidden("You can only edit your own messages for 15 minutes.");
    await db.communityMessage.updateMany({ where: { id: messageId }, data: { body: text.value, editedAt: now } });
    const fresh = await db.communityMessage.findFirst({ where: { id: messageId } });
    const [view] = await buildMessageViews(db, actor, [fresh!], now);
    return { kind: "ok", value: view };
  });
}

export async function deleteMessage(actor: CommunityActor, messageId: string): Promise<Outcome<CommunityMessage>> {
  const now = new Date();
  return withTenant(actor.tenantId, async (db): Promise<Outcome<CommunityMessage>> => {
    const found = await loadOwnThread(db, actor, messageId);
    if (!found) return NOT_FOUND;
    if (!canDeleteMessage(actor, found.row, found.access.type)) return forbidden("You can't delete this message.");
    await db.communityMessage.updateMany({ where: { id: messageId }, data: { deletedAt: now } });
    // Deleting a drop's announcement ends the drop too.
    if (found.row.dropId) {
      await db.communityDrop.updateMany({ where: { id: found.row.dropId }, data: { isActive: false, endedAt: now } });
    }
    const fresh = await db.communityMessage.findFirst({ where: { id: messageId } });
    const [view] = await buildMessageViews(db, actor, [fresh!], now);
    return { kind: "ok", value: view };
  });
}

// ── read markers ─────────────────────────────────────────────────────────────

export async function markRead(
  actor: CommunityActor,
  type: ThreadType,
  id: string,
  body: Record<string, unknown> | null,
): Promise<Outcome<{ lastReadAt: string }>> {
  const requested = new Date(typeof body?.at === "string" ? body.at : "");
  if (Number.isNaN(requested.getTime())) return invalid("Couldn't mark this chat as read.");
  const now = new Date();
  return withTenant(actor.tenantId, async (db): Promise<Outcome<{ lastReadAt: string }>> => {
    const access = await resolveThread(db, actor, type, id);
    if (!access) return NOT_FOUND;
    const key = { participantKey: actor.key, threadType: type, threadId: id };
    const current = await db.communityRead.findFirst({ where: key });
    const next = nextReadMarker(current?.lastReadAt ?? null, requested, now)!;
    if (!current) {
      await db.communityRead.upsert({
        where: { tenantId_participantKey_threadType_threadId: { tenantId: actor.tenantId, ...key } },
        create: { tenantId: actor.tenantId, ...key, lastReadAt: next },
        update: {},
      });
    } else if (next.getTime() !== current.lastReadAt.getTime()) {
      // Conditional: a racing older write can never pull the marker back.
      await db.communityRead.updateMany({ where: { ...key, lastReadAt: { lt: next } }, data: { lastReadAt: next } });
    }
    return { kind: "ok", value: { lastReadAt: next.toISOString() } };
  });
}
