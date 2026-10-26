/**
 * Bunuan — the kit-fill phase after Open. Only kits (variations) that are part
 * way full stay buyable, and only for EXACTLY the vials they still need:
 * 143 vials at 10 per kit → 14 kits + 3 → 7 open. An exact multiple, a
 * variation nobody ordered and one without a kit size are closed, so Bunuan can
 * complete a kit but never start a new partial one.
 *
 * Every rule reads a KitTally from gb-kits, the same count the admin counter,
 * Ligwak and the supplier report use. The server must re-tally LIVE inside the
 * order transaction (round row locked) before calling clampToBunuan.
 */

import {
  countsTowardKits,
  kitKey,
  type GbPaymentMode,
  type KitOrder,
  type KitTally,
  type KitTallyEntry,
} from "@/lib/storefront/gb-kits";
import { orderCountsAsDemand } from "@/lib/storefront/group-buy";

/** A cart / order line as the cap reads it. */
export type BunuanLine = { name: string; qty: number; productId?: string; variation?: string };

export type BunuanRejection<L extends BunuanLine = BunuanLine> = {
  line: L;
  key: string;
  asked: number;
  /** Vials of this line that still fit (0 = none). */
  allowed: number;
  reason: "not_open" | "over_limit";
  message: string;
};

/** The kits still open in Bunuan, by name. */
export function bunuanOpenItems(tally: KitTally): KitTallyEntry[] {
  return Object.values(tally)
    .filter((entry) => entry.vialsNeeded > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Vials still open for one kit (0 = closed). */
export function bunuanAllowance(tally: KitTally, key: string): number {
  return tally[key]?.vialsNeeded ?? 0;
}

/** Every kit is full (or has no size) — Bunuan has nothing left to fill. */
export function allKitsFilled(tally: KitTally): boolean {
  return Object.values(tally).every((entry) => entry.vialsNeeded === 0);
}

const vialsWord = (n: number) => `${n} vial${n === 1 ? "" : "s"}`;

function rejection<L extends BunuanLine>(line: L, key: string, allowed: number): BunuanRejection<L> {
  const name = line.name || "This item";
  return allowed > 0
    ? {
        line,
        key,
        asked: line.qty,
        allowed,
        reason: "over_limit",
        message: `Only ${vialsWord(allowed)} of ${name} ${allowed === 1 ? "is" : "are"} left to fill the kit.`,
      }
    : {
        line,
        key,
        asked: line.qty,
        allowed: 0,
        reason: "not_open",
        message: `${name} isn't open right now — its kit is already full.`,
      };
}

/**
 * The checkout cap. Lines are served in order against one shared allowance per
 * kit; `accepted` holds what fits (trimmed), `rejected` everything that did
 * not. The server REJECTS the order when `rejected` is non-empty; the cart may
 * use `accepted` to offer the trimmed basket. Inputs are never mutated.
 */
export function clampToBunuan<L extends BunuanLine>(
  lines: readonly L[],
  tally: KitTally,
): { accepted: L[]; rejected: BunuanRejection<L>[] } {
  const left = new Map<string, number>();
  const accepted: L[] = [];
  const rejected: BunuanRejection<L>[] = [];
  for (const line of lines) {
    const qty = Math.floor(Number(line.qty));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const key = kitKey(line);
    const open = left.get(key) ?? bunuanAllowance(tally, key);
    const take = Math.min(qty, open);
    left.set(key, open - take);
    if (take > 0) accepted.push({ ...line, qty: take });
    if (take < qty) rejected.push(rejection(line, key, take));
  }
  return { accepted, rejected };
}

export type BunuanBlocker = { id: string; orderNumber?: string; placedAt: string };

/**
 * Orders that keep the admin from starting Bunuan. Pay-first rounds count only
 * checked orders, so an order still waiting for its payment check would be
 * left out of the kits and Bunuan would sell vials it later fills. Pay-later
 * rounds already count every placed order: nothing blocks. Oldest first.
 */
export function bunuanStartBlockers(orders: readonly KitOrder[], mode: GbPaymentMode): BunuanBlocker[] {
  if (mode === "pay_later") return [];
  return orders
    .filter((o) => orderCountsAsDemand(o.status) && !countsTowardKits(o, mode))
    .map((o) => ({ id: o.id, orderNumber: o.orderNumber, placedAt: o.placedAt }))
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt) || a.id.localeCompare(b.id));
}

/**
 * Admin order edits may go past the Bunuan limit (owner decision), but say so.
 * `deltas` = vials added (+) or removed (−) per kit key, from repriceEditedLines.
 */
export function bunuanEditWarnings(deltas: Readonly<Record<string, number>>, tally: KitTally): string[] {
  const warnings: string[] = [];
  for (const [key, added] of Object.entries(deltas)) {
    const open = bunuanAllowance(tally, key);
    if (added <= open) continue;
    const name = tally[key]?.name || "This item";
    warnings.push(
      open > 0
        ? `${name}: adding ${vialsWord(added)}, but only ${vialsWord(open)} ${open === 1 ? "is" : "are"} open in Bunuan.`
        : `${name}: adding ${vialsWord(added)}, but its kit is already full — this starts a new partial kit.`,
    );
  }
  return warnings;
}
