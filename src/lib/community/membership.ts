// Membership state as the app sees it (CommunityMe.membership). Pure.

import type { JoinMode, Membership, MemberStatus } from "../mobile/contract";

export type { JoinMode };

export const MEMBER_STATUSES: readonly MemberStatus[] = ["pending", "approved", "rejected", "revoked"];

export function isMemberStatus(v: unknown): v is MemberStatus {
  return typeof v === "string" && (MEMBER_STATUSES as readonly string[]).includes(v);
}

export function membershipFor(args: { enabled: boolean; isModerator: boolean; status: string | null }): Membership {
  if (!args.enabled) return "none";
  if (args.isModerator) return "moderator";
  return isMemberStatus(args.status) ? args.status : "pending";
}

/**
 * Who gets into the store's community (branding.config.communityJoin):
 *   - "open"     — every signed-in customer can read and message right away;
 *   - "approval" — first sign-in files a pending application the owner reviews.
 * Anything but an explicit "approval" is open.
 */
export function communityJoinMode(config: unknown): JoinMode {
  const c = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  return c.communityJoin === "approval" ? "approval" : "open";
}

export function isJoinMode(v: unknown): v is JoinMode {
  return v === "open" || v === "approval";
}
