// Community permission rules — the ONE place that decides who may post,
// manage, edit, delete or open a DM. Every route applies these server-side and
// sends the results to the app as canPost / canEdit / canDelete flags, so the
// app never re-derives them. Pure (npm run test:community-core).

import { HUB_ON_HAND_ONLY, isHub } from "./hub";
import { STORE_KEY } from "./keys";
import { MUTED_REASON } from "./moderation";
import { PREVIEW_LOCKED_MESSAGE, channelPreviewAccess, type PreviewPolicy } from "./preview";

export const EDIT_WINDOW_MS = 15 * 60 * 1000;

export type RuleActor = {
  /** Participant key: `store` or `c:<id>`. */
  key: string;
  /**
   * May moderate the community: the store team, or a customer the team made a
   * community admin (channels, topics, deleting messages, reviewing members).
   */
  isModerator: boolean;
  /**
   * The store team itself (owner, or staff holding the `community` module).
   * Store-only tools — drops, broadcasts, saved replies, join mode, welcome,
   * the safety queue, sanctions, resellers, admin roles — check this, never
   * isModerator. Missing = not the team.
   */
  isTeam?: boolean;
  /** Team only: `owner` | `s:<staffId>`. */
  authorKey: string | null;
  /** Customers the team marked as verified resellers (they post in a hub's On hand). */
  isVerifiedReseller?: boolean;
  /** Muted by the safety bot or the team: reads everything, posts nothing. */
  isMuted?: boolean;
  /**
   * Set for a customer browsing in preview (not approved yet, the store's
   * preview on): the store's rules for them. Missing/null = a full member.
   */
  preview?: PreviewPolicy | null;
};

export type PostRole = "everyone" | "admins";

/**
 * Who can SEE a channel. "everyone": every member. "hub": the Verified
 * Resellers Hub — every member sees it too; its topics decide who posts (see
 * canPostInTopic). Anything else — including the retired "resellers" — fails
 * closed for members; the team still sees it so they can convert it.
 */
export type Audience = "everyone" | "hub";

export const AUDIENCES: readonly Audience[] = ["everyone", "hub"];

export function isAudience(v: unknown): v is Audience {
  return typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);
}

/** The channel fields visibility reads. previewAccess missing = the default (locked). */
export type SeenChannel = { audience: Audience | string; previewAccess?: string | null };

/**
 * Who can READ a channel. Hidden channels are not found at all — their topics,
 * messages and drops included. In preview only channels set to read or chat open.
 */
export function canSeeChannel(actor: RuleActor, channel: SeenChannel): boolean {
  if (actor.isModerator) return true;
  if (!isAudience(channel.audience)) return false;
  if (!actor.preview) return true;
  const access = channelPreviewAccess(channel.previewAccess);
  return access === "read" || access === "chat";
}

/** Who sees the channel in their list: readers, plus — in preview — its "locked" row. */
export function canListChannel(actor: RuleActor, channel: SeenChannel): boolean {
  if (canSeeChannel(actor, channel)) return true;
  return !!actor.preview && isAudience(channel.audience) && channelPreviewAccess(channel.previewAccess) === "locked";
}

/** Listed for this reader but not open to them (preview's "locked"). */
export function isChannelLocked(actor: RuleActor, channel: SeenChannel): boolean {
  return canListChannel(actor, channel) && !canSeeChannel(actor, channel);
}

export type RuleMessage = {
  senderKey: string;
  authorKey: string | null;
  kind: string;
  createdAt: Date;
  deletedAt: Date | null;
};

const EDITABLE_KINDS = new Set(["text", "image", "file"]);
const ADMINS_ONLY = "Only the store team posts here.";

export function canPostInChannel(actor: RuleActor, postRole: PostRole | string): boolean {
  if (actor.isModerator) return true;
  return !actor.isMuted && postRole === "everyone";
}

export function postBlockedReason(actor: RuleActor, postRole: PostRole | string): string | null {
  if (canPostInChannel(actor, postRole)) return null;
  return actor.isMuted ? MUTED_REASON : ADMINS_ONLY;
}

type ChannelRule = { postRole: PostRole | string; audience: Audience | string; previewAccess?: string | null };

/** In preview, posting needs the channel set to "chat" — then the channel's own rules apply. */
function previewPostBlocked(actor: RuleActor, channel: ChannelRule): string | null {
  if (!actor.preview || actor.isModerator) return null;
  return channelPreviewAccess(channel.previewAccess) === "chat" ? null : PREVIEW_LOCKED_MESSAGE;
}

