/**
 * ONE-SHOT FIX: remove the stray `reseller` wholesale tier from pepstack-davao's
 * "GHK-Cu 50mg (Vial + 10ml Bac)" product metadata (vialsOnly=2 @ minQty=10 —
 * mis-entered data that made the cart sell at ₱2/ea in bulk while the
 * Reseller portal feature was disabled). Prints before/after; touches only
 * products whose metadata carries a reseller key.
 *
 *   npx tsx scripts/fix-pepstack-reseller.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});
async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: "pepstack-davao" } });
  if (!tenant) throw new Error("pepstack-davao not found");
  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true, metadata: true },
  });
  for (const p of products) {
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    if (!("reseller" in meta)) continue;
    console.log(`BEFORE ${p.name}: reseller=${JSON.stringify(meta.reseller)}`);
    const { reseller: _drop, ...rest } = meta;
    await prisma.product.update({
      where: { id: p.id },
      data: { metadata: rest as Prisma.InputJsonValue },
    });
    console.log(`AFTER  ${p.name}: reseller removed`);
  }
  console.log("done");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
