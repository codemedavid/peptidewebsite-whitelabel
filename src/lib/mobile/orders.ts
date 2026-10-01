import "server-only";

import { Prisma } from "@prisma/client";
import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import { applyOrderStatusChange } from "@/lib/orders/apply-status";
import { customerKey } from "@/lib/community/keys";
import { dbOrderToStorefront, type DbOrderRow } from "@/lib/orders/db-mapping";
import { ACTIVE_ORDERS_WHERE, TRASHED_ORDERS_WHERE } from "@/lib/orders/trash";
import { isOrderStatus } from "@/lib/storefront/order-status";
import type { Order } from "@/storefront/types";
import type { OrderDetail, OrderListResponse, OrderUpdateRequest } from "./contract";
import type { MobileContext } from "./auth";
import { queueCountsFrom, statusesForFilter, toOrderDetail, toOrderSummary } from "./order-view";

/**
 * Tenant-scoped order reads/writes for the mobile API. Every query runs inside
 * withTenant(ctx.tenantId) — the forTenant() filter plus the RLS GUC — with the
 * tenant taken from the authenticated session, never from the request.
 *
 * Writes go through applyOrderStatusChange, the same engine the web admin and
 * the Telegram bot use, so stock moves, the status journey and the customer's
 * status email can never differ between the three doors.
 */

export const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const MAX_QUERY = 80;
const TO_FULFIL = statusesForFilter("to-fulfil")!;

/** Both queue badges in one grouped query (see queueCountsFrom). */
export async function queueCounts(db: TenantTx): Promise<{ new: number; toFulfil: number }> {
  const groups = await db.storefrontOrder.groupBy({
    by: ["status"],
    where: { ...ACTIVE_ORDERS_WHERE, status: { in: ["new", ...TO_FULFIL] } },
    _count: { _all: true },
  });
  return queueCountsFrom(groups.map((g) => ({ status: g.status, count: g._count._all })));
}

function currencyOf(ctx: MobileContext): unknown {
  const config = ctx.tenant.branding?.config;
  return config && typeof config === "object" ? (config as Record<string, unknown>).currency : undefined;
}

