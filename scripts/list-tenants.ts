/** READ-ONLY: list all tenant slugs for local dev access (slug.lvh.me:3100). */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

async function main() {
  const tenants = await prisma.tenant.findMany({
    select: { slug: true, name: true, status: true },
    orderBy: { slug: "asc" },
  });
  for (const t of tenants) console.log(`${t.slug}\t${t.status}\t${t.name}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
