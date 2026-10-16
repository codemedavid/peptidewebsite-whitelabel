// The open thread's cache, and every way it changes: first page, older pages,
// 3-second polls (new + changed), and optimistic sends. Pure and immutable, so
// the merge rules are unit-tested (scripts/test-community-lib.ts).
import type { CommunityMessage, GroupBuyCard, MessagesResponse, Participant, ProductCard, ProtocolCard, ThreadInfo, ThreadType } from "@contract";

/** A message as the app holds it: server rows, plus our own not-yet-confirmed sends. */
export type LocalMessage = CommunityMessage & {
  /** Our client id, on optimistic messages (and on server rows when the server echoes it). */
  clientId: string | null;
  /** Sent, waiting for the server — shows the clock icon. */
  pending?: boolean;
  /** A photo/file still uploading — the bubble shows the local file. */
  localUri?: string;
};

export type ThreadState = {
  thread: ThreadInfo;
  /** Newest first. */
  messages: LocalMessage[];
  olderCursor: string | null;
  pollCursor: string;
};

/** Pending sends sit above everything; the rest newest first. */
function sortNewestFirst(messages: LocalMessage[]): LocalMessage[] {
  return [...messages].sort((a, b) => {
    if (!!a.pending !== !!b.pending) return a.pending ? -1 : 1;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}


/**
 * Does this server message confirm that optimistic one? By clientId when the
 * server echoes it; otherwise one of mine with the same kind and text.
 */
export function confirms(server: CommunityMessage, local: LocalMessage): boolean {
  if (!local.pending) return false;
  // Older servers didn't echo clientId; fall back to "mine + same content".
  if (server.clientId) return server.clientId === local.clientId;
  return server.mine && server.kind === local.kind && (server.body ?? "") === (local.body ?? "");
}

export function fromFirstPage(res: MessagesResponse): ThreadState {
  return { thread: res.thread, messages: sortNewestFirst(res.messages), olderCursor: res.olderCursor, pollCursor: res.pollCursor };
}

/** Insert or replace server messages by id, dropping any pending send they confirm. */
function upsert(messages: LocalMessage[], incoming: CommunityMessage[]): LocalMessage[] {
  let next = messages;
  for (const server of incoming) {
    const at = next.findIndex((m) => m.id === server.id);
    if (at >= 0) {
      next = next.map((m, i) => (i === at ? { ...server, clientId: server.clientId ?? m.clientId } : m));
      continue;
    }
    const pendingAt = next.findIndex((m) => confirms(server, m));
    const kept = pendingAt >= 0 ? next.filter((_, i) => i !== pendingAt) : next;
    const clientId = server.clientId ?? (pendingAt >= 0 ? next[pendingAt].clientId : null);
    next = [{ ...server, clientId }, ...kept];
  }
  return next;
}

/** A poll (`?after=`) result: new messages plus edits/deletes since the cursor. */
export function mergePoll(state: ThreadState, res: MessagesResponse): ThreadState {
  const changed = res.changed.filter((c) => state.messages.some((m) => m.id === c.id));
  const merged = upsert(upsert(state.messages, res.messages), changed);
  return { ...state, thread: res.thread, messages: sortNewestFirst(merged), pollCursor: res.pollCursor };
}

/** An older page (`?before=`), appended below what's loaded. */
export function appendOlder(state: ThreadState, res: MessagesResponse): ThreadState {
  const seen = new Set(state.messages.map((m) => m.id));
  const older = res.messages.filter((m) => !seen.has(m.id));
  return { ...state, messages: sortNewestFirst([...state.messages, ...older]), olderCursor: res.olderCursor };
}

export function addOptimistic(state: ThreadState, message: LocalMessage): ThreadState {
  return { ...state, messages: sortNewestFirst([message, ...state.messages]) };
}

/** Patch an optimistic message (e.g. the upload finished). */
export function patchOptimistic(state: ThreadState, clientId: string, patch: Partial<LocalMessage>): ThreadState {
  return { ...state, messages: state.messages.map((m) => (m.pending && m.clientId === clientId ? { ...m, ...patch } : m)) };
}

/** The POST came back: swap the optimistic copy for the real one (a poll may have beaten it). */
export function resolveOptimistic(state: ThreadState, clientId: string, server: CommunityMessage): ThreadState {
  const without = state.messages.filter((m) => !(m.pending && m.clientId === clientId));
  if (without.some((m) => m.id === server.id)) return { ...state, messages: without };
  return { ...state, messages: sortNewestFirst([{ ...server, clientId: server.clientId ?? clientId }, ...without]) };
}

export function removeOptimistic(state: ThreadState, clientId: string): ThreadState {
  return { ...state, messages: state.messages.filter((m) => !(m.pending && m.clientId === clientId)) };
}

/** An edit or delete we made: replace that message by id. */
export function replaceMessage(state: ThreadState, message: CommunityMessage): ThreadState {
  return { ...state, messages: state.messages.map((m) => (m.id === message.id ? { ...message, clientId: message.clientId ?? m.clientId } : m)) };
}

/** Delete shown at once, before the server confirms. */
export function markDeleted(state: ThreadState, id: string, at: string): ThreadState {
  return {
    ...state,
    messages: state.messages.map((m) => (m.id === id ? { ...m, deletedAt: at, body: null, canEdit: false, canDelete: false } : m)),
  };
}

export function newClientId(now = Date.now(), random = Math.random): string {
  return `c${now.toString(36)}${random().toString(36).slice(2, 10)}`;
}

/** The newest confirmed message — what "mark read" reports. */
export function newestConfirmed(messages: LocalMessage[]): LocalMessage | null {
  return messages.find((m) => !m.pending) ?? null;
}

export type OptimisticInput = {
  clientId: string;
  threadType: ThreadType;
  threadId: string;
  sender: Participant | null;
  body: string | null;
  now: string;
  replyTo: CommunityMessage | null;
  product?: ProductCard | null;
  protocol?: ProtocolCard | null;
  groupBuy?: GroupBuyCard | null;
  image?: { uri: string; width: number | null; height: number | null } | null;
  file?: { uri: string; name: string; size: number | null; mime: string } | null;
};

/** The bubble shown the instant the member taps send. */
export function makeOptimistic(input: OptimisticInput): LocalMessage {
  const kind = input.image
    ? "image"
    : input.file
      ? "file"
      : input.product
        ? "product"
        : input.protocol
          ? "protocol"
          : input.groupBuy
            ? "groupbuy"
            : "text";
  return {
    id: `local-${input.clientId}`,
    clientId: input.clientId,
    pending: true,
    localUri: input.image?.uri ?? input.file?.uri,
    threadId: input.threadId,
    threadType: input.threadType,
    sender: input.sender,
    authorName: null,
    mine: true,
    kind,
    body: input.body,
    product: input.product ?? null,
    protocol: input.protocol ?? null,
    image: input.image ? { url: input.image.uri, width: input.image.width ?? 0, height: input.image.height ?? 0 } : null,
    video: null,
    file: input.file ? { url: "", name: input.file.name, size: input.file.size ?? 0, mime: input.file.mime } : null,
    drop: null,
    order: null,
    groupBuy: input.groupBuy ?? null,
    replyTo: input.replyTo
      ? {
          id: input.replyTo.id,
          senderName: input.replyTo.sender?.name ?? "Message",
          senderHue: input.replyTo.sender?.avatarHue ?? null,
          senderIsTeam: input.replyTo.sender?.isTeam ?? false,
          text: input.replyTo.body ?? "",
        }
      : null,
    createdAt: input.now,
    editedAt: null,
    deletedAt: null,
    canEdit: false,
    canDelete: false,
  };
}

/**
 * A send failed after the composer was already cleared: put the text back,
 * unless the person has started typing something new since.
 */
export function restoreDraft(current: string, failed: string): string {
  return current.trim() ? current : failed;
}
