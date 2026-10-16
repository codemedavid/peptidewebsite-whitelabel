import "server-only";

import type { TenantTx } from "@/lib/db/tenant-client";
import { resolveGroupBuyCaps } from "@/lib/storefront/group-buy-server";
import type { RoundRow } from "./order-rounds";

/** The GroupBuy rows behind a set of order round ids (no ids → no query). */
export async function loadRoundRows(db: TenantTx, ids: string[]): Promise<RoundRow[]> {
  if (ids.length === 0) return [];
  return db.groupBuy.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: {
      id: true,
      name: true,
      batchNumber: true,
      status: true,
      startsAt: true,
      endsAt: true,
      closedAt: true,
      deliveryEta: true,
      createdAt: true,
    },
  });
}

/**
 * Whether scheduled windows are on for the tenant — it decides when a
 * scheduled round counts as live. Call it OUTSIDE withTenant: entitlements use
 * their own connection. Skipped when there are no rounds to judge.
 */
export async function scheduledRoundsOn(tenantId: string, rows: RoundRow[]): Promise<boolean> {
  if (!rows.some((r) => r.status === "scheduled")) return false;
  return (await resolveGroupBuyCaps(tenantId)).scheduled;
}
