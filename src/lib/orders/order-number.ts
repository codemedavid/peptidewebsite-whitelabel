import type { TenantTx } from "@/lib/db/tenant-client";
import { formatOrderNumber, normalizeOrderNumberFormat } from "./order-number-format";

/**
 * Server-side, per-tenant order-number generator (the real, DB-backed one).
 *
 * MUST be called with the tenant-scoped client from inside withTenant(), so:
 *   - the atomic Tenant.orderSeq increment runs under the tenant's RLS policy
 *     (app.tenant_id is set on the connection — the bare prisma client would be
 *     blocked by FORCE ROW LEVEL SECURITY on `tenants`), and
 *   - the collision check is scoped to the calling tenant.
 *
 * - sequential: atomically increments Tenant.orderSeq inside the surrounding
 *   transaction; the new counter value IS the number. Concurrent checkouts for
 *   the same tenant serialize on the tenant row, so they can never collide, and
 *   each tenant has its own counter — orders on tenant A never advance tenant
 *   B's sequence.
 * - random: an N-digit code retried against the per-tenant
 *   @@unique([tenantId, orderNumber]) on storefront_orders until it doesn't clash.
 *
 * Never call from the client.
 */

const RANDOM_MAX_RETRIES = 8;

function randomNumber(digits: number): number {
  // Uniform across the full padded width (leading zeros are fine — we zero-pad).
  return Math.floor(Math.random() * 10 ** digits);
}

export async function generateStorefrontOrderNumber(
  db: TenantTx,
  tenantId: string,
): Promise<string> {
  if (!tenantId) throw new Error("generateStorefrontOrderNumber() requires a tenantId");

  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { name: true, orderNumberFormat: true },
  });
  const format = normalizeOrderNumberFormat(tenant.orderNumberFormat, tenant.name);

  if (format.scheme === "sequential") {
    // Atomic per-tenant: the UPDATE takes a row lock on this tenant's row, so the
    // returned counter is unique to this tenant by construction even under
    // concurrent checkouts.
    const updated = await db.tenant.update({
      where: { id: tenantId },
      data: { orderSeq: { increment: 1 } },
      select: { orderSeq: true },
    });
    return formatOrderNumber(format, updated.orderSeq);
  }

  for (let attempt = 0; attempt < RANDOM_MAX_RETRIES; attempt++) {
    const candidate = formatOrderNumber(format, randomNumber(format.digits));
    // Check the table storefront checkout actually writes to (StorefrontOrder),
    // NOT the separate Stripe/analytics Order model.
    const clash = await db.storefrontOrder.findUnique({
      where: { tenantId_orderNumber: { tenantId, orderNumber: candidate } },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  throw new Error(
    `generateStorefrontOrderNumber: exhausted ${RANDOM_MAX_RETRIES} attempts for tenant ${tenantId}; ` +
      `increase 'digits' in the order-number format to widen the keyspace.`,
  );
}
