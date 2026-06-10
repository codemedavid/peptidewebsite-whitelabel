/**
 * Seed the protocol guide for a storefront tenant into `branding.config`.
 *
 * Protocols are NOT a SQL table in this app — the storefront reads them from the
 * `Branding.config` JSON blob (key `protocols`), the same place the store admin
 * saves them. This script writes the shared SEED_PROTOCOLS list straight into
 * that blob so the rows show up as real, editable entries in the Protocols admin
 * — the owner can then keep them all or delete the ones they don't carry.
 *
 * Idempotent: it read-modify-writes only the `protocols` key, leaving the rest
 * of the storefront config untouched (mirrors saveProtocolsAction).
 *
 * These are the default protocols every store's protocol page shows. New
 * tenants pick them up automatically from SEED_PROTOCOLS (the code fallback);
 * this script back-fills the existing tenants so their pages match.
 *
 * Run from the project root:
 *   npx tsx scripts/seed-protocols.ts all        # every existing tenant
 *   npx tsx scripts/seed-protocols.ts my-tenant  # a single tenant slug
 *
 * WARNING: this REPLACES each target tenant's current protocol list with the
 * seed set. The store admin can then keep them all or delete the ones they
 * don't carry.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { SEED_PROTOCOLS } from "../src/storefront/data";

const prisma = new PrismaClient();

const TARGET = process.argv[2] ?? "all";

async function seedTenant(tenant: { id: string; name: string; slug: string }) {
  const branding = await prisma.branding.findUnique({
    where: { tenantId: tenant.id },
    select: { config: true },
  });
  const current = (branding?.config ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(current.protocols) ? current.protocols.length : 0;

  const config = { ...current, protocols: SEED_PROTOCOLS };
  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: { config: config as Prisma.InputJsonValue },
    create: { tenantId: tenant.id, config: config as Prisma.InputJsonValue },
  });

  const note = existing > 0 ? ` (replaced ${existing})` : "";
  console.log(`  ✓ ${tenant.slug} — ${tenant.name}: ${SEED_PROTOCOLS.length} protocols${note}`);
}

async function main() {
  const tenants =
    TARGET === "all"
      ? await prisma.tenant.findMany({ select: { id: true, name: true, slug: true } })
      : await prisma.tenant.findMany({
          where: { slug: TARGET },
          select: { id: true, name: true, slug: true },
        });

  if (tenants.length === 0) throw new Error(`No tenant matched "${TARGET}".`);
  console.log(`Seeding ${SEED_PROTOCOLS.length} protocols into ${tenants.length} tenant(s):`);

  for (const t of tenants) await seedTenant(t);

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
