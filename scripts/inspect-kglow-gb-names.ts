/** READ-ONLY: list k-glow products and the open group-buy round's assignment,
 *  so product names missing a dose ("mg") can be spotted. */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const SLUG = process.argv[2] ?? "k-glow";

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: SLUG },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) throw new Error(`no tenant ${SLUG}`);
  console.log(`tenant ${tenant.slug} (${tenant.id})`);

  const rounds = await prisma.groupBuy.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, status: true, productIds: true, createdAt: true },
  });
  console.log(`\n=== rounds (${rounds.length}) ===`);
  for (const r of rounds) {
    console.log(`${r.status.padEnd(10)} ${r.name} [${r.id}] products=${r.productIds.length}`);
  }

  const open = rounds.find((r) => r.status === "active" || r.status === "open") ?? rounds[0];

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, priceCents: true, stock: true, status: true, metadata: true },
  });

  console.log(`\n=== products (${products.length}) ===  [GB = in open round, !!! = no dose token]`);
  for (const p of products) {
    const assigned = open?.productIds.includes(p.id) ? "GB" : "  ";
    const hasDose = /\d\s*(mg|mcg|iu)\b/i.test(p.name) ? "   " : "!!!";
    const vars = (p.metadata as { variations?: { name?: string }[] } | null)?.variations;
    const varNames = vars?.length ? ` vars=[${vars.map((v) => v.name).join(" | ")}]` : "";
    console.log(`${assigned} ${hasDose} ${p.name}  <${p.id}> stock=${p.stock}${varNames}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
