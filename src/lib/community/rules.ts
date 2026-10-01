// Community permission rules — the ONE place that decides who may post,
// manage, edit, delete or open a DM. Every route applies these server-side and
// sends the results to the app as canPost / canEdit / canDelete flags, so the
// app never re-derives them. Pure (npm run test:community-core).

import { STORE_KEY } from "./keys";

export const EDIT_WINDOW_MS = 15 * 60 * 1000;

export type RuleActor = {
  /** Participant key: `store` or `c:<id>`. */
  key: string;
  /** Owner, or staff holding the `community` module. */
  isModerator: boolean;
  /** Team only: `owner` | `s:<staffId>`. */
  authorKey: string | null;
};

export type PostRole = "everyone" | "admins";

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
  return actor.isModerator || postRole === "everyone";
}

export function postBlockedReason(actor: RuleActor, postRole: PostRole | string): string | null {
  return canPostInChannel(actor, postRole) ? null : ADMINS_ONLY;
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
 * it's one shared inbox), or a moderator anywhere in a topic. In DMs the store
 * can't delete what a customer wrote. System lines are permanent.
 */
export function canDeleteMessage(actor: RuleActor, m: RuleMessage, threadType: "topic" | "dm"): boolean {
  if (m.deletedAt || m.kind === "system") return false;
  if (m.senderKey === actor.key) return true;
  return threadType === "topic" && actor.isModerator;
}

/**
 * Who may open a DM with whom. Customers: the store, or another approved
 * member. The store: any approved member. Null = allowed.
 */
export function dmBlockedReason(opener: RuleActor, peer: { key: string; approved: boolean }): string | null {
  if (peer.key === opener.key) return "You can't message yourself.";
  if (peer.key === STORE_KEY) return null;
  return peer.approved ? null : "That member isn't in the community.";
}
