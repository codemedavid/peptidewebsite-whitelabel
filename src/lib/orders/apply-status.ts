// The ONE engine that moves a stored order to a new status.
//
// There are two doors into this: the store admin (a cookie session, through
// updateStorefrontOrderAction) and the tenant's Telegram bot (a webhook, through
// a linked recipient's button press). Confirming an order is not a status write —
// it deducts inventory, appends to the fulfilment journey and triggers the
// customer's status email — so the two doors MUST NOT each implement it. They
// call this.
//
// It is deliberately ACTOR-AGNOSTIC: no cookie read, no permission check, no
// session. Authorization belongs to the caller, because the two callers prove
// authority in completely different ways (a staff-permission grant vs. a linked
// Telegram user id). Anything in here that read a session would silently make
// one of the two doors impossible.
//
// Idempotency comes free from planStatusChange: re-confirming an already-
// confirmed order yields `changed: false, move: null`, so a double-tapped button
// or a redelivered Telegram update writes nothing and deducts nothing.

import { Prisma } from "@prisma/client";
import { after } from "next/server";

import { withTenant } from "@/lib/db/tenant-client";
import { ACTIVE_ORDERS_WHERE } from "@/lib/orders/trash";
import { planStatusChange } from "@/lib/storefront/order-status";
import { applyOrderStockMove } from "@/lib/orders/stock-move-tx";
import {
  dbOrderToStorefront,
  normalizeItems,
  normalizeStatusHistory,
  type DbOrderRow,
} from "@/lib/orders/db-mapping";
import { getTenantContext } from "@/lib/tenant/context";
import { buildEmailBrand, buildStatusChangedPayload } from "@/lib/analytics/events";
import { capturePostHogEvent } from "@/lib/analytics/capture";
import { storefrontOrigin } from "@/lib/tenant/resolve";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { sendOrderUpdate } from "@/lib/community/order-bot.server";
import type { Order } from "@/storefront/types";

export type ApplyStatusResult =
  | {
      ok: true;
      order: Order;
      statusChanged: boolean;
      moved: boolean;
      prevStatus: string;
      /** The row's new updatedAt (ISO) — the next optimistic-concurrency token. */
      updatedAt: string;
      /** The signed-in customer account that placed the order, if any. */
      customerAccountId: string | null;
    }
  | { ok: false; error: string; conflict?: false }
  /** `expectedUpdatedAt` no longer matched: someone else changed the order first. */
  | { ok: false; error: string; conflict: true; current: Order; updatedAt: string; customerAccountId: string | null };

export type ApplyStatusOptions = {
  /**
   * Optimistic-concurrency precondition (mobile app). When set, the write only
   * lands if the row's updatedAt still equals it — checked in the SAME
   * UPDATE … WHERE as the write, so a concurrent edit can't slip in between.
   * Omitted by the web admin and the Telegram bot, whose behaviour is unchanged.
   */
  expectedUpdatedAt?: Date;
};

/**
 * Write `patch` (which may carry a status, courier, tracking number, …) onto one
 * of the tenant's live orders and settle everything a status move implies.
 *
 * @param slug the tenant's storefront slug, passed in rather than read from
 *   request headers: the Telegram webhook is not served on a tenant host, so
 *   getTenantSlug() would return null there and the email would lose its brand
 *   origin and the cache would not be busted.
 */
