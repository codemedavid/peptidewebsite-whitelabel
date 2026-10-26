/**
 * The glue between a group_buys row and its stage (lib/storefront/gb-stage).
 *
 *   status + endsAt keep deciding whether a round is LIVE (nothing that reads
 *   liveness changed); `stage` is the admin's lifecycle on top. Two things keep
 *   them honest:
 *     • every stage move writes the status it implies (stageRowWrite), and
 *     • the old round editor, which saves a status, moves the stage with it
 *       (stageForStatusSave) and can't reopen a round after the Ligwak lock.
 *
 * Pure. Tested by npm run test:gb-stage-sync.
 */

import { normalizeGbStage, type GbStage } from "@/lib/storefront/gb-stage";

type When = Date | string | null | undefined;

/** The row fields the stage reads. */
export type StageRow = {
  status: string;
  stage: unknown;
  startsAt?: When;
  endsAt?: When;
  closedAt?: When;
  ligwakLockedAt?: When;
};

const ENDED = new Set(["closed", "cancelled", "archived"]);
const time = (w: When): number | null => {
  if (!w) return null;
  const t = (w instanceof Date ? w : new Date(w)).getTime();
  return Number.isFinite(t) ? t : null;
};
const asDate = (w: When): Date | null => (w ? (w instanceof Date ? w : new Date(w)) : null);

/** The stage the round is really in: a round the old editor closed (or
 *  cancelled / archived) is Closed even while its stored stage says Open/Bunuan. */
export function effectiveStage(round: StageRow, _now: Date = new Date()): GbStage {
  const stage = normalizeGbStage(round.stage);
  return ENDED.has(round.status) && (stage === "open" || stage === "bunuan") ? "closed" : stage;
}

/** Stored Open, still active, but its scheduled close has passed: nobody can
 *  order, and the admin moves it on (Start Bunuan or Close) from here. */
export function windowEnded(round: StageRow, now: Date = new Date()): boolean {
  if (effectiveStage(round, now) !== "open") return false;
  const ends = time(round.endsAt);
  return ends !== null && ends <= now.getTime();
}

/** Whether the stage bar applies at all: a live (started) round, or one the
 *  stages closed. Drafts, unstarted schedules, cancelled and archived rounds: no. */
export function stageMoveEligible(round: StageRow, now: Date = new Date()): boolean {
  if (round.status === "active" || round.status === "closed") return true;
  if (round.status !== "scheduled") return false;
  const starts = time(round.startsAt);
  return starts !== null && starts <= now.getTime();
}

/** The group_buys write a stage move makes (the caller adds the audit row). */
export type StageRowWrite = {
  stage: GbStage;
  stageChangedAt: Date;
  status?: "active" | "closed";
  endsAt?: Date | null;
  closedAt?: Date;
  paymentDueAt?: Date | null;
};

export function stageRowWrite(
  to: GbStage,
  round: StageRow,
  now: Date,
  opts: { paymentDueAt?: Date | null },
): StageRowWrite {
  const base = { stage: to, stageChangedAt: now };
  switch (to) {
    case "bunuan":
      // Bunuan has no timer (owner): it ends by admin action or when every kit fills.
      return { ...base, status: "active", endsAt: null };
    case "closed":
      return { ...base, status: "closed", closedAt: asDate(round.closedAt) ?? now };
    case "open": {
      // Reopen. A lapsed endsAt would close it again on the next read — drop it.
      const ends = time(round.endsAt);
      return { ...base, status: "active", endsAt: ends !== null && ends <= now.getTime() ? null : asDate(round.endsAt) };
    }
    case "payment":
      return { ...base, paymentDueAt: opts.paymentDueAt ?? null };
  }
}

export type StatusSaveStage =
  | { ok: true; write: Partial<Pick<StageRowWrite, "stage" | "stageChangedAt">>; move: { from: GbStage; to: GbStage } | null }
  | { ok: false; error: string };

/**
 * The old round editor saved a status. Keep the stage in step: closing an
 * Open/Bunuan round makes it Closed; re-activating a Closed one reopens it —
 * but never after the Ligwak lock or once Payment time started.
 */
export function stageForStatusSave(
  prev: Pick<StageRow, "status" | "stage" | "ligwakLockedAt">,
  nextStatus: string,
  now: Date,
): StatusSaveStage {
  const stage = normalizeGbStage(prev.stage);
  const goingLive = nextStatus === "active" || nextStatus === "scheduled";
  if (ENDED.has(nextStatus) && (stage === "open" || stage === "bunuan")) {
    return { ok: true, write: { stage: "closed", stageChangedAt: now }, move: { from: stage, to: "closed" } };
  }
  if (goingLive && stage === "payment") {
    return { ok: false, error: "Payment time has started — this round can't reopen." };
  }
  if (goingLive && stage === "closed") {
    if (prev.ligwakLockedAt) return { ok: false, error: "Ligwak is locked — this round can't reopen." };
    return { ok: true, write: { stage: "open", stageChangedAt: now }, move: { from: "closed", to: "open" } };
  }
  return { ok: true, write: {}, move: null };
}
