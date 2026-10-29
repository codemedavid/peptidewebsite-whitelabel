"use server";

// "My Group Buy Order" lookup (FEATURES.STORE_MY_GROUPBUY_ORDER, operator-
// grantable, default OFF). A buyer types the email AND phone they used at
// checkout; they get back their own group-buy rounds — checkouts, merged items
// and totals — and nothing else. The matching / merging / money live in
// lib/storefront/my-groupbuy-order.ts (pure, tested).
//
// Guarantees:
//   • fail closed: no tenant, demo mode, or the entitlement off → unavailable,
//     whatever the client rendered;
//   • the tenant comes from the request host, never from input, and every read
//     runs inside withTenant (RLS-scoped);
//   • trashed orders are excluded (ACTIVE_ORDERS_WHERE) and only group-buy
//     orders are read;
//   • the response carries no PII and no store-internal fields (no names,
//     addresses, proofs, notes or ids beyond the round's);
//   • one generic miss message, whichever field was wrong; rate-limited per IP.

import { getTenantIdOrNull } from "@/lib/tenant/headers";
import { isDemoMode } from "@/lib/demo/fixtures";
import { withTenant } from "@/lib/db/tenant-client";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import { ACTIVE_ORDERS_WHERE } from "@/lib/orders/trash";
import { dbOrderToStorefront, type DbOrderRow } from "@/lib/orders/db-mapping";
import { loadRoundRows, scheduledRoundsOn } from "@/lib/mobile/order-rounds.server";
import {
  buildMyGroupBuyOrder,
  matchesBuyer,
  parseBuyerLookup,
  type MyGbRound,
} from "@/lib/storefront/my-groupbuy-order";

const UNAVAILABLE = "This page isn't available on this store.";
const MINUTE = 60_000;
/** Lookups per IP per window — enough for typos, too few to enumerate contacts. */
const LOOKUPS_PER_WINDOW = 10;
const LOOKUP_WINDOW_MS = 15 * MINUTE;
/** Newest group-buy orders scanned for a match (the customer blob is JSON, and
 *  phone formats vary, so the match runs in code, not in SQL). */
const SCAN_LIMIT = 5000;

export type MyGroupBuyOrderResult = { ok: true; rounds: MyGbRound[] } | { error: string };

/** Exactly the columns dbOrderToStorefront reads. Named, never a full row, so
 *  a schema column that isn't in the live DB yet can't fail the lookup. */
const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  paymentMethod: true,
  paymentProofUrl: true,
  customer: true,
  shipping: true,
  items: true,
  statusHistory: true,
  adminFee: true,
  paymentFee: true,
  discount: true,
  courier: true,
  trackingNumber: true,
  shippingNote: true,
  customerNote: true,
  placedAt: true,
  groupBuyId: true,
  groupBuyName: true,
  deletedAt: true,
  adjustedTotalCents: true,
  amountDueCents: true,
  refundDueCents: true,
  refundStatus: true,
  refundReference: true,
  gbTotals: true,
  storeEditedAt: true,
} as const;

/** The request's tenant, when the feature is live for it; else null. */
async function lookupTenant(): Promise<string | null> {
  if (isDemoMode()) return null;
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return null;
  return (await hasFeature(tenantId, FEATURES.STORE_MY_GROUPBUY_ORDER)) ? tenantId : null;
}

export async function lookupMyGroupBuyOrderAction(input: unknown): Promise<MyGroupBuyOrderResult> {
  const tenantId = await lookupTenant();
  if (!tenantId) return { error: UNAVAILABLE };

  const limit = rateLimit(`my-gb-order:${tenantId}:${await clientIp()}`, LOOKUPS_PER_WINDOW, LOOKUP_WINDOW_MS);
  if (!limit.ok) {
    return { error: `Too many lookups. Try again in ${Math.max(1, Math.ceil(limit.retryAfter / 60))} min.` };
  }

  const parsed = parseBuyerLookup(input);
  if (!parsed.ok) return { error: parsed.error };
  const { keys } = parsed;

  try {
    const { orders, roundRows } = await withTenant(tenantId, async (db) => {
      // 1. Find the buyer's orders by their contact blob alone (light rows).
      const candidates = await db.storefrontOrder.findMany({
        where: { ...ACTIVE_ORDERS_WHERE, groupBuyId: { not: null } },
        orderBy: { placedAt: "desc" },
        take: SCAN_LIMIT,
        select: { id: true, customer: true },
      });
      const ids = candidates.filter((c) => matchesBuyer(c.customer, keys)).map((c) => c.id);
      if (ids.length === 0) return { orders: [], roundRows: [] };

      // 2. Only now read the full rows of the matches, and their rounds.
      const rows = await db.storefrontOrder.findMany({
        where: { ...ACTIVE_ORDERS_WHERE, groupBuyId: { not: null }, id: { in: ids } },
        select: ORDER_SELECT,
      });
      const mapped = rows.map((r) => dbOrderToStorefront(r as DbOrderRow));
      const roundIds = mapped.flatMap((o) => (o.groupBuyId ? [o.groupBuyId] : []));
      return { orders: mapped, roundRows: await loadRoundRows(db, roundIds) };
    });
    if (orders.length === 0) return { ok: true, rounds: [] };

    // Entitlements use their own connection, so this runs outside withTenant.
    const scheduledEnabled = await scheduledRoundsOn(tenantId, roundRows);
    return { ok: true, rounds: buildMyGroupBuyOrder(orders, roundRows, keys, { scheduledEnabled }) };
  } catch (e) {
    console.error("[my-groupbuy-order] lookup failed", e);
    return { error: "Couldn't look up your order. Please try again." };
  }
}
