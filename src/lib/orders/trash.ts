// The ORDER TRASH — one definition of "this order was deleted", shared by every
// surface that has to agree about it.
//
// Deleting an order used to be a hard DELETE. That is fine for the aggregates
// (a dropped row leaves every query correct for free) and terrible for the
// owner: one mis-click on "Delete All Orders" and a store's sales history is
// gone. So a delete now STAMPS `deletedAt` instead, the Orders screen grows a
// Trash view, and the owner can put an order back or destroy it deliberately.
//
// The cost of that trade lands here. A soft-deleted row is still in the table,
// so every read that used to be correct by construction now needs a filter —
// the admin list, the customer's Track lookup, the group-buy supplier report,
// the storefront's best-seller counts, the operator's cross-tenant revenue.
// Those live in five files nobody edits together, so the rule is written ONCE
// as a where-fragment they all spread, and `npm run test:order-trash` reads
// their source to prove none of them forgot.
//
// The two halves fail safe in OPPOSITE directions, deliberately:
//
//   • an unrecognised scope resolves to "active" — the list every existing
//     caller already gets. Leaking trashed rows into the working list would
//     read as "the delete didn't work".
//   • junk in `deletedAt` reads as NOT trashed. An order wrongly hidden from
//     the owner's revenue is a silent, unrecoverable-looking loss; an order
//     that wrongly reappears is visible and one click from being trashed again.
//
// Pure + JSON-safe (no React, no Prisma import) so the server actions, the demo
// store and the admin client share one contract — the same shape as
// lib/storefront/store-status.

/** Which half of the tenant's orders a caller wants. */
export type TrashScope = "active" | "trash";

/**
 * The rows the store still counts: everything that has not been trashed.
 *
 * Spread into an existing `where` rather than replacing it —
 * `{ ...ACTIVE_ORDERS_WHERE, groupBuyId }` — since Prisma ANDs top-level keys,
 * so the caller's own conditions can never widen the filter.
 */
export const ACTIVE_ORDERS_WHERE: { deletedAt: null } = { deletedAt: null };

/** The rows in the trash — what the Trash view lists, and the ONLY rows the
 *  permanent-delete path is ever allowed to touch. */
export const TRASHED_ORDERS_WHERE: { deletedAt: { not: null } } = {
  deletedAt: { not: null },
};

/** The where-fragment for a scope. Returns a fresh object each call so a caller
 *  spreading (or mutating) the result can't corrupt the shared constant. */
export function ordersWhere(scope: TrashScope): { deletedAt: null } | { deletedAt: { not: null } } {
  return scope === "trash" ? { deletedAt: { not: null } } : { deletedAt: null };
}

/**
 * Coerce an untrusted scope — it arrives as a server-action argument from the
 * admin client. Anything unrecognised is "active": that is the list the screen
 * has always shown, and it is the answer that can't hide an order.
 */
export function normalizeTrashScope(value: unknown): TrashScope {
  return value === "trash" ? "trash" : "active";
}

/**
 * Is this order in the trash?
 *
 * Only an unambiguous timestamp counts — a real Date, or a string a Date can
 * parse. Empty strings, whitespace, numbers, booleans and unparseable text all
 * read as NOT trashed, because hiding an order from the owner's books on a
 * malformed value is the one failure that looks like data loss.
 */
export function isTrashed(order: { deletedAt?: unknown }): boolean {
  const value = order?.deletedAt;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== "string") return false;
  const text = value.trim();
  return text.length > 0 && !Number.isNaN(new Date(text).getTime());
}

/** The orders the store still counts, in their original order. The in-memory
 *  twin of ACTIVE_ORDERS_WHERE, for demo mode and the admin client — both hold
 *  plain arrays and would otherwise each grow their own inline `.filter`. */
export function activeOrders<T extends { deletedAt?: unknown }>(list: readonly T[]): T[] {
  return list.filter((o) => !isTrashed(o));
}

/** The orders in the trash, in their original order. */
export function trashedOrders<T extends { deletedAt?: unknown }>(list: readonly T[]): T[] {
  return list.filter((o) => isTrashed(o));
}

/** Cap on ids accepted by one trash/restore/purge call — the same limit the
 *  existing bulk order actions already enforce, so "select all" behaves the
 *  same whichever button it feeds. */
export const MAX_TRASH_IDS = 1000;
