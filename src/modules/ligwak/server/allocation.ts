import "server-only";

// Ligwak on the server: review → decide → lock → (explicit) recalculate.
//
//   review      the live plan (suggestLigwak over the round's counted orders),
//               the admin's saved decisions, and what a lock would do to each
//               order's total.
//   decide      saves decisions on the round's current (draft) allocation.
//   lock        refuses while any suggestion is undecided or a pay_first
//               order awaits its payment check; then writes the allocation,
//               every counted order's line results + re-total (one bulk
//               UPDATE), restocks ligwak'd vials of deducted orders, and
//               stamps the round locked. Edits are locked from here.
//   recalculate explicit + reasoned: supersedes the locked version, starts the
//               next one (carrying the decisions over), puts every order back
//               to un-allocated. Refused at Payment time and once a refund is
//               on its way.
//
// Every write runs in ONE transaction with the round row locked, in a fixed
// number of queries (no per-order loop — tx-round-trip-budget).

import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import { revalidateOrders } from "@/lib/orders/order-cache";
import { revalidateGroupBuys } from "@/lib/storefront/group-buy-server";
import { recalculateOrder, type GbRecalc, type TotalsOrder } from "@/lib/orders/gb-totals";
import { storedItems, normalizeStatusHistory } from "@/lib/orders/db-mapping";
import { normalizeAdminFee } from "@/lib/storefront/admin-fee";
import { stockCurrentlyDeducted } from "@/lib/storefront/order-status";
import { applyOrderStockMovesBatched, type StockMoveEntry } from "@/lib/storefront/stock-move-db";
import { stockMoveDb } from "@/lib/orders/stock-move-tx";
import type { Order, OrderItem } from "@/storefront/types";
import type { GbFail, LigwakDecisionInput, LigwakReview, LigwakReviewResult } from "@/lib/mobile/shop-contract";
import {
  applyLigwakDecisions,
  cancellationsByOrder,
  ligwakSuggestions,
  suggestLigwak,
  type LigwakDecision,
  type LigwakLineResult,
  type LigwakPlan,
} from "../core";
import { effectiveStage } from "@/modules/bunuan/core";
import {
  audit,
  customerName,
  gbFail,
  lockRound,
  loadRoundState,
  roundBlockers,
  type GbActor,
  type RoundOrderRow,
  type RoundState,
} from "@/modules/bunuan/server";

export type LigwakCtx = { tenantId: string; actor: GbActor; caps: { ligwak: boolean } };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const NOT_FOUND = gbFail("not_found", "Group buy not found.");
const NO_LIGWAK = gbFail("unavailable", "Ligwak isn't enabled for this store.");
const MAX_DECISIONS = 5000;

type Allocation = { id: string; version: number; lockedAt: Date | null; lockedBy: string | null };
type EntryRow = { orderId: string; lineIndex: number; suggestQty: number; decision: string | null };

const cents = (major: number) => Math.round(major * 100);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** The round's current allocation (highest version, not superseded) + its entries. */
async function currentAllocation(db: TenantTx, roundId: string): Promise<{ alloc: Allocation | null; entries: EntryRow[] }> {
  const alloc = await db.gbAllocation.findFirst({
    where: { groupBuyId: roundId, supersededAt: null },
    orderBy: { version: "desc" },
    select: { id: true, version: true, lockedAt: true, lockedBy: true },
  });
  if (!alloc) return { alloc: null, entries: [] };
  const entries = await db.gbAllocationEntry.findMany({
    where: { allocationId: alloc.id },
    select: { orderId: true, lineIndex: true, suggestQty: true, decision: true },
  });
  return { alloc, entries };
}

const decisionsFrom = (entries: readonly EntryRow[]): LigwakDecision[] =>
  entries.flatMap((e) =>
    e.decision === "ligwak" || e.decision === "keep"
      ? [{ entryId: `${e.orderId}#${e.lineIndex}`, suggestQty: e.suggestQty, choice: e.decision }]
      : [],
  );

