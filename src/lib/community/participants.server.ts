import "server-only";

import type { TenantTx } from "@/lib/db/tenant-client";
import type { TenantContext } from "@/lib/tenant/context";
import { storeDisplayName, storeLogoUrl } from "@/lib/mobile/store-name";
import type { Participant } from "@/lib/mobile/contract";
import { profileSubject, shownName } from "@/lib/mobile/account-profile";
import { STORE_KEY, avatarHue, customerKey, parseParticipantKey } from "./keys";
import { isActiveAdmin } from "./membership";

/**
 * Participant cards for a set of keys, loaded in ONE query (never per row).
 * The store is its own card (store name + logo, team badge); a customer is
 * their nickname (else community display name) and profile photo, with an
 * admin badge while they are a community admin and a VR badge while they are a
 * verified reseller. A key whose member row is gone renders as a
 * neutral "Former member" rather than failing the whole thread.
 */

export type MemberCard = Participant & { status: string; bio: string; memberSince: Date | null };

export function storeParticipant(tenant: TenantContext): Participant {
  return {
    key: STORE_KEY,
    name: storeDisplayName(tenant),
    avatarHue: avatarHue(STORE_KEY),
    imageUrl: storeLogoUrl(tenant),
    isTeam: true,
  };
}

function formerMember(key: string): MemberCard {
  return { key, name: "Former member", avatarHue: avatarHue(key), imageUrl: null, isTeam: false, status: "revoked", bio: "", memberSince: null };
}

export async function loadParticipants(
  db: TenantTx,
  tenant: TenantContext,
  keys: Iterable<string>,
): Promise<Map<string, MemberCard>> {
  const out = new Map<string, MemberCard>();
  const customerIds = new Set<string>();
  for (const key of keys) {
    const ref = parseParticipantKey(key);
    if (ref?.kind === "customer") customerIds.add(ref.id);
    else if (ref?.kind === "store") out.set(STORE_KEY, { ...storeParticipant(tenant), status: "approved", bio: "", memberSince: null });
  }
  if (customerIds.size > 0) {
    const rows = await db.communityMember.findMany({
      where: { customerId: { in: [...customerIds] } },
      select: { customerId: true, displayName: true, avatarHue: true, status: true, bio: true, reviewedAt: true, isAdmin: true, mutedAt: true, verifiedReseller: true },
    });
    // Personal profiles (nickname + photo) for the same customers, in one more query.
    const profiles = await db.accountProfile.findMany({
      where: { subject: { in: [...customerIds].map((id) => profileSubject({ kind: "customer", id })) } },
      select: { subject: true, nickname: true, avatarUrl: true },
    });
    const profileBySubject = new Map(profiles.map((p) => [p.subject, p]));
    for (const r of rows) {
      const key = customerKey(r.customerId);
      const profile = profileBySubject.get(profileSubject({ kind: "customer", id: r.customerId })) ?? null;
      out.set(key, {
        key,
        name: shownName(profile && { name: r.displayName, nickname: profile.nickname }, r.displayName),
        avatarHue: r.avatarHue,
        imageUrl: profile?.avatarUrl ?? null,
        isTeam: false,
        isAdmin: isActiveAdmin(r),
        isVerifiedReseller: r.verifiedReseller && r.status === "approved",
        status: r.status,
        bio: r.bio,
        memberSince: r.status === "approved" ? r.reviewedAt : null,
      });
    }
    for (const id of customerIds) {
      const key = customerKey(id);
      if (!out.has(key)) out.set(key, formerMember(key));
    }
  }
  return out;
}

export function publicParticipant(card: MemberCard): Participant {
  return { key: card.key, name: card.name, avatarHue: card.avatarHue, imageUrl: card.imageUrl, isTeam: card.isTeam, isAdmin: card.isAdmin === true, isVerifiedReseller: card.isVerifiedReseller === true };
}
