/** READ-ONLY: list k-glow products and the open group-buy round's assignment,
 *  so product names missing a dose ("mg") can be spotted. */
import { PrismaClient } from "@prisma/client";
import { gbDisplayName } from "../src/lib/storefront/group-buy-page";

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
  // productIds is a Json column — normalise to a string[] before reading it.
  const idsOf = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

  console.log(`\n=== rounds (${rounds.length}) ===`);
  for (const r of rounds) {
    console.log(`${r.status.padEnd(10)} ${r.name} [${r.id}] products=${idsOf(r.productIds).length}`);
  }

  const open = rounds.find((r) => r.status === "active" || r.status === "open") ?? rounds[0];
  const openIds = new Set(idsOf(open?.productIds));

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, priceCents: true, stock: true, status: true, metadata: true },
  });

  console.log(`\n=== products (${products.length}) ===  [GB = in open round]`);
  console.log(`row name  →  what the group-buy card now shows (gbDisplayName)\n`);
  for (const p of products) {
    const assigned = openIds.has(p.id) ? "GB" : "  ";
    const vars =
      (p.metadata as { variations?: { name: string; price: number }[] } | null)?.variations ?? [];
    const shown = gbDisplayName(p.name, vars);
    const changed = shown === p.name ? "     " : " →   ";
    console.log(`${assigned}${changed}${p.name}${shown === p.name ? "" : `  →  ${shown}`}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