/** The order as recalculateOrder reads it. */
function totalsOrder(o: RoundOrderRow): TotalsOrder {
  return {
    items: storedItems(o.items),
    discount: (o.discount ?? undefined) as Order["discount"],
    adminFee: (o.adminFee ?? undefined) as Order["adminFee"],
    paymentFee: (o.paymentFee ?? undefined) as Order["paymentFee"],
    shipping: { fee: Number((o.shipping as { fee?: unknown } | null)?.fee) || 0 },
  };
}

/** What the customer has paid so far: pay_first = the order's total once its
 *  payment was marked paid; pay_later = nothing until Payment time. */
function amountPaid(o: RoundOrderRow, state: RoundState): number {
  if (state.mode !== "pay_first" || o.paymentStatus !== "paid") return 0;
  return recalculateOrder(totalsOrder(o), {}, state.mode, 0).originalTotal;
}

/** Percentage admin fee → re-charged on what survived (only when the order had one). */
function adminFeePercent(o: RoundOrderRow, config: Record<string, unknown>): number | undefined {
  if (!o.adminFee) return undefined;
  const fee = normalizeAdminFee(config.adminFee);
  return fee.enabled && fee.mode === "percentage" ? fee.percent : undefined;
}

type OrderResult = { order: RoundOrderRow; recalc: GbRecalc; cancelled: Record<number, { cancelledQty: number }> };

/** Re-total every order the plan counted, from the line results. */
function reTotal(state: RoundState, lines: readonly LigwakLineResult[]): OrderResult[] {
  const byOrder = cancellationsByOrder(lines);
  const counted = new Set(lines.map((l) => l.orderId));
  return state.orders
    .filter((o) => counted.has(o.id))
    .map((o) => {
      const cancelled = byOrder[o.id] ?? {};
      const recalc = recalculateOrder(totalsOrder(o), cancelled, state.mode, amountPaid(o, state), {
        adminFeePercent: adminFeePercent(o, state.config),
      });
      return { order: o, recalc, cancelled };
    });
}

function reviewOf(
  state: RoundState,
  plan: LigwakPlan,
  alloc: Allocation | null,
  decisions: readonly LigwakDecision[],
): LigwakReview {
  const applied = applyLigwakDecisions(plan, decisions);
  const chosen = new Map(applied.lines.map((l) => [l.entryId, l.decision]));
  const byId = new Map(state.orders.map((o) => [o.id, o]));
  const impact = reTotal(state, applied.lines)
    .filter((r) => Object.keys(r.cancelled).length > 0)
    .map(({ order, recalc }) => ({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerName: customerName(order.customer),
      originalTotal: recalc.originalTotal,
      newTotal: recalc.newTotal,
      amountDue: recalc.amountDue,
      refundDue: recalc.refundDue,
      nextAction: recalc.nextAction,
      cancelledAll: recalc.cancelledAll,
    }));
  return {
    roundId: state.round.id,
    version: alloc?.version ?? 1,
    paymentMode: state.mode,
    locked: !!state.round.ligwakLockedAt,
    lockedAt: iso(alloc?.lockedAt ?? state.round.ligwakLockedAt),
    lockedBy: alloc?.lockedBy ?? null,
    kits: plan.kits,
    suggestions: ligwakSuggestions(plan).map((e) => ({
      entryId: e.id,
      orderId: e.orderId,
      orderNumber: e.orderNumber ?? "",
      customerName: customerName(byId.get(e.orderId)?.customer),
      lineIndex: e.lineIndex,
      key: e.key,
      name: e.name,
      variation: e.variation,
      placedAt: e.placedAt,
      quantity: e.quantity,
      kitSize: e.kitSize,
      keepQty: e.keepQty,
      suggestQty: e.suggestQty,
      decision: chosen.get(e.id) ?? null,
    })),
    undecided: applied.undecided.length,
    complete: applied.complete,
    impact,
    blockers: roundBlockers(state),
  };
}

