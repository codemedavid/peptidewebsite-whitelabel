import "server-only";

import type { TenantTx } from "@/lib/db/tenant-client";
import { endedGroupBuyCard, groupBuyCardFrom } from "@/lib/mobile/group-buy-share";
import { loadShopCatalog } from "@/lib/mobile/shop-catalog";
import type { CommunityMessage, GroupBuyCard } from "@/lib/mobile/contract";
import type { CommunityActor } from "./actor.server";

/**
 * Group-buy cards in chat, rebuilt from the live round — the same catalog the
 * shop serves (loadShopCatalog), so slots, countdown and the lowest price match
 * what a shopper is charged. Messages only store the round's id.
 *
 * TWO PHASES, because the live round is a full storefront load (many queries):
 *   1. inside the caller's withTenant() transaction, cardsForRounds() reads
 *      only the rounds' names (ONE query) and builds "ended" placeholders;
 *   2. AFTER the transaction, withLiveRounds() swaps the live round's card in.
 * Loading the storefront inside the transaction would hold it open past the
 * round-trip budget (P2028) and take a second pool connection per request.
 *
 * The live card is cached per tenant for a few seconds: a broadcast pushes
 * every member at once, and they all open the same channel together.
 */

export const ROUND_NOT_OPEN = "That group buy isn't open right now.";

const LIVE_TTL_MS = 15_000;
const MAX_CACHED = 1_000;
const liveCache = new Map<string, { at: number; card: Promise<GroupBuyCard | null> }>();

async function fetchLiveCard(actor: CommunityActor): Promise<GroupBuyCard | null> {
  try {
    const catalog = await loadShopCatalog({ tenantId: actor.tenantId, slug: actor.slug, customer: null });
    return catalog.groupBuy ? groupBuyCardFrom(catalog.groupBuy, catalog.store.currency) : null;
  } catch (e) {
    console.error(`[community] group buy card failed: ${e instanceof Error ? e.name : "Error"}`);
    return null;
  }
}

/**
 * The live round as a card, or null. Never throws: chat must load without it.
 * `fresh` skips the cache — the send and broadcast checks must see the round
 * as it is right now.
 */
export function loadLiveGroupBuyCard(actor: CommunityActor, { fresh = false }: { fresh?: boolean } = {}): Promise<GroupBuyCard | null> {
  const now = Date.now();
  const hit = liveCache.get(actor.tenantId);
  if (!fresh && hit && now - hit.at < LIVE_TTL_MS) return hit.card;
  if (liveCache.size >= MAX_CACHED) liveCache.clear();
  const card = fetchLiveCard(actor);
  liveCache.set(actor.tenantId, { at: now, card });
  return card;
}

/** Forget a tenant's cached live card (or every tenant's) — the next read loads it fresh. */
export function clearLiveGroupBuyCache(tenantId?: string): void {
  if (tenantId) liveCache.delete(tenantId);
  else liveCache.clear();
}

/** Phase 1 (inside the transaction): every referenced round as an "ended" card under its saved name. */
export async function cardsForRounds(db: TenantTx, ids: string[]): Promise<Map<string, GroupBuyCard>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rounds = await db.groupBuy.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
  return new Map(rounds.map((r) => [r.id, endedGroupBuyCard(r)]));
}

/** Phase 2 (after the transaction): the live round's cards show it live. Only loads when a card is present. */
export async function withLiveRounds(actor: CommunityActor, messages: CommunityMessage[]): Promise<CommunityMessage[]> {
  if (!messages.some((m) => m.groupBuy)) return messages;
  const live = await loadLiveGroupBuyCard(actor);
  if (!live) return messages;
  return messages.map((m) => (m.groupBuy && m.groupBuy.id === live.id ? { ...m, groupBuy: live } : m));
}

/** The send path's check (BEFORE its transaction): the id must be the live round, taking orders. */
export async function openRoundFor(
  actor: CommunityActor,
  groupBuyId: unknown,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const live = await loadLiveGroupBuyCard(actor, { fresh: true });
  if (!live || live.status !== "open" || typeof groupBuyId !== "string" || groupBuyId !== live.id) {
    return { ok: false, message: ROUND_NOT_OPEN };
  }
  return { ok: true, id: live.id };
}