// ── cursor: "<createdAt ISO>|<id>" base64url ─────────────────────────────────

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(raw: string | null): { createdAt: Date; id: string } | null {
  if (!raw || raw.length > 200) return null;
  const [iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const createdAt = new Date(iso ?? "");
  return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
}

/** Order ids whose number / customer name / email / phone match `q` (case-insensitive). */
async function searchIds(
  db: TenantTx,
  tenantId: string,
  q: string,
): Promise<string[]> {
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM storefront_orders
    WHERE "tenantId" = ${tenantId}
      AND "deletedAt" IS NULL
      AND ("orderNumber" ILIKE ${like}
        OR customer->>'name' ILIKE ${like}
        OR customer->>'email' ILIKE ${like}
        OR customer->>'phone' ILIKE ${like})
    ORDER BY "createdAt" DESC
    LIMIT 500`;
  return rows.map((r) => r.id);
}

export async function listOrders(
  ctx: MobileContext,
  params: URLSearchParams,
): Promise<OrderListResponse> {
  const statuses = statusesForFilter(params.get("filter"));
  const q = (params.get("q") ?? "").trim().slice(0, MAX_QUERY);
  const cursor = decodeCursor(params.get("cursor"));
  const limit = Math.min(Math.max(Number(params.get("limit")) || PAGE_SIZE, 1), MAX_PAGE_SIZE);

  return withTenant(ctx.tenantId, async (db) => {
    const ids = q ? await searchIds(db, ctx.tenantId, q) : null;
    const where: Prisma.StorefrontOrderWhereInput = {
      ...ACTIVE_ORDERS_WHERE,
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(ids ? { id: { in: ids } } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
    const [rows, counts] = await Promise.all([
      db.storefrontOrder.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      }),
      queueCounts(db),
    ]);
    const page = rows.slice(0, limit);
    return {
      orders: page.map((r) => toOrderSummary(dbOrderToStorefront(r as DbOrderRow), currencyOf(ctx))),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
      counts,
    };
  });
}

function detailOf(ctx: MobileContext, order: Order, updatedAt: Date | string, customerAccountId: string | null): OrderDetail {
  const iso = typeof updatedAt === "string" ? updatedAt : updatedAt.toISOString();
  return { ...toOrderDetail(order, currencyOf(ctx), iso), chatKey: customerAccountId ? customerKey(customerAccountId) : null };
}

export async function getOrder(ctx: MobileContext, id: string): Promise<OrderDetail | null> {
  const row = await withTenant(ctx.tenantId, (db) =>
    db.storefrontOrder.findFirst({ where: { ...ACTIVE_ORDERS_WHERE, id } }),
  );
  return row ? detailOf(ctx, dbOrderToStorefront(row as DbOrderRow), row.updatedAt, row.customerAccountId) : null;
}

export type UpdateOutcome =
  | { kind: "ok"; order: OrderDetail }
  | { kind: "conflict"; current: OrderDetail }
  | { kind: "not_found" }
  | { kind: "invalid"; message: string };

/**
 * The fields the mobile app may change — the same caps as the web admin's
 * cleanPatch. paymentStatus is deliberately NOT accepted: the web admin has no
 * control for it either, and "paid" must never be set by opening a screen.
 */
function mobilePatch(body: Partial<OrderUpdateRequest>): Prisma.StorefrontOrderUpdateInput | null {
  const data: Prisma.StorefrontOrderUpdateInput = {};
  if (body.status !== undefined) {
    if (!isOrderStatus(body.status)) return null;
    data.status = body.status;
  }
  if (typeof body.courier === "string") data.courier = body.courier.trim().slice(0, 120);
  if (typeof body.trackingNumber === "string") data.trackingNumber = body.trackingNumber.trim().slice(0, 120);
  if (typeof body.shippingNote === "string") data.shippingNote = body.shippingNote.slice(0, 500);
  return data;
}

export async function updateOrder(
  ctx: MobileContext,
  id: string,
  body: Record<string, unknown>,
): Promise<UpdateOutcome> {
  const expected = new Date(typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : "");
  if (Number.isNaN(expected.getTime())) {
    return { kind: "invalid", message: "Reload the order and try again." };
  }
  const patch = mobilePatch(body as Partial<OrderUpdateRequest>);
  if (!patch) return { kind: "invalid", message: "That status isn't available." };
  if (Object.keys(patch).length === 0) return { kind: "invalid", message: "Nothing to save." };

  const res = await applyOrderStatusChange(
    ctx.tenantId,
    id,
    patch as Prisma.StorefrontOrderUpdateInput & { status?: Order["status"] },
    ctx.slug,
    { expectedUpdatedAt: expected },
  );
  if (res.ok) return { kind: "ok", order: detailOf(ctx, res.order, res.updatedAt, res.customerAccountId) };
  if (res.conflict) return { kind: "conflict", current: detailOf(ctx, res.current, res.updatedAt, res.customerAccountId) };
  return { kind: "not_found" };
}

/** Soft-delete (Trash) — identical to trashStorefrontOrdersAction. Moves no stock. */
export async function trashOrder(ctx: MobileContext, id: string): Promise<boolean> {
  const res = await withTenant(ctx.tenantId, (db) =>
    db.storefrontOrder.updateMany({ where: { ...ACTIVE_ORDERS_WHERE, id }, data: { deletedAt: new Date() } }),
  );
  return res.count === 1;
}

/** Undo a trash — identical to restoreStorefrontOrdersAction. */
export async function restoreOrder(ctx: MobileContext, id: string): Promise<boolean> {
  const res = await withTenant(ctx.tenantId, (db) =>
    db.storefrontOrder.updateMany({ where: { ...TRASHED_ORDERS_WHERE, id }, data: { deletedAt: null } }),
  );
  return res.count === 1;
}
