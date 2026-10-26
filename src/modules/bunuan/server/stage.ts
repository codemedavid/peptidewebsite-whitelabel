import "server-only";

// The stage control bar: what the round is in, which moves the admin is
// offered (each allowed or blocked, with why), and the move itself — row
// locked, re-validated live, audited. Reopen (Closed → Open) is allowed until
// the Ligwak lock, never after (owner, 2026-10-27).

import type { TenantTx } from "@/lib/db/tenant-client";
import { withTenant } from "@/lib/db/tenant-client";
import { allowedNextStages, editsLocked, normalizeGbStage, resolveStageMove, stageLabel, canOrder, type GbStage } from "@/lib/storefront/gb-stage";
import type { GroupBuyCapabilities } from "@/lib/storefront/group-buy";
import type { ReportKits } from "@/lib/storefront/group-buy-report";
import type { GbBlocker, GbFail, GbRoundStage, GbStageResult } from "@/lib/mobile/shop-contract";
import { bunuanCounter, effectiveStage, stageForStatusSave, stageMoveEligible, stageRowWrite, windowEnded } from "../core";
import {
  audit,
  kitProductFromRow,
  loadRoundState,
  loadStoreConfig,
  lockRound,
  roundBlockers,
  roundPaymentMode,
  type GbActor,
  type RoundState,
} from "./round-state";

export type GbCtx = { tenantId: string; actor: GbActor; caps: Pick<GroupBuyCapabilities, "bunuan" | "ligwak"> };

export const gbFail = (code: GbFail["code"], message: string, blockers?: GbBlocker[]): GbFail => ({
  ok: false,
  code,
  message,
  ...(blockers ? { blockers } : {}),
});

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const NOT_FOUND = gbFail("not_found", "Group buy not found.");
export const NO_STAGES = gbFail("unavailable", "Bunuan and Ligwak aren't enabled for this store.");

/** Does this store run its rounds on stages at all? */
export const stagesOn = (caps: GbCtx["caps"]) => caps.bunuan || caps.ligwak;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** The stage bar for one loaded round. */
export function stageView(state: RoundState, caps: GbCtx["caps"], now: Date = new Date()): GbRoundStage {
  const { round } = state;
  const stage = effectiveStage(round, now);
  const blockers = roundBlockers(state);
  const ligwakLocked = !!round.ligwakLockedAt;
  const eligible = stagesOn(caps) && stageMoveEligible(round, now);
  const filled = bunuanCounter(state.kitOrders, state.products, state.mode).allFilled;
  const options = eligible
    ? allowedNextStages(stage, {
        hasBunuan: caps.bunuan,
        hasLigwak: caps.ligwak,
        paymentMode: state.mode,
        ligwakLocked,
        blockers: blockers.length,
        allKitsFilled: filled,
      }).map((o) => ({ ...o, label: stageLabel(o.stage) }))
    : [];
  const ordering = canOrder(stage) && !windowEnded(round, now) && round.status !== "closed";
  return {
    roundId: round.id,
    stage,
    stageLabel: stageLabel(stage),
    stageChangedAt: iso(round.stageChangedAt),
    paymentMode: state.mode,
    paymentDueAt: iso(round.paymentDueAt),
    ligwakLockedAt: iso(round.ligwakLockedAt),
    features: { bunuan: caps.bunuan, ligwak: caps.ligwak },
    windowEnded: windowEnded(round, now),
    options,
    blockers,
    editsLocked: editsLocked(stage, ligwakLocked),
    reportReady: !ordering,
    reportFinal: !ordering && (ligwakLocked || !caps.ligwak),
  };
}

export async function getRoundStage(ctx: GbCtx, roundId: unknown): Promise<{ ok: true; round: GbRoundStage } | GbFail> {
  if (typeof roundId !== "string" || !ID_RE.test(roundId)) return NOT_FOUND;
  const state = await withTenant(ctx.tenantId, (db) => loadRoundState(db, roundId));
  return state ? { ok: true, round: stageView(state, ctx.caps) } : NOT_FOUND;
}

/** Parse an optional due date: ISO string / null / undefined. */
function parseDueDate(raw: unknown): Date | null | "invalid" {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return "invalid";
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : "invalid";
}

export type StageMoveDone = { from: GbStage; to: GbStage; skipped: boolean };

/** Apply a validated move to a locked round (shared with the Bunuan auto-close). */
export async function writeStageMove(
  db: TenantTx,
  tenantId: string,
  state: RoundState,
  to: GbStage,
  actor: GbActor,
  opts: { paymentDueAt?: Date | null; reason?: string; data?: Record<string, unknown> } = {},
  now: Date = new Date(),
): Promise<void> {
  const from = effectiveStage(state.round, now);
  const write = stageRowWrite(to, state.round, now, { paymentDueAt: opts.paymentDueAt });
  // Snapshot the counting rule the first time the round moves (pay_first /
  // pay_later can't flip under a round that's already counting).
  const paymentMode = state.round.paymentMode ? {} : { paymentMode: state.mode };
  await db.groupBuy.updateMany({ where: { id: state.round.id }, data: { ...write, ...paymentMode } });
  await audit(db, tenantId, {
    groupBuyId: state.round.id,
    kind: "stage",
    actor,
    reason: opts.reason,
    data: { from, to, ...(write.paymentDueAt ? { paymentDueAt: write.paymentDueAt.toISOString() } : {}), ...opts.data },
  });
}

