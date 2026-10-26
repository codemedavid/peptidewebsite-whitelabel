import "server-only";

import { loadOrderList } from "@/lib/orders/order-list-cache";
import type { Order } from "@/storefront/types";
import type {
  CustomerDetailResponse,
  CustomerListResponse,
  InsightsRange,
  InsightsResponse,
} from "./contract";
import type { MobileContext } from "./auth";
import {
  aggregateCustomers,
  buildCustomerDetail,
  parseCustomerFilter,
  parseCustomerSort,
  queryCustomers,
  summarizeCustomers,
} from "./customers";
import { buildInsights } from "./insights";

/**
 * Tenant-scoped loaders for the Insights and Customers screens. Both are
 * computed from the store's own (non-trashed) orders — the tenant-scoped cached
 * order book, with the tenant taken from the authenticated session.
 *
 * One cached read, newest first, capped: new-vs-returning and customer history need
 * the whole book, and even the busiest store is well under the cap today.
 */

const MAX_ORDERS = 5000;
const MAX_CUSTOMERS = 200;
const MAX_QUERY = 80;

function currencyOf(ctx: MobileContext): unknown {
  const config = ctx.tenant.branding?.config;
  return config && typeof config === "object" ? (config as Record<string, unknown>).currency : undefined;
}

// Read through the website's cached order book (lib/orders/order-list-cache)
// rather than the DB: Insights, Customers and every Customers search used to
// re-read the whole book. Re-sorted by placed date, the order these screens use.
async function loadOrders(ctx: MobileContext): Promise<Order[]> {
  const orders = await loadOrderList(ctx.tenantId, "active");
  return orders
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, MAX_ORDERS);
}

export async function getInsights(ctx: MobileContext, range: InsightsRange): Promise<InsightsResponse> {
  const orders = await loadOrders(ctx);
  return buildInsights(orders, orders, { range, now: new Date(), currency: currencyOf(ctx) });
}

export async function listCustomers(ctx: MobileContext, params: URLSearchParams): Promise<CustomerListResponse> {
  const now = new Date();
  const rows = aggregateCustomers(await loadOrders(ctx), { now, currency: currencyOf(ctx) });
  const customers = queryCustomers(rows, {
    q: (params.get("q") ?? "").slice(0, MAX_QUERY),
    sort: parseCustomerSort(params.get("sort")),
    segment: parseCustomerFilter(params.get("segment")),
  }).slice(0, MAX_CUSTOMERS);
  return { summary: summarizeCustomers(rows, now), customers };
}

export async function getCustomer(ctx: MobileContext, key: string): Promise<CustomerDetailResponse | null> {
  return buildCustomerDetail(await loadOrders(ctx), key, { now: new Date(), currency: currencyOf(ctx) });
}