/**
 * Posting in one topic. Usually the channel's rule. In a hub, the General topic
 * ("On hand") is for verified resellers + moderators, every other topic
 * ("Looking for") is for every member. Muted members post nowhere.
 */
export function topicPostBlockedReason(actor: RuleActor, channel: ChannelRule, topic: { isGeneral: boolean }): string | null {
  const preview = previewPostBlocked(actor, channel);
  if (preview) return preview;
  if (!isHub(channel)) return postBlockedReason(actor, channel.postRole);
  if (actor.isModerator) return null;
  if (actor.isMuted) return MUTED_REASON;
  return topic.isGeneral && actor.isVerifiedReseller !== true ? HUB_ON_HAND_ONLY : null;
}

export function canPostInTopic(actor: RuleActor, channel: ChannelRule, topic: { isGeneral: boolean }): boolean {
  return topicPostBlockedReason(actor, channel, topic) === null;
}

/**
 * Starting a topic: whoever may post in the channel — but a hub's topics are
 * set by moderators, and people in preview reply only (never start topics).
 */
export function canAddTopic(actor: RuleActor, channel: ChannelRule): boolean {
  if (actor.preview && !actor.isModerator) return false;
  return isHub(channel) ? actor.isModerator : canPostInChannel(actor, channel.postRole);
}

/**
 * DMs: open while the peer is still in, and never for a muted member. In
 * preview the only DM is the store's, and only while the store allows it.
 */
export function dmPostBlockedReason(actor: RuleActor, peer: { key: string; open: boolean }): string | null {
  if (!peer.open) return "This member isn't in the community any more.";
  if (actor.preview && !actor.isModerator && !(peer.key === STORE_KEY && actor.preview.messageStore)) {
    return PREVIEW_LOCKED_MESSAGE;
  }
  return !actor.isModerator && actor.isMuted ? MUTED_REASON : null;
}

/** Channels: create / edit / delete. */
export function canManageChannel(actor: RuleActor): boolean {
  return actor.isModerator;
}

/** Topics: rename / pin / picture. (Creating one follows canPostInChannel.) */
export function canManageTopic(actor: RuleActor): boolean {
  return actor.isModerator;
}

/** A channel's General topic is its spine and is never deleted. */
export function canDeleteTopic(actor: RuleActor, topic: { isGeneral: boolean }): boolean {
  return actor.isModerator && !topic.isGeneral;
}

/**
 * The message is this person's own words. Customers own by key; the team shares
 * the `store` key, so ownership there is by author — one staffer can't rewrite
 * what the owner said.
 */
export function isOwnMessage(actor: RuleActor, m: { senderKey: string; authorKey: string | null }): boolean {
  if (m.senderKey !== actor.key) return false;
  return actor.key !== STORE_KEY || (m.authorKey !== null && m.authorKey === actor.authorKey);
}

/** Own text or caption, within 15 minutes. Drops, cards and system lines never. */
export function canEditMessage(actor: RuleActor, m: RuleMessage, now: Date): boolean {
  if (m.deletedAt) return false;
  if (!EDITABLE_KINDS.has(m.kind)) return false;
  if (!isOwnMessage(actor, m)) return false;
  return now.getTime() - m.createdAt.getTime() <= EDIT_WINDOW_MS;
}

/**
 * Delete for everyone: the sender (the team counts as one sender in DMs, since
 * it's one shared inbox), or a moderator anywhere in a topic — except that a
 * community admin never deletes what the store posted (that would end a drop).
 * In DMs the store can't delete what a customer wrote. System lines are permanent.
 */
export function canDeleteMessage(actor: RuleActor, m: RuleMessage, threadType: "topic" | "dm"): boolean {
  if (m.deletedAt || m.kind === "system") return false;
  if (m.senderKey === actor.key) return true;
  if (threadType !== "topic" || !actor.isModerator) return false;
  return actor.isTeam === true || m.senderKey !== STORE_KEY;
}

/**
 * Who may open a DM with whom. Customers: the store, or another approved
 * member. The store: any approved member. Null = allowed.
 */
export function dmBlockedReason(opener: RuleActor, peer: { key: string; approved: boolean }): string | null {
  if (peer.key === opener.key) return "You can't message yourself.";
  // In preview: the store only, and only while the store allows it.
  if (opener.preview && !opener.isModerator) {
    return peer.key === STORE_KEY && opener.preview.messageStore ? null : PREVIEW_LOCKED_MESSAGE;
  }
  if (peer.key === STORE_KEY) return null;
  return peer.approved ? null : "That member isn't in the community.";
}