/**
 * Move a round to `target`. Re-validated against the LIVE round inside one
 * transaction with the row locked, so two admins pressing at once can't both
 * move it, and Start Bunuan sees every order placed up to that instant.
 */
export async function setStage(
  ctx: GbCtx,
  input: { roundId: unknown; stage: unknown; paymentDueAt?: unknown; reason?: unknown },
): Promise<GbStageResult & { move?: StageMoveDone }> {
  if (!stagesOn(ctx.caps)) return NO_STAGES;
  const { roundId } = input;
  if (typeof roundId !== "string" || !ID_RE.test(roundId)) return NOT_FOUND;
  const target = normalizeGbStage(input.stage);
  if (typeof input.stage !== "string" || target !== input.stage.trim().toLowerCase()) {
    return gbFail("invalid_input", "Choose a stage: open, bunuan, closed or payment.");
  }
  const due = parseDueDate(input.paymentDueAt);
  if (due === "invalid") return gbFail("invalid_input", "That payment due date isn't a date.");
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";

  try {
    return await withTenant(ctx.tenantId, async (db) => {
      if (!(await lockRound(db, ctx.tenantId, roundId))) return NOT_FOUND;
      const state = await loadRoundState(db, roundId);
      if (!state) return NOT_FOUND;
      const now = new Date();
      if (!stageMoveEligible(state.round, now)) {
        return gbFail("conflict", "This round isn't live — open it first.");
      }
      const view = stageView(state, ctx.caps, now);
      const current = view.stage;
      const move = resolveStageMove(current, target, {
        hasBunuan: ctx.caps.bunuan,
        hasLigwak: ctx.caps.ligwak,
        paymentMode: state.mode,
        ligwakLocked: !!state.round.ligwakLockedAt,
        blockers: view.blockers.length,
        allKitsFilled: bunuanCounter(state.kitOrders, state.products, state.mode).allFilled,
      });
      if (!move.ok) {
        const blocked = target === "bunuan" && view.blockers.length > 0;
        return gbFail(blocked ? "blocked" : "conflict", move.reason, blocked ? view.blockers : undefined);
      }
      await writeStageMove(db, ctx.tenantId, state, move.stage, ctx.actor, {
        paymentDueAt: move.stage === "payment" ? due : undefined,
        reason,
        data: move.skipped ? { requested: target, skipped: true } : undefined,
      }, now);
      const after = await loadRoundState(db, roundId);
      return {
        ok: true as const,
        round: stageView(after ?? state, ctx.caps, now),
        skipped: move.skipped,
        move: { from: current, to: move.stage, skipped: move.skipped },
      };
    });
  } catch (e) {
    // The one-live-round index refuses a reopen while another round is live.
    if ((e as { code?: string }).code === "P2002") {
      return gbFail("conflict", "Another group buy is already active. Close it before reopening this one.");
    }
    throw e;
  }
}

/**
 * The old round editor (saveGroupBuyAction) saved a status. In a store with
 * stages, keep the stage in step (close → Closed, re-activate → reopen) and
 * refuse a reopen after the Ligwak lock / at Payment time (throws — the
 * editor shows the message). Opening a round snapshots its payment mode.
 * Returns the extra group_buys fields to write. 1–2 queries.
 */
export async function stageSyncForSave(
  db: TenantTx,
  tenantId: string,
  roundId: string | null,
  nextStatus: string,
  caps: GbCtx["caps"],
): Promise<Record<string, unknown>> {
  if (!stagesOn(caps)) return {};
  const now = new Date();
  const prev = roundId
    ? await db.groupBuy.findFirst({ where: { id: roundId }, select: { stage: true, status: true, ligwakLockedAt: true, paymentMode: true } })
    : null;
  const sync = prev ? stageForStatusSave(prev, nextStatus, now) : ({ ok: true, write: {}, move: null } as const);
  if (!sync.ok) throw new Error(sync.error);
  const snapshot =
    nextStatus === "active" && !prev?.paymentMode ? { paymentMode: roundPaymentMode({ paymentMode: null }, await loadStoreConfig(db)) } : {};
  if (sync.move && roundId) {
    await audit(db, tenantId, { groupBuyId: roundId, kind: "stage", actor: "admin", reason: "Round editor", data: { ...sync.move } });
  }
  return { ...sync.write, ...snapshot };
}

/**
 * The supplier report under Bunuan / Ligwak: the round's counting rule and
 * every product's kit sizes, plus whether ordering has ended (the report is
 * only offered then). null = the store isn't on stages (report as before).
 */
export async function loadReportKits(
  tenantId: string,
  roundId: string,
  caps: GbCtx["caps"],
): Promise<{ kits: ReportKits; ready: boolean } | null> {
  if (!stagesOn(caps) || !ID_RE.test(roundId)) return null;
  return withTenant(tenantId, async (db) => {
    const round = await db.groupBuy.findFirst({
      where: { id: roundId },
      select: { status: true, stage: true, startsAt: true, endsAt: true, paymentMode: true },
    });
    if (!round) return null;
    const config = await loadStoreConfig(db);
    const rows = await db.product.findMany({ select: { id: true, metadata: true } });
    const stage = effectiveStage(round);
    const ordering = canOrder(stage) && !windowEnded(round) && round.status !== "closed";
    return { kits: { mode: roundPaymentMode(round, config), products: rows.map(kitProductFromRow) }, ready: !ordering };
  });
}
