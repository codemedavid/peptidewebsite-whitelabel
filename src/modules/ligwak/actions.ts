"use server";

// Ligwak's server actions — store-admin doors (website #admin and the app's
// admin bridge), `groupbuys` module. Results are the shared app contract
// (lib/mobile/shop-contract).

import { requireStaffPermission } from "@/lib/auth/staff-guard";
import { isDemoMode } from "@/lib/demo/fixtures";
import { revalidateOrders } from "@/lib/orders/order-cache";
import { resolveGroupBuyCaps, revalidateGroupBuys } from "@/lib/storefront/group-buy-server";
import type { GbFail, GbRefundResult, GbRefundsResult, LigwakReviewResult } from "@/lib/mobile/shop-contract";
import {
  decideLigwak,
  listRefunds,
  lockLigwak,
  recalculateLigwak,
  reviewLigwak,
  setRefundStatus,
  type LigwakCtx,
} from "./server";

const NOT_ADMIN: GbFail = { ok: false, code: "forbidden", message: "Sign in to the store admin with group-buy access." };
const NO_GB: GbFail = { ok: false, code: "unavailable", message: "Group buys aren't enabled for this store." };
const DEMO: GbFail = { ok: false, code: "unavailable", message: "Not available in the demo store." };

async function admin(): Promise<LigwakCtx | GbFail> {
  if (isDemoMode()) return DEMO;
  const ctx = await requireStaffPermission("groupbuys");
  if (!ctx) return NOT_ADMIN;
  const caps = await resolveGroupBuyCaps(ctx.tenantId);
  if (!caps.enabled) return NO_GB;
  return {
    tenantId: ctx.tenantId,
    actor: ctx.actor.kind === "owner" ? "owner" : `staff:${ctx.actor.id}`,
    caps: { ligwak: caps.ligwak },
  };
}

function written(tenantId: string) {
  revalidateOrders(tenantId);
  revalidateGroupBuys(tenantId);
}

/** The Ligwak review: suggestions, saved decisions, totals impact. Read-only. */
export async function previewLigwakAction(roundId: unknown): Promise<LigwakReviewResult> {
  const g = await admin();
  if ("ok" in g) return g;
  return reviewLigwak(g, roundId);
}

/** Save Ligwak / Keep answers: [{ entryId, suggestQty, choice }]. */
export async function decideLigwakAction(roundId: unknown, decisions: unknown): Promise<LigwakReviewResult> {
  const g = await admin();
  if ("ok" in g) return g;
  return reviewOrWrite(g.tenantId, await decideLigwak(g, roundId, decisions), false);
}

/** Lock: writes every order's line results and new total. */
export async function lockLigwakAction(roundId: unknown): Promise<LigwakReviewResult> {
  const g = await admin();
  if ("ok" in g) return g;
  return reviewOrWrite(g.tenantId, await lockLigwak(g, roundId), true);
}

/** Undo the lock (reason required, audited) so orders can change and Ligwak re-run. */
export async function recalculateLigwakAction(roundId: unknown, reason: unknown): Promise<LigwakReviewResult> {
  const g = await admin();
  if ("ok" in g) return g;
  return reviewOrWrite(g.tenantId, await recalculateLigwak(g, roundId, reason), true);
}

/** pay_first refunds of one round, with each one's status trail. */
export async function listGbRefundsAction(roundId: unknown): Promise<GbRefundsResult> {
  const g = await admin();
  if ("ok" in g) return g;
  return listRefunds(g, roundId);
}

/** for_review → refund_pending → refunded (reference required for refunded). */
export async function setRefundStatusAction(orderId: unknown, status: unknown, reference?: unknown): Promise<GbRefundResult> {
  const g = await admin();
  if ("ok" in g) return g;
  const r = await setRefundStatus(g, { orderId, status, reference });
  if (r.ok) revalidateOrders(g.tenantId);
  return r;
}

function reviewOrWrite(tenantId: string, r: LigwakReviewResult, ordersChanged: boolean): LigwakReviewResult {
  if (r.ok && ordersChanged) written(tenantId);
  return r;
}
