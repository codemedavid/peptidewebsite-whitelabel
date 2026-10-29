// Orders filed per group buy — the folder list a GB store's Orders screen opens
// on (live round first, then the recent ones), and the same list the ChatGPT
// connector reads (list_group_buy_orders).
//
// Pure. Ownership comes from resolveRoundOrders and the money from
// buildRoundAnalytics — the SAME pair the round dashboard uses — so a folder can
// never show a different order count or gross income from the dashboard it
// opens. Nothing here re-derives which round owns an order.

import {
  effectiveGroupBuyStatus,
  orderCountsAsDemand,
  type GroupBuy,
  type GroupBuyStatus,
} from "@/lib/storefront/group-buy";
import { resolveRoundOrders, type LinkableOrder } from "@/lib/storefront/group-buy-orders";
import { buildRoundAnalytics, type AnalyticsRound } from "@/lib/storefront/group-buy-analytics";

/** Where a round sits on the Orders screen. */
export type OrderFolderBucket = "live" | "upcoming" | "recent" | "archived";

export type OrderFolder = {
  id: string;
  name: string;
  batchNumber: string;
  productName: string;
  /** EFFECTIVE status — a round past its endsAt reads closed with no write. */
  status: GroupBuyStatus;
  bucket: OrderFolderBucket;
  startsAt: string | null;
  endsAt: string | null;
  closedAt: string | null;
  createdAt: string;
  /** Row ids of the orders this round owns — the Orders screen filters by these. */
  orderIds: string[];
  totalOrders: number;
  participants: number;
  /** Orders still at "new" — the owner's to-do count. */
  newOrders: number;
  /** Not cancelled and not marked paid. */
  unpaidOrders: number;
  cancelledOrders: number;
  grossIncome: number;
  collected: number;
  outstanding: number;
  vials: number;
  maxVials: number | null;
};

export type OrderFolders = {
  live: OrderFolder[];
  upcoming: OrderFolder[];
  recent: OrderFolder[];
  archived: OrderFolder[];
};

const BUCKET_OF: Record<GroupBuyStatus, OrderFolderBucket> = {
  active: "live",
  scheduled: "upcoming",
  draft: "upcoming",
  closed: "recent",
  cancelled: "recent",
  archived: "archived",
};

function toWindow(gb: GroupBuy): AnalyticsRound {
  return {
    id: gb.id,
    name: gb.name,
    status: gb.status,
    startsAt: gb.startsAt,
    endsAt: gb.endsAt,
    createdAt: gb.createdAt,
    batchNumber: gb.batchNumber,
    minVials: gb.minVials,
    maxVials: gb.maxVials,
    closedAt: gb.closedAt,
    productIds: gb.productIds,
  };
}

function ms(iso: string | null | undefined): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** The moment a finished round last mattered — what "recent" sorts by. */
function finishedAt(f: OrderFolder): number {
  return ms(f.closedAt) || ms(f.endsAt) || ms(f.createdAt);
}

function buildFolder(
  gb: GroupBuy,
  status: GroupBuyStatus,
  orders: LinkableOrder[],
  productNames?: Map<string, string>,
): OrderFolder {
  const a = buildRoundAnalytics(toWindow(gb), orders, productNames);
  const counted = orders.filter((o) => orderCountsAsDemand(o.status));
  return {
    id: gb.id,
    name: gb.name,
    batchNumber: a.overview.batchNumber,
    productName: a.overview.productName,
    status,
    bucket: BUCKET_OF[status],
    startsAt: gb.startsAt,
    endsAt: gb.endsAt,
    closedAt: gb.closedAt,
    createdAt: gb.createdAt,
    orderIds: orders.map((o) => o.id).filter((id): id is string => !!id),
    totalOrders: a.overview.totalOrders,
    participants: a.overview.participants,
    newOrders: orders.filter((o) => o.status === "new").length,
    unpaidOrders: counted.filter((o) => o.paymentStatus?.toLowerCase() !== "paid").length,
    cancelledOrders: a.financial.cancelledOrders,
    grossIncome: a.financial.grossIncome,
    collected: a.financial.revenueCollected,
    outstanding: a.financial.outstandingBalance,
    vials: a.product.totalVials,
    maxVials: a.overview.maxVials,
  };
}

/**
 * File every round's orders into its folder and sort the folders the way an
 * owner looks for them: the live round, then upcoming (soonest first), then
 * finished rounds (most recently closed first), archived last.
 *
 * @param candidates every order any round might own — NOT pre-filtered by
 *                   groupBuyId (see resolveRoundOrders for why).
 */
export function buildOrderFolders(
  rounds: readonly GroupBuy[],
  candidates: LinkableOrder[],
  opts: { scheduledEnabled: boolean; now?: Date; productNames?: Map<string, string> },
): OrderFolders {
  const now = opts.now ?? new Date();
  const windows = rounds.map(toWindow);
  const folders = rounds.map((gb, i) =>
    buildFolder(
      gb,
      effectiveGroupBuyStatus(gb, opts.scheduledEnabled, now),
      resolveRoundOrders(windows[i], candidates, windows).orders,
      opts.productNames,
    ),
  );
  const pick = (bucket: OrderFolderBucket) => folders.filter((f) => f.bucket === bucket);
  return {
    live: pick("live").sort((a, b) => ms(b.startsAt) - ms(a.startsAt)),
    upcoming: pick("upcoming").sort((a, b) => (ms(a.startsAt) || Infinity) - (ms(b.startsAt) || Infinity)),
    recent: pick("recent").sort((a, b) => finishedAt(b) - finishedAt(a)),
    archived: pick("archived").sort((a, b) => finishedAt(b) - finishedAt(a)),
  };
}

function allFolders(folders: OrderFolders): OrderFolder[] {
  return [...folders.live, ...folders.upcoming, ...folders.recent, ...folders.archived];
}

/** Every order id that belongs to SOME round — the complement is the
 *  "Outside a group buy" folder (on-hand orders, or ones in no window). */
export function filedOrderIds(folders: OrderFolders): Set<string> {
  return new Set(allFolders(folders).flatMap((f) => f.orderIds));
}

/** Find a folder by id, exact name or batch label (case-insensitive), falling
 *  back to a substring match — how the connector lets an operator say "the
 *  TR30 round" instead of a cuid. Returns every match so a caller can refuse
 *  an ambiguous one rather than guess. */
export function findOrderFolder(folders: OrderFolders, query: string): OrderFolder[] {
  const all = allFolders(folders);
  const raw = query.trim();
  const q = raw.toLowerCase();
  if (!q) return [];
  const exact = all.filter((f) => f.id === raw || f.name.toLowerCase() === q || f.batchNumber.toLowerCase() === q);
  if (exact.length) return exact;
  return all.filter((f) => f.name.toLowerCase().includes(q) || f.batchNumber.toLowerCase().includes(q));
}
