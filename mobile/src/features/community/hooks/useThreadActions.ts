import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CommunityMessage, Participant, SendMessageRequest, ThreadType, UploadResponse } from "@contract";
import { ApiError } from "@/api/client";
import { communityApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import type { Attachment } from "../lib/attachments";
import {
  addOptimistic,
  makeOptimistic,
  markDeleted,
  newClientId,
  removeOptimistic,
  replaceMessage,
  resolveOptimistic,
  type ThreadState,
} from "../lib/messages";
import { uploadDraft } from "./usePickers";
import { useThreadKey } from "./useThread";

const messageOf = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/** Who I appear as in this community (the store team posts as the store). */
export function useMyParticipant(): Participant {
  const { me } = useSignedIn();
  const c = me.community;
  const team = me.mode === "admin";
  const key = c.myKey ?? "me";
  const name = team ? me.store.name : (c.profile?.displayName ?? me.actor.displayName);
  const avatarHue = c.profile?.avatarHue ?? 0;
  const imageUrl = team ? me.theme.logoUrl : null;
  return useMemo(() => ({ key, name, avatarHue, imageUrl, isTeam: team }), [key, name, avatarHue, imageUrl, team]);
}

type SendInput = { body: string; attachment: Attachment | null; replyTo: CommunityMessage | null };

/** Send (optimistic, with uploads), edit, delete, end a drop — all against the thread cache. */
export function useThreadActions(type: ThreadType, id: string) {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const key = useThreadKey(type, id);
  const me = useMyParticipant();
  // Uploads still running when the thread closes are cancelled (cheap to redo, heavy to finish).
  const uploads = useRef(new Set<AbortController>());
  useEffect(() => {
    const running = uploads.current;
    return () => running.forEach((c) => c.abort());
  }, []);

  const write = useCallback(
    (fn: (s: ThreadState) => ThreadState) => qc.setQueryData<ThreadState>(key, (s) => (s ? fn(s) : s)),
    [qc, key],
  );
  const refreshInbox = useCallback(() => void qc.invalidateQueries({ queryKey: qk.communityInbox(scope) }), [qc, scope]);

  /** Resolves to an error message, or null once the server has the message. */
  const send = useCallback(
    async ({ body, attachment, replyTo }: SendInput): Promise<string | null> => {
      const text = body.trim() || null;
      if (!text && !attachment) return null;
      const clientId = newClientId();
      const image = attachment?.type === "image" ? attachment : null;
      const file = attachment?.type === "file" ? attachment : null;
      write((s) =>
        addOptimistic(
          s,
          makeOptimistic({
            clientId,
            threadType: type,
            threadId: id,
            sender: me,
            body: text,
            now: new Date().toISOString(),
            replyTo,
            product: attachment?.type === "product" ? attachment.product : null,
            protocol: attachment?.type === "protocol" ? attachment.protocol : null,
            image: image ? { uri: image.uri, width: image.width, height: image.height } : null,
            file: file ? { uri: file.uri, name: file.name, size: file.size, mime: file.mimeType } : null,
          }),
        ),
      );
      try {
        let upload: UploadResponse | undefined;
        if (image || file) {
          const controller = new AbortController();
          uploads.current.add(controller);
          try {
            upload = await uploadDraft((image ?? file)!, controller.signal);
          } finally {
            uploads.current.delete(controller);
          }
        }
        const request: SendMessageRequest = {
          clientId,
          kind: attachment ? attachment.type : "text",
          ...(text ? { body: text } : {}),
          ...(attachment?.type === "product"
            ? { productId: attachment.product.id, ...(attachment.product.variationId ? { variationId: attachment.product.variationId } : {}) }
            : {}),
          ...(attachment?.type === "protocol" ? { protocolId: attachment.protocol.id } : {}),
          ...(upload ? { upload } : {}),
          ...(replyTo ? { replyToId: replyTo.id } : {}),
        };
        const server = await communityApi.send(type, id, request);
        write((s) => resolveOptimistic(s, clientId, server));
        refreshInbox();
        return null;
      } catch (e) {
        write((s) => removeOptimistic(s, clientId));
        // Cancelled because the person left the chat — nothing to report.
        if (e instanceof ApiError && e.code === "aborted") return null;
        return messageOf(e, "Your message wasn't sent. Try again.");
      }
    },
    [write, type, id, me, refreshInbox],
  );

  const edit = useCallback(
    async (message: CommunityMessage, body: string): Promise<string | null> => {
      try {
        const saved = await communityApi.editMessage(message.id, { body });
        write((s) => replaceMessage(s, saved));
        return null;
      } catch (e) {
        return messageOf(e, "The edit wasn't saved.");
      }
    },
    [write],
  );

  const remove = useCallback(
    async (message: CommunityMessage): Promise<string | null> => {
      write((s) => markDeleted(s, message.id, new Date().toISOString()));
      try {
        const saved = await communityApi.deleteMessage(message.id);
        write((s) => replaceMessage(s, saved));
        refreshInbox();
        return null;
      } catch (e) {
        write((s) => replaceMessage(s, message)); // roll back
        return messageOf(e, "The message wasn't deleted.");
      }
    },
    [write, refreshInbox],
  );

  const endDrop = useCallback(
    async (dropId: string): Promise<string | null> => {
      try {
        await communityApi.endDrop(dropId);
        write((s) => ({
          ...s,
          messages: s.messages.map((m) => (m.drop?.id === dropId ? { ...m, drop: { ...m.drop, isActive: false } } : m)),
        }));
        void qc.invalidateQueries({ queryKey: qk.communityDrops(scope) });
        refreshInbox();
        return null;
      } catch (e) {
        return messageOf(e, "The drop wasn't ended.");
      }
    },
    [write, qc, scope, refreshInbox],
  );

  return { send, edit, remove, endDrop };
}
