/**
 * READ-ONLY: print each peppies-intl product's price, isSet, and reseller tier
 * from metadata — to confirm the wholesale data the cart logic will rely on.
 *
 *   npx tsx scripts/inspect-peppies-reseller.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});
const TENANT_SLUG = "peppies-intl";

async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 5): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.warn(`  …${label} ${i}/${tries} failed`);
    }
  }
  throw last;
}

async function main() {
  const tenant = await withRetry("connect", () =>
    prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } }),
  );
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})\n`);

  const products = await withRetry("load", () =>
    prisma.product.findMany({
      where: { tenantId: tenant.id },
      orderBy: { name: "asc" },
      select: { name: true, priceCents: true, metadata: true },
    }),
  );

  for (const p of products) {
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    const r = meta.reseller as { vialsOnly?: number; completeSet?: number } | undefined;
    const isSet = meta.isSet === true;
    const retail = (p.priceCents ?? 0) / 100;
    const resStr = r
      ? `vialsOnly=${r.vialsOnly ?? "—"} completeSet=${r.completeSet ?? "—"}`
      : "(none)";
    console.log(`${p.name.padEnd(28)} retail=${String(retail).padStart(6)}  isSet=${isSet ? "Y" : "n"}  reseller: ${resStr}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
