// Who sees what: the tab sets and community screens, from /me.
import type { CommunityMe, MeResponse } from "@contract";

export type MembershipCard = "none" | "pending" | "rejected" | "revoked";

export type CommunityAccess = {
  /** May open chats at all (approved member, or a moderator). */
  inCommunity: boolean;
  /** The store team (owner, or staff with the community module). */
  moderator: boolean;
  /** A member the store team made a community admin. */
  communityAdmin: boolean;
  /** Creates channels and reviews members: the team or a community admin. */
  runsCommunity: boolean;
  /** Admin app: show the Chats tab. */
  adminChatsTab: boolean;
  /** Customer app: show the Chats tab. */
  customerChatsTab: boolean;
  /** Customer app: the Me tab shows this membership card instead of the profile. */
  membershipCard: MembershipCard | null;
  /** Customer app: shopping as a guest (no account yet). */
  guest: boolean;
  /** Guest of a store with a community: Chats shows the sign-up lock, nothing else. */
  guestLocked: boolean;
};

/** What an older server (no `community` in /me) means: the community is off. */
const COMMUNITY_OFF: CommunityMe = {
  enabled: false,
  membership: "none",
  rejectionReason: null,
  isModerator: false,
  myKey: null,
  profile: null,
  pendingApplications: 0,
  // Servers without join modes reviewed every member.
  joinMode: "approval",
};

export function communityAccess(
  me: Partial<Pick<MeResponse, "mode" | "actor">> & { community?: CommunityMe | null },
): CommunityAccess {
  const c = me.community ?? COMMUNITY_OFF;
  // A guest of a store WITH a community sees the Chats tab, locked behind sign-up.
  const guest = me.mode === "customer" && me.actor?.kind === "customer" && me.actor.guest === true;
  const guestLocked = guest && c.enabled;
  const moderator = c.enabled && c.isModerator;
  const approved = c.enabled && c.membership === "approved";
  const inCommunity = approved || moderator;
  const communityAdmin = approved && c.isAdmin === true;
  let membershipCard: MembershipCard | null = null;
  if (me.mode === "customer" && !approved && !guest) {
    const m = c.membership;
    membershipCard = c.enabled && (m === "pending" || m === "rejected" || m === "revoked") ? m : "none";
  }
  return {
    inCommunity,
    moderator,
    communityAdmin,
    runsCommunity: moderator || communityAdmin,
    adminChatsTab: me.mode === "admin" && moderator,
    customerChatsTab: me.mode === "customer" && (approved || guestLocked),
    membershipCard,
    guest,
    guestLocked,
  };
}
