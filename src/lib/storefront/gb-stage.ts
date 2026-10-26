// Group-buy stages — the admin-driven lifecycle a round moves through:
//
//   Open → [Bunuan time, only with Bunuan] → Closed (Ligwak review) → [Payment time, pay_later only]
//
// A separate axis from GroupBuy.status + endsAt (which keep deciding whether a
// round is live), so nothing that reads liveness changes. Forward-only:
//   • Start Bunuan is blocked while pay_first orders still await a payment
//     check (those orders aren't counted yet), and skips straight to Closed
//     when every kit is already full.
//   • Bunuan moves itself to Closed the moment the last kit fills.
//   • Payment time waits for the Ligwak lock in stores that have Ligwak.
//
// Pure. Tested by npm run test:gb-stage.

import type { GbPaymentMode } from "./gb-kits";

export const GB_STAGES = ["open", "bunuan", "closed", "payment"] as const;
export type GbStage = (typeof GB_STAGES)[number];

const LABELS: Readonly<Record<GbStage, string>> = {
  open: "Open",
  bunuan: "Bunuan time",
  closed: "Closed",
  payment: "Payment time",
};

/** What decides which moves the admin is offered. */
export type StageContext = {
  hasBunuan: boolean;
  hasLigwak: boolean;
  paymentMode: GbPaymentMode;
  ligwakLocked: boolean;
  /** pay_first orders awaiting a payment check (bunuanStartBlockers length). */
  blockers: number;
  /** Every kit is already full (allKitsFilled on a live tally). */
  allKitsFilled?: boolean;
};

export type StageOption = {
  stage: GbStage;
  allowed: boolean;
  reason?: string;
  /** Set when moving here lands somewhere else instead (Bunuan with nothing to fill). */
  skipsTo?: GbStage;
};

export function normalizeGbStage(raw: unknown): GbStage {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (GB_STAGES as readonly string[]).includes(value) ? (value as GbStage) : "open";
}

export function stageLabel(stage: GbStage): string {
  return LABELS[stage];
}

function bunuanOption(ctx: StageContext): StageOption {
  if (ctx.paymentMode === "pay_first" && ctx.blockers > 0) {
    const n = ctx.blockers;
    return {
      stage: "bunuan",
      allowed: false,
      reason: `${n} order${n === 1 ? " still needs" : "s still need"} a payment check before Bunuan can start.`,
    };
  }
  if (ctx.allKitsFilled) return { stage: "bunuan", allowed: true, skipsTo: "closed" };
  return { stage: "bunuan", allowed: true };
}

function paymentOption(ctx: StageContext): StageOption {
  if (ctx.hasLigwak && !ctx.ligwakLocked) {
    return { stage: "payment", allowed: false, reason: "Lock Ligwak first, so every amount due is final." };
  }
  return { stage: "payment", allowed: true };
}

/** The moves the admin is offered from `current`, each allowed or blocked. */
export function allowedNextStages(current: GbStage, ctx: StageContext): StageOption[] {
  switch (current) {
    case "open":
      return [...(ctx.hasBunuan ? [bunuanOption(ctx)] : []), { stage: "closed", allowed: true }];
    case "bunuan":
      return [{ stage: "closed", allowed: true }];
    case "closed":
      return ctx.paymentMode === "pay_later" ? [paymentOption(ctx)] : [];
    case "payment":
      return [];
  }
}

/** Validate a requested move and say where the round actually lands. */
export function resolveStageMove(
  current: GbStage,
  target: GbStage,
  ctx: StageContext,
): { ok: true; stage: GbStage; skipped: boolean } | { ok: false; reason: string } {
  const option = allowedNextStages(current, ctx).find((o) => o.stage === target);
  if (!option) return { ok: false, reason: `A round can't move from ${stageLabel(current)} to ${stageLabel(target)}.` };
  if (!option.allowed) return { ok: false, reason: option.reason ?? "That move isn't allowed yet." };
  return option.skipsTo ? { ok: true, stage: option.skipsTo, skipped: true } : { ok: true, stage: target, skipped: false };
}

/** Moves the round makes by itself: Bunuan ends when every kit is full. */
export function autoAdvance(current: GbStage, live: { allKitsFilled: boolean }): GbStage {
  return current === "bunuan" && live.allKitsFilled ? "closed" : current;
}

/** Can customers place orders in this stage? */
export function canOrder(stage: GbStage): boolean {
  return stage === "open" || stage === "bunuan";
}

/** Are admin order edits locked? From Payment time on, and once Ligwak is locked
 *  (an explicit Recalculate unlocks). */
export function editsLocked(stage: GbStage, ligwakLocked = false): boolean {
  return stage === "payment" || ligwakLocked;
}
