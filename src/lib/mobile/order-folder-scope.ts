import "server-only";

import type { Prisma } from "@prisma/client";
import type { TenantTx } from "@/lib/db/tenant-client";
import { ACTIVE_ORDERS_WHERE } from "@/lib/orders/trash";
import type { GroupBuy } from "@/lib/storefront/group-buy";
import { loadGroupBuys } from "@/lib/storefront/group-buy-server";
import { resolveRoundOrders, type LinkableOrder } from "@/lib/storefront/group-buy-orders";
import { OUTSIDE_FOLDER } from "./contract";

/**
 * The web Orders hub's folders (AdminOrdersHub / listOrderFoldersAction) as an
 * order filter for GET /orders?folder=. A round's folder holds the orders
 * resolveRoundOrders files under it — stamped with the round, PLUS unstamped
 * ones placed inside its window (the k-glow drift case) — so the app's folder
 * shows exactly the orders and counts the website's folder shows. "outside" is
 * every order no round owns.
 *
 * `folder` is the raw query value; junk (too long) is ignored. The rounds are
 * read before the caller's transaction (loadGroupBuys opens its own), the
 * candidate orders inside it.
 */

const MAX_FOLDER_KEY = 64;

export type FolderScope = { kind: "outside" } | { kind: "round"; id: string };

export function parseFolder(raw: string | null): FolderScope | null {
  const v = (raw ?? "").trim();
  if (!v || v.length > MAX_FOLDER_KEY) return null;
  return v === OUTSIDE_FOLDER ? { kind: "outside" } : { kind: "round", id: v };
}

export async function loadFolderRounds(tenantId: string, slug: string, scope: FolderScope | null): Promise<GroupBuy[]> {
  return scope ? loadGroupBuys(tenantId, slug) : [];
}

/** Every order any round might own — the same bound as listOrderFoldersAction. */
async function candidateOrders(db: TenantTx, rounds: GroupBuy[]): Promise<LinkableOrder[]> {
  const earliest = rounds
    .map((r) => r.startsAt)
    .filter((s): s is string => !!s)
    .sort()[0];
  const rows = await db.storefrontOrder.findMany({
    where: {
      ...ACTIVE_ORDERS_WHERE,
      ...(earliest
        ? { OR: [{ NOT: { groupBuyId: null } }, { placedAt: { gte: new Date(earliest) } }] }
        : { NOT: { groupBuyId: null } }),
    },
    select: { id: true, status: true, placedAt: true, groupBuyId: true },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    date: r.placedAt.toISOString(),
    groupBuyId: r.groupBuyId,
    items: [],
  }));
}

/** The order ids a round owns (resolveRoundOrders over every round's window). */
function ownedIds(round: GroupBuy, candidates: LinkableOrder[], rounds: GroupBuy[]): string[] {
  return resolveRoundOrders(round, candidates, rounds).orders.flatMap((o) => (o.id ? [o.id] : []));
}

/** The where-clause for a folder; null = no folder (the whole store). */
export async function folderWhere(
  db: TenantTx,
  scope: FolderScope | null,
  rounds: GroupBuy[],
): Promise<Prisma.StorefrontOrderWhereInput | null> {
  if (!scope) return null;
  if (scope.kind === "round") {
    const round = rounds.find((r) => r.id === scope.id);
    // Another store's round, or a deleted one: an empty folder, never the store.
    if (!round) return { id: { in: [] } };
    return { id: { in: ownedIds(round, await candidateOrders(db, rounds), rounds) } };
  }
  if (rounds.length === 0) return {};
  const candidates = await candidateOrders(db, rounds);
  const filed = new Set(rounds.flatMap((r) => ownedIds(r, candidates, rounds)));
  return filed.size ? { id: { notIn: [...filed] } } : {};
}
