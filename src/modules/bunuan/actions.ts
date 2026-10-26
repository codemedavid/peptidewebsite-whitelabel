"use server";

// Bunuan's server actions — the ONLY session-gated doors into the module:
// a store-admin session on the request's own store (website #admin, and the
// app via the admin bridge). Stages + counter need the `groupbuys` module;
// editing an order's lines takes `groupbuys` or `orders`. Nothing here takes
// a store id, a price or a total from the client.
//
// Results are the shared app contract (lib/mobile/shop-contract).

import { requireAnyStaffPermission, requireStaffPermission, type AdminActorContext } from "@/lib/auth/staff-guard";
import { isDemoMode } from "@/lib/demo/fixtures";
import { revalidateOrders } from "@/lib/orders/order-cache";
import { resolveGroupBuyCaps, revalidateGroupBuys } from "@/lib/storefront/group-buy-server";
import type {
  GbBunuanCounterResult,
  GbFail,
  GbOrderEditResult,
  GbRoundStageResult,
  GbStageResult,
} from "@/lib/mobile/shop-contract";
import { editOrderLines, getBunuanCounter, getRoundStage, setStage, type EditCtx } from "./server";

const NOT_ADMIN: GbFail = { ok: false, code: "forbidden", message: "Sign in to the store admin with group-buy access." };
const NO_GB: GbFail = { ok: false, code: "unavailable", message: "Group buys aren't enabled for this store." };
const DEMO: GbFail = { ok: false, code: "unavailable", message: "Not available in the demo store." };

const actorOf = (ctx: AdminActorContext) => (ctx.actor.kind === "owner" ? "owner" : `staff:${ctx.actor.id}`);

async function admin(modules: readonly string[]): Promise<EditCtx | GbFail> {
  if (isDemoMode()) return DEMO;
  const ctx = modules.length === 1 ? await requireStaffPermission(modules[0]) : await requireAnyStaffPermission([...modules]);
  if (!ctx) return NOT_ADMIN;
  const caps = await resolveGroupBuyCaps(ctx.tenantId);
  if (!caps.enabled) return NO_GB;
  return {
    tenantId: ctx.tenantId,
    actor: actorOf(ctx),
    caps: { bunuan: caps.bunuan, ligwak: caps.ligwak },
    productAssignment: caps.productAssignment,
  };
}

/** The stage control bar for one round. */
export async function getGbRoundStageAction(roundId: unknown): Promise<GbRoundStageResult> {
  const g = await admin(["groupbuys"]);
  if ("ok" in g) return g;
  return getRoundStage(g, roundId);
}

/**
 * Move a round: "bunuan" (Start Bunuan), "closed", "open" (reopen, before the
 * Ligwak lock), "payment" (pay_later; optional ISO `paymentDueAt`). Start
 * Bunuan is refused with the list of pay_first orders still awaiting a payment
 * check (`blockers`).
 */
export async function setGbStageAction(
  roundId: unknown,
  stage: unknown,
  opts?: { paymentDueAt?: unknown; reason?: unknown },
): Promise<GbStageResult> {
  const g = await admin(["groupbuys"]);
  if ("ok" in g) return g;
  const r = await setStage(g, { roundId, stage, paymentDueAt: opts?.paymentDueAt, reason: opts?.reason });
  if (r.ok) {
    revalidateGroupBuys(g.tenantId);
    revalidateOrders(g.tenantId);
  }
  if (!r.ok) return r;
  const { move: _move, ...result } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
  return result;
}

/** The admin-only live kit counter (poll ~5s while Bunuan runs). */
export async function getBunuanCounterAction(roundId: unknown): Promise<GbBunuanCounterResult> {
  const g = await admin(["groupbuys"]);
  if ("ok" in g) return g;
  return getBunuanCounter(g, roundId);
}

/**
 * Add / remove / change lines on a customer's group-buy order. `lines` is the
 * WHOLE edited list: `{ index, qty }` per kept line (qty 0 or leaving it out
 * removes it), `{ productId, variation?, qty }` per new one. `preview: true`
 * prices it without saving. Over the Bunuan allowance is allowed, with
 * `warnings`. Locked at Payment time and while Ligwak is locked.
 */
export async function editOrderLinesAction(
  orderId: unknown,
  lines: unknown,
  opts?: { preview?: unknown; expectedUpdatedAt?: unknown },
): Promise<GbOrderEditResult> {
  const g = await admin(["groupbuys", "orders"]);
  if ("ok" in g) return g;
  const r = await editOrderLines(g, { orderId, lines, preview: opts?.preview, expectedUpdatedAt: opts?.expectedUpdatedAt });
  if (r.ok && r.saved) {
    revalidateOrders(g.tenantId);
    if (r.roundClosed) revalidateGroupBuys(g.tenantId);
  }
  if (!r.ok) return r;
  const { roundClosed: _c, roundId: _r, ...result } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
  return result;
}
