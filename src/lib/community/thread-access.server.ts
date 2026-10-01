import "server-only";

import type { CommunityChannel, CommunityConversation, CommunityTopic } from "@prisma/client";
import type { TenantTx } from "@/lib/db/tenant-client";
import type { ThreadInfo, ThreadType } from "@/lib/mobile/contract";
import type { CommunityActor } from "./actor.server";
import { dmPeerOf } from "./keys";
import { loadParticipants, publicParticipant, type MemberCard } from "./participants.server";
import { canManageChannel, canManageTopic, canPostInChannel, postBlockedReason } from "./rules";

/**
 * Can this actor see this thread? Every thread read or write starts here.
 * Lookups run inside withTenant(), so another store's id simply isn't found;
 * a DM additionally requires the actor to be one of its two participants.
 */

export type ThreadAccess =
  | {
      type: "topic";
      id: string;
      topic: CommunityTopic;
      channel: CommunityChannel;
      canPost: boolean;
      postBlockedReason: string | null;
    }
  | {
      type: "dm";
      id: string;
      conversation: CommunityConversation;
      peer: MemberCard;
      canPost: boolean;
      postBlockedReason: string | null;
    };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function parseThreadType(raw: string): ThreadType | null {
  return raw === "topic" || raw === "dm" ? raw : null;
}

export async function resolveThread(
  db: TenantTx,
  actor: CommunityActor,
  type: ThreadType,
  id: string,
): Promise<ThreadAccess | null> {
  if (!ID_RE.test(id)) return null;
  if (type === "topic") {
    const topic = await db.communityTopic.findFirst({ where: { id }, include: { channel: true } });
    if (!topic) return null;
    const { channel, ...rest } = topic;
    return {
      type,
      id,
      topic: rest,
      channel,
      canPost: canPostInChannel(actor, channel.postRole),
      postBlockedReason: postBlockedReason(actor, channel.postRole),
    };
  }
  const conversation = await db.communityConversation.findFirst({ where: { id } });
  const peerKey = conversation ? dmPeerOf(conversation, actor.key) : null;
  if (!conversation || !peerKey) return null;
  const peer = (await loadParticipants(db, actor.tenant, [peerKey])).get(peerKey)!;
  const open = peer.isTeam || peer.status === "approved";
  return {
    type,
    id,
    conversation,
    peer,
    canPost: open,
    postBlockedReason: open ? null : "This member isn't in the community any more.",
  };
}

export function threadInfo(actor: CommunityActor, access: ThreadAccess): ThreadInfo {
  if (access.type === "topic") {
    const { topic, channel } = access;
    return {
      type: "topic",
      id: topic.id,
      title: topic.isGeneral ? channel.name : topic.name,
      subtitle: topic.isGeneral ? (channel.description ?? "General") : channel.name,
      emoji: topic.isGeneral ? channel.emoji : topic.emoji,
      imageUrl: topic.isGeneral ? channel.imageUrl : topic.imageUrl,
      peer: null,
      channelId: channel.id,
      canPost: access.canPost,
      postBlockedReason: access.postBlockedReason,
      canManage: canManageTopic(actor) || canManageChannel(actor),
    };
  }
  return {
    type: "dm",
    id: access.id,
    title: access.peer.name,
    subtitle: access.peer.isTeam ? "Store team" : "Member",
    emoji: null,
    imageUrl: access.peer.imageUrl,
    peer: publicParticipant(access.peer),
    channelId: null,
    canPost: access.canPost,
    postBlockedReason: access.postBlockedReason,
    canManage: false,
  };
}

/** Where a message lives, as a thread-scoped filter. */
export function threadWhere(access: { type: ThreadType; id: string }) {
  return access.type === "topic" ? { topicId: access.id } : { conversationId: access.id };
}
