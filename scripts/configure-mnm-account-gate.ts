/**
 * ONE-SHOT for `mnm-pepsabuy` (2026-11-03): owner asked for Login / Create
 * account as the landing page. Sets branding.config.accountGate.enabled = true
 * (the store-admin Customers → "Members-only store" switch). Only takes effect
 * with storefront.customer_accounts granted. Reverse: the same switch in the
 * store admin, or re-run with --off.
 *
 *   npx tsx --env-file=.env scripts/configure-mnm-account-gate.ts [--off]
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});
const ENABLED = !process.argv.includes("--off");

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: "mnm-pepsabuy" },
    select: { id: true, branding: { select: { config: true } } },
  });
  if (!tenant) throw new Error("tenant mnm-pepsabuy not found");
  const config = (tenant.branding?.config ?? {}) as Record<string, unknown>;
  console.log("before accountGate:", JSON.stringify(config.accountGate));
  const next = { ...config, accountGate: { enabled: ENABLED } };
  await prisma.branding.update({ where: { tenantId: tenant.id }, data: { config: next as Prisma.InputJsonValue } });
  console.log("after  accountGate:", JSON.stringify(next.accountGate));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
