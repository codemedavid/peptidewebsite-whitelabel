import { prisma } from "@/lib/db/prisma";
import {
  formatOrderNumber,
  normalizeOrderNumberFormat,
  type OrderNumberFormat,
} from "./order-number-format";

/**
 * Server-side order-number generator (the real, DB-backed generator — A2/B-track).
 *
 * - sequential: atomically increments Tenant.orderSeq inside a transaction so two
 *   concurrent checkouts can never collide; the new counter value is the number.
 * - random: an N-digit code retried against the @@unique([tenantId, orderNumber])
 *   constraint until it doesn't collide.
 *
 * Each tenant has its own format and counter, so two tenants both produce ABC-1001.
 * Never call from the client.
 */

const RANDOM_MAX_RETRIES = 8;

function randomNumber(digits: number): number {
  // Uniform across the full padded width (leading zeros are fine — we zero-pad).
  return Math.floor(Math.random() * 10 ** digits);
}

export async function nextOrderNumber(tenantId: string): Promise<string> {
  if (!tenantId) throw new Error("nextOrderNumber() requires a tenantId");

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { name: true, orderNumberFormat: true },
  });
  const format = normalizeOrderNumberFormat(tenant.orderNumberFormat, tenant.name);

  if (format.scheme === "sequential") {
    // Atomic: the increment and read happen in one round-trip; the returned value
    // is unique per tenant by construction.
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: { orderSeq: { increment: 1 } },
      select: { orderSeq: true },
    });
    return formatOrderNumber(format, updated.orderSeq);
  }

  return nextRandom(tenantId, format);
}

async function nextRandom(tenantId: string, format: OrderNumberFormat): Promise<string> {
  for (let attempt = 0; attempt < RANDOM_MAX_RETRIES; attempt++) {
    const candidate = formatOrderNumber(format, randomNumber(format.digits));
    const clash = await prisma.order.findUnique({
      where: { tenantId_orderNumber: { tenantId, orderNumber: candidate } },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  throw new Error(
    `nextOrderNumber: exhausted ${RANDOM_MAX_RETRIES} attempts for tenant ${tenantId}; ` +
      `increase 'digits' in the order-number format to widen the keyspace.`,
  );
}
