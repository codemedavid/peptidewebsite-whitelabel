// Access-rule cases for scripts/test-community-lib.ts.
import assert from "node:assert/strict";
import type { CommunityMe, Membership } from "../../src/lib/mobile/contract";
import { communityAccess } from "../src/features/community/lib/access";

const community = (membership: Membership, over: Partial<CommunityMe> = {}): CommunityMe => ({
  enabled: true,
  membership,
  rejectionReason: null,
  isModerator: membership === "moderator",
  myKey: null,
  profile: null,
  pendingApplications: 0,
  joinMode: "open",
  ...over,
});

export function access() {
  const approved = communityAccess({ mode: "customer", community: community("approved") });
  assert.equal(approved.customerChatsTab, true);
  assert.equal(approved.adminChatsTab, false);
  assert.equal(approved.membershipCard, null);
  assert.equal(approved.inCommunity, true);

  for (const m of ["pending", "rejected", "revoked"] as const) {
    const a = communityAccess({ mode: "customer", community: community(m) });
    assert.equal(a.customerChatsTab, false, m);
    assert.equal(a.membershipCard, m);
    assert.equal(a.inCommunity, false);
  }
  const off = communityAccess({ mode: "customer", community: community("approved", { enabled: false }) });
  assert.equal(off.membershipCard, "none");
  assert.equal(off.customerChatsTab, false);

  const mod = communityAccess({ mode: "admin", community: community("moderator") });
  assert.equal(mod.adminChatsTab, true);
  assert.equal(mod.membershipCard, null);
  const staffNoModule = communityAccess({ mode: "admin", community: community("none") });
  assert.equal(staffNoModule.adminChatsTab, false);
  const disabledStore = communityAccess({ mode: "admin", community: community("moderator", { enabled: false }) });
  assert.equal(disabledStore.adminChatsTab, false);
  assert.equal(mod.runsCommunity, true);
  assert.equal(mod.communityAdmin, false);

  // Community admins: approved customers the team promoted.
  const admin = communityAccess({ mode: "customer", community: community("approved", { isAdmin: true }) });
  assert.equal(admin.communityAdmin, true);
  assert.equal(admin.runsCommunity, true);
  assert.equal(admin.moderator, false, "store-team tools stay hidden");
  assert.equal(admin.customerChatsTab, true);
  assert.equal(approved.runsCommunity, false);
  assert.equal(approved.communityAdmin, false, "older servers omit isAdmin");
  const revokedAdmin = communityAccess({ mode: "customer", community: community("revoked", { isAdmin: true }) });
  assert.equal(revokedAdmin.runsCommunity, false);

  // Guests (Continue as guest): Chats shows the sign-up lock, never the chats.
  const guestActor = { kind: "customer" as const, displayName: "Guest", email: "", guest: true };
  const guest = communityAccess({ mode: "customer", actor: guestActor, community: community("none") });
  assert.equal(guest.guest, true);
  assert.equal(guest.guestLocked, true);
  assert.equal(guest.customerChatsTab, true, "the tab shows, locked");
  assert.equal(guest.inCommunity, false, "no inbox polling, no threads");
  assert.equal(guest.membershipCard, null, "Me shows the guest screen, not a membership card");
  const guestNoCommunity = communityAccess({ mode: "customer", actor: guestActor, community: community("none", { enabled: false }) });
  assert.equal(guestNoCommunity.guestLocked, false);
  assert.equal(guestNoCommunity.customerChatsTab, false, "no community = no Chats tab at all");
  assert.equal(approved.guest, false);
}
