"use server";

// Paid group-buy access — the STORE ADMIN's server actions: the per-round
// paid-join switch, the join-request queue, decisions and receipt links.
// Website #admin, and the app through the admin bridge (lib/mobile/admin-bridge).
// Every action opens with the same guard as the Group Buys manager: a store-
// admin session holding the `groupbuys` module, on the request's own store.
// Logic: lib/storefront/gb-review.server.ts.

import { after } from "next/server";
import { requireStaffPermission } from "@/lib/auth/staff-guard";
import { getTenantSlug } from "@/lib/tenant/headers";
import { resolveGroupBuyCaps } from "@/lib/storefront/group-buy-server";
import type { GroupBuy, GroupBuyCapabilities } from "@/lib/storefront/group-buy";
import { clearLiveGroupBuyCache } from "@/lib/community/group-buy-cards.server";
import { sendJoinDecision } from "@/lib/community/gb-join-bot.server";
import {
  adminReceiptUrl,
  listJoinRequests,
  reviewJoinRequest,
  reviewerFor,
  setPaidJoin,
  type JoinRequestCounts,
  type JoinRequestRow,
} from "@/lib/storefront/gb-review.server";
import type { StaffActor } from "@/storefront/admin/staff-permissions";

type Err = { error: string };
const NOT_SIGNED_IN = "Sign in to the store admin with group-buy access.";

async function gate(): Promise<{ tenantId: string; slug: string; caps: GroupBuyCapabilities; actor: StaffActor } | Err> {
  const ctx = await requireStaffPermission("groupbuys");
  if (!ctx) return { error: NOT_SIGNED_IN };
  const caps = await resolveGroupBuyCaps(ctx.tenantId);
  if (!caps.enabled) return { error: "Group buys aren't enabled for this store." };
  return { tenantId: ctx.tenantId, slug: (await getTenantSlug()) ?? ctx.tenantId, caps, actor: ctx.actor };
}

/** { id, paidJoin, joinFee } — joinFee in pesos ("500", "499.50"). */
export async function saveGroupBuyPaidJoinAction(input: unknown): Promise<{ ok: true; groupBuy: GroupBuy } | Err> {
  const g = await gate();
  if ("error" in g) return g;
  if (!g.caps.canEdit) return { error: "Editing group buys isn't enabled for this store." };
  const res = await setPaidJoin(g.tenantId, g.caps, input);
  // The chat card is cached per store; a switched round must not keep its old face.
  if ("ok" in res) clearLiveGroupBuyCache(g.tenantId);
  return res;
}

/** { status?, groupBuyId? } → the newest 200 requests + per-status counts. */
export async function listGroupBuyJoinRequestsAction(
  filters: unknown,
): Promise<{ ok: true; requests: JoinRequestRow[]; counts: JoinRequestCounts } | Err> {
  const g = await gate();
  if ("error" in g) return g;
  return listJoinRequests(g.tenantId, g.slug, filters);
}

/** { id, action: approve|reject|refund|revoke, reason?, refundReference? } */
export async function reviewGroupBuyJoinRequestAction(input: unknown): Promise<{ ok: true; request: JoinRequestRow } | Err> {
  const g = await gate();
  if ("error" in g) return g;
  const reviewer = await reviewerFor(g.tenantId, g.actor);
  const res = await reviewJoinRequest(g.tenantId, g.slug, reviewer, input);
  if ("ok" in res) {
    const { tenantId } = g;
    const id = res.request.id;
    after(() => sendJoinDecision(tenantId, id));
  }
  return res;
}

/** A 10-minute signed link to a request's receipt. */
export async function getGroupBuyJoinReceiptAction(id: unknown): Promise<{ ok: true; url: string } | Err> {
  const g = await gate();
  if ("error" in g) return g;
  return adminReceiptUrl(g.tenantId, id);
}
