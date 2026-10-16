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
}