export async function applyOrderStatusChange(
  tenantId: string,
  orderId: string,
  patch: Prisma.StorefrontOrderUpdateInput & { status?: Order["status"] },
  slug: string | null,
  opts: ApplyStatusOptions = {},
): Promise<ApplyStatusResult> {
  const result = await withTenant(tenantId, async (db) => {
    // Read the current row first so we can append to the journey only when the
    // status actually changes (and never lose earlier events).
    // Scoped to live orders: a trashed one is out of the fulfilment flow, so it
    // must not be confirmable (which would deduct stock for a deletion the owner
    // believes they undid nothing of).
    const current = await db.storefrontOrder.findFirst({
      where: { ...ACTIVE_ORDERS_WHERE, id: orderId },
    });
    if (!current) return null;
    if (opts.expectedUpdatedAt && current.updatedAt.getTime() !== opts.expectedUpdatedAt.getTime()) {
      return { conflict: true as const, row: current };
    }

    const next: Prisma.StorefrontOrderUpdateInput = { ...patch };
    const newStatus = patch.status as Order["status"] | undefined;
    // The same per-order decision the demo path and the bulk action use.
    const plan = newStatus
      ? planStatusChange(
          {
            status: current.status as Order["status"],
            statusHistory: normalizeStatusHistory(current.statusHistory),
            imported: current.imported,
          },
          newStatus,
          new Date().toISOString(),
        )
      : null;
    if (plan?.changed) {
      next.statusHistory = plan.statusHistory as unknown as Prisma.InputJsonValue;
    }
    // updateMany is tenant-scoped by the extension; the bare-id update isn't.
    // With a precondition, updatedAt joins the WHERE so the check and the write
    // are one statement; zero rows written means a concurrent edit won.
    const written = await db.storefrontOrder.updateMany({
      where: {
        ...ACTIVE_ORDERS_WHERE,
        id: orderId,
        ...(opts.expectedUpdatedAt ? { updatedAt: current.updatedAt } : {}),
      },
      data: next,
    });
    if (written.count === 0) {
      const latest = await db.storefrontOrder.findFirst({ where: { ...ACTIVE_ORDERS_WHERE, id: orderId } });
      return latest ? { conflict: true as const, row: latest } : null;
    }

    // Confirmed → deduct each line item from the tenant's inventory; cancelled
    // after a deduction → put it back. Lines match by productId (stamped at
    // checkout) or by exact name for legacy orders; quantities clamp at zero so
    // stock never goes negative.
    const move = plan?.move ?? null;
    if (move) {
      await applyOrderStockMove(db, normalizeItems(current.items), move);
    }
    return {
      row: await db.storefrontOrder.findFirst({
        where: { ...ACTIVE_ORDERS_WHERE, id: orderId },
      }),
      moved: !!move,
      prevStatus: current.status,
      prevTracking: current.trackingNumber,
      statusChanged: !!plan?.changed,
    };
  });

  if (result && "conflict" in result) {
    const latest = result.row;
    if (!latest) return { ok: false, error: "Order not found." };
    return {
      ok: false,
      conflict: true,
      error: "This order was changed by someone else.",
      current: dbOrderToStorefront(latest as DbOrderRow),
      updatedAt: latest.updatedAt.toISOString(),
      customerAccountId: latest.customerAccountId,
    };
  }
  if (!result?.row) return { ok: false, error: "Order not found." };
  const order = dbOrderToStorefront(result.row as DbOrderRow);

  // Fulfillment moved (e.g. confirmed/shipped) → emit order_status_changed so the
  // tenant's PostHog workflow can email the customer. Fire-and-forget after the
  // response; capture no-ops unless the tenant is entitled and connected. The
  // branding is resolved BEFORE after() and stamped onto the event so the email
  // renders this store's identity.
  if (result.statusChanged) {
    const { branding } = await getTenantContext(tenantId);
    const emailBrand = buildEmailBrand(
      (branding?.config ?? {}) as Record<string, unknown>,
      storefrontOrigin(slug),
    );
    after(() =>
      capturePostHogEvent(
        tenantId,
        buildStatusChangedPayload(order, result.prevStatus, order.status, emailBrand),
      ),
    );
  }
  // Status moved or a tracking number was added → the order bot DMs the buyer
  // in the store chat and pushes their phone (no-op for guest orders and
  // stores without the app community). After the response, like the email.
  if (result.statusChanged || result.row.trackingNumber.trim() !== result.prevTracking.trim()) {
    const update = { tenantId, orderId, statusChanged: result.statusChanged, prevTracking: result.prevTracking };
    after(() => sendOrderUpdate(update));
  }
  // Stock changed → refresh the cached storefront so the catalog shows it.
  if (result.moved) revalidateTenant(tenantId, slug);

  return {
    ok: true,
    order,
    statusChanged: result.statusChanged,
    moved: result.moved,
    prevStatus: result.prevStatus,
    updatedAt: result.row.updatedAt.toISOString(),
    customerAccountId: result.row.customerAccountId,
  };
}
