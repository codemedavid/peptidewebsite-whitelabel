import { useQuery } from "@tanstack/react-query";
import type { OUTSIDE_FOLDER as CONTRACT_OUTSIDE_FOLDER } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap } from "@/features/admin/bridge";
import type { GroupBuy } from "@/features/admin/group-buys/model";

/**
 * The web Orders hub's group-buy folders (listOrderFoldersAction, run through
 * the admin bridge). The folder list itself is the website's — live round
 * first, then upcoming, recent and archived — so the app never re-decides
 * which round owns an order. A picked folder is then listed by GET /orders
 * with `folder=`, which files orders the same way (resolveRoundOrders).
 */

/** The app's copy of the contract's OUTSIDE_FOLDER (Metro can't bundle a runtime value from the contract). */
export const OUTSIDE_FOLDER: typeof CONTRACT_OUTSIDE_FOLDER = "outside";

/** Which list the Orders tab shows: the folder picker, a round, outside, or every order. */
export type FolderKey = null | "all" | typeof OUTSIDE_FOLDER | `round:${string}`;

export const roundFolder = (id: string): FolderKey => `round:${id}`;

/** The `folder` query value for a FolderKey (null = the whole store). */
export function folderParam(key: FolderKey): string | null {
  if (key === OUTSIDE_FOLDER) return OUTSIDE_FOLDER;
  if (key && key.startsWith("round:")) return key.slice("round:".length);
  return null;
}

/** lib/storefront/order-folders.ts OrderFolder (only what the app reads). */
export type OrderFolder = {
  id: string;
  name: string;
  batchNumber: string;
  productName: string;
  status: "draft" | "scheduled" | "active" | "closed" | "cancelled" | "archived";
  bucket: "live" | "upcoming" | "recent" | "archived";
  startsAt: string | null;
  endsAt: string | null;
  closedAt: string | null;
  createdAt: string;
  totalOrders: number;
  participants: number;
  newOrders: number;
  unpaidOrders: number;
  cancelledOrders: number;
  grossIncome: number;
  collected: number;
  outstanding: number;
  vials: number;
  maxVials: number | null;
};

export type OrderFolders = Record<OrderFolder["bucket"], OrderFolder[]>;

export type OrderFoldersResult = {
  ok: true;
  enabled: boolean;
  folders: OrderFolders;
  groupBuys: GroupBuy[];
  canReport: boolean;
};

export const folderKeys = {
  list: (scope: string) => [scope, "orders", "folders"] as const,
};

/** Under [scope, "orders"], so every order write (which invalidates ordersAll) refreshes the folders too. */
export function useOrderFolders(enabled: boolean) {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: folderKeys.list(scope),
    enabled,
    queryFn: async () => unwrap(await adminBridge.call<OrderFoldersResult | { error: string }>("listOrderFoldersAction")),
  });
}

export function allFolders(f: OrderFolders): OrderFolder[] {
  return [...f.live, ...f.upcoming, ...f.recent, ...f.archived];
}

export const FOLDER_STATUS_LABEL: Record<OrderFolder["status"], string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  active: "Live",
  closed: "Closed",
  cancelled: "Cancelled",
  archived: "Archived",
};

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Oct 27 – Nov 4" — the web hub's dateRange (either end may be missing). */
export function dateRange(f: Pick<OrderFolder, "startsAt" | "endsAt" | "closedAt" | "createdAt">): string {
  const from = shortDate(f.startsAt);
  const to = shortDate(f.closedAt ?? f.endsAt);
  if (from && to) return `${from} – ${to}`;
  return from || to || `Created ${shortDate(f.createdAt)}`;
}

/** "Closes in 2d 5h" — null once it's past or open-ended. */
export function closesIn(endsAt: string | null, now: number): string | null {
  if (!endsAt) return null;
  const left = new Date(endsAt).getTime() - now;
  if (Number.isNaN(left) || left <= 0) return null;
  const d = Math.floor(left / DAY);
  const h = Math.floor((left % DAY) / HOUR);
  if (d > 0) return `Closes in ${d}d ${h}h`;
  const m = Math.max(1, Math.floor((left % HOUR) / MINUTE));
  return h > 0 ? `Closes in ${h}h ${m}m` : `Closes in ${m}m`;
}

/** "8 products · Batch TR30-B2 · Oct 27 – Nov 4" — the batch is left out when it only repeats the name. */
export function roundMeta(f: OrderFolder): string {
  const batch = f.batchNumber && f.batchNumber !== f.name ? `Batch ${f.batchNumber}` : "";
  return [f.productName, batch, dateRange(f)].filter(Boolean).join(" · ");
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}