const planOf = (state: RoundState) => suggestLigwak(state.kitOrders, state.products, state.mode);

/** Shared guard: Ligwak only runs on a Closed round. */
function closedGuard(state: RoundState): GbFail | null {
  const stage = effectiveStage(state.round);
  if (stage === "open" || stage === "bunuan") {
    return gbFail("conflict", "Close the round first — Ligwak reviews a closed round.");
  }
  return null;
}

export async function reviewLigwak(ctx: LigwakCtx, roundId: unknown): Promise<LigwakReviewResult> {
  if (!ctx.caps.ligwak) return NO_LIGWAK;
  if (typeof roundId !== "string" || !ID_RE.test(roundId)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (db) => {
    const state = await loadRoundState(db, roundId);
    if (!state) return NOT_FOUND;
    const { alloc, entries } = await currentAllocation(db, roundId);
    return { ok: true as const, review: reviewOf(state, planOf(state), alloc, decisionsFrom(entries)) };
  });
}

function parseDecisions(raw: unknown): LigwakDecision[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_DECISIONS) return null;
  const out: LigwakDecision[] = [];
  for (const it of raw as LigwakDecisionInput[]) {
    if (!it || typeof it !== "object") return null;
    if (typeof it.entryId !== "string" || !/^[A-Za-z0-9_-]{1,64}#\d{1,4}$/.test(it.entryId)) return null;
    if (!Number.isInteger(it.suggestQty) || it.suggestQty < 0) return null;
    if (it.choice !== "ligwak" && it.choice !== "keep") return null;
    out.push({ entryId: it.entryId, suggestQty: it.suggestQty, choice: it.choice });
  }
  return out;
}

/** Rewrite an allocation's entries from the plan + line results (2 queries). */
async function writeEntries(
  db: TenantTx,
  tenantId: string,
  allocationId: string,
  plan: LigwakPlan,
  lines: readonly LigwakLineResult[],
): Promise<void> {
  const byId = new Map(lines.map((l) => [l.entryId, l]));
  await db.gbAllocationEntry.deleteMany({ where: { allocationId } });
  if (!plan.entries.length) return;
  await db.gbAllocationEntry.createMany({
    data: plan.entries.map((e) => {
      const r = byId.get(e.id);
      const cancelledQty = r?.cancelledQty ?? 0;
      return {
        tenantId,
        allocationId,
        orderId: e.orderId,
        lineIndex: e.lineIndex,
        lineKey: e.key,
        productId: e.productId,
        variation: e.variation,
        name: e.name.slice(0, 300),
        quantity: e.quantity,
        successQty: e.quantity - cancelledQty,
        cancelledQty,
        kitSize: e.kitSize,
        suggestQty: e.suggestQty,
        decision: r?.decision ?? null,
      };
    }),
  });
}

