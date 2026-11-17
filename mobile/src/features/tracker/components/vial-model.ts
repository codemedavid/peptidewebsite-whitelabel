/**
 * Vial screens' wording and grouping (pure — tested by
 * scripts/test-tracker-vial-model.ts). What's left, doses left and run-out
 * always come from lib/vials vialStatus; this file only sorts and phrases them.
 */
import type { TrackerOrderVial } from "@contract";
import { addDays, daysBetween, dayKey, formatDay } from "../lib/ids";
import { VIAL_EXPIRY_DAYS, vialFromOrder, type VialStatus } from "../lib/vials";
import type { Protocol, Vial } from "../lib/types";
import { plural, relativeDayInline } from "./format";

/**
 * What's left, in one phrasing for every vial surface (Today, the vial list,
 * protocol detail): "Empty", or "3 doses left · runs out Fri". Doses beat a
 * percentage when they're known; an expired vial never "runs out today".
 */
export function vialLeftText(s: Pick<VialStatus, "pct" | "dosesLeft" | "runOutDate" | "isExpired">, now: Date): string {
  if (s.dosesLeft === 0 || s.pct <= 0) return "Empty";
  const left = s.dosesLeft !== null ? `${plural(s.dosesLeft, "dose")} left` : `${s.pct}% left`;
  return s.runOutDate && !s.isExpired ? `${left} · runs out ${relativeDayInline(s.runOutDate, now)}` : left;
}

/** A vial's stage, in the order the list shows them. */
export type VialPhase = "inUse" | "sealed" | "done";

/** Days before expiry the card starts warning. */
export const EXPIRY_WARN_DAYS = 3;
/** At most this many vials from one order line at once (a typo'd quantity never floods the shelf). */
export const MAX_VIALS_PER_LINE = 12;

/** Free text kept on the vial record (a passthrough field the server stores as is). */
export type VialNote = { note?: string | null };

export function vialPhase(vial: Pick<Vial, "status" | "unopened">): VialPhase {
  if (vial.status === "finished") return "done";
  return vial.unopened ? "sealed" : "inUse";
}

export type VialSection<T> = { phase: VialPhase; title: string; items: T[] };

const SECTION_TITLE: Record<VialPhase, string> = {
  inUse: "In use",
  sealed: "Unopened",
  done: "Finished & expired",
};

/**
 * In use → Unopened → Finished & expired; empty sections are dropped. An
 * expired vial still marked in use moves to the last section (it shouldn't be
 * drawn from), but keeps its "in use" status until the user finishes it.
 */
export function vialSections<T extends Pick<VialStatus, "vial" | "isExpired" | "pct">>(items: readonly T[]): VialSection<T>[] {
  const by: Record<VialPhase, T[]> = { inUse: [], sealed: [], done: [] };
  for (const item of items) {
    const phase = vialPhase(item.vial);
    by[item.isExpired && phase === "inUse" ? "done" : phase].push(item);
  }
  // In use: emptiest first (what needs attention). Others keep the caller's order (newest first).
  by.inUse.sort((a, b) => a.pct - b.pct);
  return (["inUse", "sealed", "done"] as const).filter((p) => by[p].length > 0).map((p) => ({ phase: p, title: SECTION_TITLE[p], items: by[p] }));
}

export type ExpiryInfo = { text: string; tone: "ok" | "soon" | "expired" };

/** "Expires in 12 days" / "Expires tomorrow" / "Expires today" / "Expired 3 days ago"; null when no date. */
export function expiryText(expiresOn: string | null, now: Date): ExpiryInfo | null {
  if (!expiresOn) return null;
  const left = daysBetween(dayKey(now), expiresOn);
  if (left < 0) {
    const ago = -left;
    return { text: ago === 1 ? "Expired yesterday" : `Expired ${ago} days ago`, tone: "expired" };
  }
  if (left === 0) return { text: "Expires today", tone: "soon" };
  if (left === 1) return { text: "Expires tomorrow", tone: "soon" };
  return { text: left <= EXPIRY_WARN_DAYS ? `Expires in ${left} days` : `Expires ${formatDay(expiresOn)} · ${left} days`, tone: left <= EXPIRY_WARN_DAYS ? "soon" : "ok" };
}

/** The default use-by for a vial mixed on `mixedOn` (TRACKER.md §4: + 28 days). */
export function defaultExpiry(mixedOn: string): string {
  return addDays(mixedOn, VIAL_EXPIRY_DAYS);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const MIN_FUZZY = 4;

/**
 * The protocol a delivered order line belongs to: one made from that product
 * (catalogId), else one whose name matches. Null when none or ambiguous — the
 * user then picks in the form, so a vial never lands on the wrong protocol.
 */
export function protocolForLine(line: Pick<TrackerOrderVial, "productId" | "name">, protocols: readonly Protocol[]): Protocol | null {
  const live = protocols.filter((p) => p.status !== "archived");
  const byProduct = live.filter((p) => p.catalogId === line.productId);
  if (byProduct.length === 1) return byProduct[0];
  if (byProduct.length > 1) return null;
  const name = norm(line.name);
  if (!name) return null;
  const exact = live.filter((p) => norm(p.name) === name);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const fuzzy = live.filter((p) => {
    const n = norm(p.name);
    return n.length >= MIN_FUZZY && (name.startsWith(n) || n.startsWith(name));
  });
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

/** The unopened vials one order line adds (one per unit bought, capped). Empty when the line states no strength. */
export function vialsFromLine(line: Pick<TrackerOrderVial, "key" | "strength" | "quantity">, protocolId: string): ReturnType<typeof vialFromOrder>[] {
  const one = vialFromOrder(line, protocolId);
  if (!one) return [];
  const count = Math.max(1, Math.min(MAX_VIALS_PER_LINE, Math.floor(line.quantity) || 1));
  return Array.from({ length: count }, () => ({ ...one }));
}

/** "10 mg BPC-157" style subtitle for an order line: variation and quantity. */
export function lineDetail(line: Pick<TrackerOrderVial, "variation" | "quantity" | "orderNumber">): string {
  const what = [line.variation, line.quantity > 1 ? `× ${line.quantity}` : null].filter(Boolean).join(" ");
  return [what, `Order ${line.orderNumber}`].filter(Boolean).join(" · ");
}
