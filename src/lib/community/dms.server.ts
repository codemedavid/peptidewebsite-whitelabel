import "server-only";

import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db/tenant-client";
import type { OpenDmResponse } from "@/lib/mobile/contract";
import type { CommunityActor } from "./actor.server";
import { dmPair, parseParticipantKey } from "./keys";
import type { Outcome } from "./messages.server";
import { loadParticipants } from "./participants.server";
import { dmBlockedReason } from "./rules";

/**
 * POST /community/dms {peerKey} — open-or-create the one conversation between
 * two participants. Customers can reach the store and approved members; the
 * store can reach any approved member. The ordered (lo, hi) unique key makes
 * opening idempotent from either side, even under a race.
 */
export async function openDm(actor: CommunityActor, body: Record<string, unknown> | null): Promise<Outcome<OpenDmResponse>> {
  const peerKey = typeof body?.peerKey === "string" ? body.peerKey : "";
  if (!parseParticipantKey(peerKey)) return { kind: "invalid", message: "Pick someone to message." };
  const pair = dmPair(actor.key, peerKey);
  if (!pair) return { kind: "forbidden", message: "You can't message yourself." };

  const run = () =>
    withTenant(actor.tenantId, async (db): Promise<Outcome<OpenDmResponse>> => {
      const peer = (await loadParticipants(db, actor.tenant, [peerKey])).get(peerKey)!;
      const blocked = dmBlockedReason(actor, { key: peerKey, approved: peer.isTeam || peer.status === "approved" });
      if (blocked) return { kind: "forbidden", message: blocked };
      const existing = await db.communityConversation.findFirst({ where: pair, select: { id: true } });
      if (existing) return { kind: "ok", value: { conversationId: existing.id } };
      const created = await db.communityConversation.create({ data: { ...pair, tenantId: actor.tenantId }, select: { id: true } });
      return { kind: "ok", value: { conversationId: created.id } };
    });
  try {
    return await run();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return run();
    throw e;
  }
}