async function draftAllocation(db: TenantTx, tenantId: string, state: RoundState, alloc: Allocation | null): Promise<Allocation> {
  if (alloc && !alloc.lockedAt) return alloc;
  const last = await db.gbAllocation.findFirst({
    where: { groupBuyId: state.round.id },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return db.gbAllocation.create({
    data: { tenantId, groupBuyId: state.round.id, version: (last?.version ?? 0) + 1, paymentMode: state.mode },
    select: { id: true, version: true, lockedAt: true, lockedBy: true },
  });
}

/** Save the admin's Ligwak / Keep answers (merged over the ones already saved). */
export async function decideLigwak(ctx: LigwakCtx, roundId: unknown, rawDecisions: unknown): Promise<LigwakReviewResult> {
  if (!ctx.caps.ligwak) return NO_LIGWAK;
  if (typeof roundId !== "string" || !ID_RE.test(roundId)) return NOT_FOUND;
  const incoming = parseDecisions(rawDecisions);
  if (!incoming) return gbFail("invalid_input", "Each decision needs an entryId, its suggestQty and a choice (ligwak or keep).");
  return withTenant(ctx.tenantId, async (db) => {
    if (!(await lockRound(db, ctx.tenantId, roundId))) return NOT_FOUND;
    const state = await loadRoundState(db, roundId);
    if (!state) return NOT_FOUND;
    const closed = closedGuard(state);
    if (closed) return closed;
    if (state.round.ligwakLockedAt) return gbFail("conflict", "Ligwak is locked — press Recalculate to change a decision.");
    const plan = planOf(state);
    const { alloc, entries } = await currentAllocation(db, roundId);
    const merged = new Map(decisionsFrom(entries).map((d) => [d.entryId, d]));
    for (const d of incoming) merged.set(d.entryId, d);
    const decisions = [...merged.values()];
    const draft = await draftAllocation(db, ctx.tenantId, state, alloc);
    await writeEntries(db, ctx.tenantId, draft.id, plan, applyLigwakDecisions(plan, decisions).lines);
    await audit(db, ctx.tenantId, {
      groupBuyId: roundId,
      kind: "ligwak_decide",
      actor: ctx.actor,
      data: { version: draft.version, decisions: incoming },
    });
    return { ok: true as const, review: reviewOf(state, plan, draft, decisions) };
  });
}

/** Line JSON with this lock's cancellations stamped (and old ones cleared). */
function stampedItems(raw: unknown, cancelled: Record<number, { cancelledQty: number }>): OrderItem[] {
  return storedItems(raw).map((item, i) => {
    const { cancelledQty: _old, ...rest } = item; // eslint-disable-line @typescript-eslint/no-unused-vars
    const c = cancelled[i]?.cancelledQty ?? 0;
    return c > 0 ? { ...rest, cancelledQty: Math.min(c, item.qty) } : rest;
  });
}

type OrderWrite = {
  id: string;
  items: OrderItem[];
  originalTotalCents: number | null;
  adjustedTotalCents: number | null;
  amountDueCents: number | null;
  refundDueCents: number | null;
  refundStatus: string | null;
  gbTotals: Record<string, number> | null;
};

/** ONE statement for every order of the round. Raw SQL is not tenant-scoped by
 *  the extension, so the tenant is in the WHERE (and RLS backs it up). */
async function writeOrders(db: TenantTx, tenantId: string, rows: readonly OrderWrite[]): Promise<void> {
  if (!rows.length) return;
  const payload = JSON.stringify(rows);
  await db.$executeRaw`
    UPDATE storefront_orders AS o SET
      "items" = v."items",
      "originalTotalCents" = v."originalTotalCents",
      "adjustedTotalCents" = v."adjustedTotalCents",
      "amountDueCents" = v."amountDueCents",
      "refundDueCents" = v."refundDueCents",
      "refundStatus" = v."refundStatus",
      "gbTotals" = v."gbTotals",
      "updatedAt" = now()
    FROM jsonb_to_recordset(${payload}::jsonb) AS v(
      "id" text, "items" jsonb, "originalTotalCents" int, "adjustedTotalCents" int,
      "amountDueCents" int, "refundDueCents" int, "refundStatus" text, "gbTotals" jsonb
    )
    WHERE o.id = v."id" AND o."tenantId" = ${tenantId}`;
}

const gbTotalsOf = (r: GbRecalc) => ({
  subtotal: r.subtotal,
  successSubtotal: r.successSubtotal,
  discount: r.discount,
  shipping: r.shipping,
  adminFee: r.adminFee,
  paymentFee: r.paymentFee,
  originalTotal: r.originalTotal,
  newTotal: r.newTotal,
  amountDue: r.amountDue,
  refundDue: r.refundDue,
});

/** Stock moves for deducted orders: put back (lock) or take again (recalculate)
 *  the ligwak'd vials. One batched read + one write per changed product. */
async function moveLigwakStock(
  db: TenantTx,
  orders: readonly RoundOrderRow[],
  cancelledByOrder: Readonly<Record<string, Record<number, { cancelledQty: number }>>>,
  move: StockMoveEntry["move"],
): Promise<void> {
  const moves: StockMoveEntry[] = [];
  for (const o of orders) {
    const c = cancelledByOrder[o.id];
    if (!c || o.imported || !stockCurrentlyDeducted(normalizeStatusHistory(o.statusHistory))) continue;
    const items = storedItems(o.items).flatMap((item, i) =>
      (c[i]?.cancelledQty ?? 0) > 0 ? [{ ...item, qty: c[i].cancelledQty, cancelledQty: undefined }] : [],
    );
    if (items.length) moves.push({ items, move });
  }
  if (moves.length) await applyOrderStockMovesBatched(stockMoveDb(db), moves);
}

export async function lockLigwak(ctx: LigwakCtx, roundId: unknown): Promise<LigwakReviewResult> {
  if (!ctx.caps.ligwak) return NO_LIGWAK;
  if (typeof roundId !== "string" || !ID_RE.test(roundId)) return NOT_FOUND;
  const result = await withTenant(ctx.tenantId, async (db) => {
    if (!(await lockRound(db, ctx.tenantId, roundId))) return NOT_FOUND;
    const state = await loadRoundState(db, roundId);
    if (!state) return NOT_FOUND;
    const closed = closedGuard(state);
    if (closed) return closed;
    if (state.round.ligwakLockedAt) return gbFail("conflict", "Ligwak is already locked.");
    const blockers = roundBlockers(state);
    if (blockers.length) {
      const n = blockers.length;
      return gbFail("blocked", `${n} order${n === 1 ? " still needs" : "s still need"} a payment check before Ligwak can lock.`, blockers);
    }
    const plan = planOf(state);
    const { alloc, entries } = await currentAllocation(db, roundId);
    const decisions = decisionsFrom(entries);
    const applied = applyLigwakDecisions(plan, decisions);
    if (!applied.complete) {
      const n = applied.undecided.length;
      return gbFail("blocked", `${n} suggested line${n === 1 ? " needs" : "s need"} a decision (Ligwak or Keep) before locking.`);
    }
    const now = new Date();
    const draft = await draftAllocation(db, ctx.tenantId, state, alloc);
    await writeEntries(db, ctx.tenantId, draft.id, plan, applied.lines);
    await db.gbAllocation.updateMany({ where: { id: draft.id }, data: { lockedAt: now, lockedBy: ctx.actor } });

    const results = reTotal(state, applied.lines);
    await writeOrders(
      db,
      ctx.tenantId,
      results.map(({ order, recalc, cancelled }) => ({
        id: order.id,
        items: stampedItems(order.items, cancelled),
        originalTotalCents: cents(recalc.originalTotal),
        adjustedTotalCents: cents(recalc.newTotal),
        amountDueCents: cents(recalc.amountDue),
        refundDueCents: cents(recalc.refundDue),
        // A refund the store owes starts "for review"; one already moving stays put.
        refundStatus: recalc.refundDue > 0 ? (order.refundStatus ?? "for_review") : null,
        gbTotals: gbTotalsOf(recalc),
      })),
    );
    await moveLigwakStock(db, state.orders, cancellationsByOrder(applied.lines), "restock");
    await db.groupBuy.updateMany({ where: { id: roundId }, data: { ligwakLockedAt: now } });
    const cancelledVials = applied.lines.reduce((s, l) => s + l.cancelledQty, 0);
    await audit(db, ctx.tenantId, {
      groupBuyId: roundId,
      kind: "ligwak_lock",
      actor: ctx.actor,
      data: {
        version: draft.version,
        orders: results.length,
        cancelledVials,
        refunds: results.filter((r) => r.recalc.refundDue > 0).length,
      },
    });
    const lockedState: RoundState = { ...state, round: { ...state.round, ligwakLockedAt: now } };
    return {
      ok: true as const,
      review: reviewOf(lockedState, plan, { ...draft, lockedAt: now, lockedBy: ctx.actor }, decisions),
    };
  });
  // After the commit: orders were re-totalled and the round re-stamped.
  if (result.ok) {
    revalidateOrders(ctx.tenantId);
    revalidateGroupBuys(ctx.tenantId);
  }
  return result;
}


export async function recalculateLigwak(ctx: LigwakCtx, roundId: unknown, rawReason: unknown): Promise<LigwakReviewResult> {
  if (!ctx.caps.ligwak) return NO_LIGWAK;
  if (typeof roundId !== "string" || !ID_RE.test(roundId)) return NOT_FOUND;
  const reason = typeof rawReason === "string" ? rawReason.trim().slice(0, 500) : "";
  if (reason.length < 3) return gbFail("invalid_input", "Say why you're recalculating (it's kept in the round's history).");
  const result = await withTenant(ctx.tenantId, async (db) => {
    if (!(await lockRound(db, ctx.tenantId, roundId))) return NOT_FOUND;
    const state = await loadRoundState(db, roundId);
    if (!state) return NOT_FOUND;
    if (!state.round.ligwakLockedAt) return gbFail("conflict", "Ligwak isn't locked — there's nothing to recalculate.");
    if (effectiveStage(state.round) === "payment") {
      return gbFail("conflict", "Payment time has started — amounts due are final.");
    }
    const moving = state.orders.filter((o) => o.refundStatus === "refund_pending" || o.refundStatus === "refunded");
    if (moving.length) {
      return gbFail("blocked", `A refund is already on its way for ${moving.map((o) => o.orderNumber).join(", ")} — recalculating would change it.`);
    }
    const { alloc, entries } = await currentAllocation(db, roundId);
    const decisions = decisionsFrom(entries);
    // What the lock cancelled, read back from the orders themselves.
    const wasCancelled: Record<string, Record<number, { cancelledQty: number }>> = {};
    for (const o of state.orders) {
      storedItems(o.items).forEach((item, i) => {
        if (item.cancelledQty) wasCancelled[o.id] = { ...wasCancelled[o.id], [i]: { cancelledQty: item.cancelledQty } };
      });
    }
    const now = new Date();
    if (alloc) await db.gbAllocation.updateMany({ where: { id: alloc.id }, data: { supersededAt: now } });
    const next = await db.gbAllocation.create({
      data: { tenantId: ctx.tenantId, groupBuyId: roundId, version: (alloc?.version ?? 0) + 1, paymentMode: state.mode },
      select: { id: true, version: true, lockedAt: true, lockedBy: true },
    });
    // Back to un-allocated: lines uncancelled, totals NULL (= computed as today).
    const allocated = state.orders.filter((o) => o.adjustedTotalCents !== null);
    await writeOrders(
      db,
      ctx.tenantId,
      allocated.map((o) => ({
        id: o.id,
        items: stampedItems(o.items, {}),
        originalTotalCents: null,
        adjustedTotalCents: null,
        amountDueCents: null,
        refundDueCents: null,
        refundStatus: null,
        gbTotals: null,
      })),
    );
    await moveLigwakStock(db, state.orders, wasCancelled, "deduct");
    await db.groupBuy.updateMany({ where: { id: roundId }, data: { ligwakLockedAt: null } });
    // The new version starts from the old decisions; changed suggestions read undecided.
    const fresh = await loadRoundState(db, roundId);
    const base = fresh ?? state;
    const plan = planOf(base);
    await writeEntries(db, ctx.tenantId, next.id, plan, applyLigwakDecisions(plan, decisions).lines);
    await audit(db, ctx.tenantId, {
      groupBuyId: roundId,
      kind: "ligwak_recalculate",
      actor: ctx.actor,
      reason,
      data: { from: alloc?.version ?? null, to: next.version, orders: allocated.length },
    });
    return { ok: true as const, review: reviewOf(base, plan, next, decisions) };
  });
  // After the commit: orders were re-totalled and the round re-stamped.
  if (result.ok) {
    revalidateOrders(ctx.tenantId);
    revalidateGroupBuys(ctx.tenantId);
  }
  return result;
}
