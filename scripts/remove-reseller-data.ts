/**
 * ONE-SHOT FIX: remove the `reseller` wholesale tier from every product of the
 * tenant slugs passed as CLI args. Prints before/after per product. Generalizes
 * scripts/fix-pepstack-reseller.ts (the pepstack-davao one-off).
 *
 *   npx tsx scripts/remove-reseller-data.ts <slug> [<slug> ...]
 */
import { PrismaClient, Prisma } from "@prisma/client";
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});
async function main() {
  const slugs = process.argv.slice(2);
  if (slugs.length === 0) throw new Error("usage: npx tsx scripts/remove-reseller-data.ts <slug> [...]");
  for (const slug of slugs) {
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) { console.error(`SKIP ${slug}: tenant not found`); continue; }
    const products = await prisma.product.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, name: true, metadata: true },
    });
    let removed = 0;
    for (const p of products) {
      const meta = (p.metadata ?? {}) as Record<string, unknown>;
      if (!("reseller" in meta)) continue;
      console.log(`${slug} BEFORE ${p.name}: reseller=${JSON.stringify(meta.reseller)}`);
      const { reseller: _drop, ...rest } = meta;
      await prisma.product.update({
        where: { id: p.id },
        data: { metadata: rest as Prisma.InputJsonValue },
      });
      removed++;
    }
    console.log(`${slug}: reseller data removed from ${removed} product(s)`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
