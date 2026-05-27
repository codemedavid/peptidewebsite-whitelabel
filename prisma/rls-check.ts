/**
 * RLS acceptance check (Task B2). Proves the DB — not just the app — enforces
 * tenant isolation.
 *
 *   APP_DATABASE_URL=postgresql://app_user:...@host:6543/postgres?pgbouncer=true \
 *   DIRECT_URL=postgresql://postgres:...@host:5432/postgres \
 *   npm run db:rls:check
 *
 * It uses TWO connections:
 *   • admin — the privileged postgres role (DIRECT_URL), BYPASSRLS, to discover
 *     two real tenants + their data to test against.
 *   • app   — the restricted app_user role (APP_DATABASE_URL) the policies bind
 *     to. All assertions run on this connection.
 *
 * Exits non-zero (loudly) if any isolation guarantee is missing.
 */
import { PrismaClient } from "@prisma/client";

const ADMIN_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.APP_DATABASE_URL;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  if (!APP_URL) {
    throw new Error(
      "APP_DATABASE_URL is required (the app_user connection). See docs/RLS.md.",
    );
  }

  const admin = new PrismaClient({ datasourceUrl: ADMIN_URL });
  const app = new PrismaClient({ datasourceUrl: APP_URL });

  try {
    // Need two tenants with at least one product each to test cross-tenant reads.
    const tenants = await admin.tenant.findMany({ take: 2, select: { id: true, slug: true } });
    if (tenants.length < 2) {
      throw new Error(
        `Need >= 2 tenants seeded to test isolation (found ${tenants.length}). Run npm run db:seed.`,
      );
    }
    const [a, b] = tenants;
    const aCount = await admin.product.count({ where: { tenantId: a.id } });
    const bProduct = await admin.product.findFirst({ where: { tenantId: b.id }, select: { id: true } });

    console.log(`\nRLS check — tenant A=${a.slug} (${aCount} products), B=${b.slug}\n`);

    // 1. No GUC set → fails closed (0 rows), even though products exist.
    const [{ count: noGuc }] = await app.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM products`;
    check("no GUC set → 0 rows visible", Number(noGuc) === 0, `saw ${noGuc}`);

    // 2. GUC = A → sees exactly A's products (matches the privileged count).
    const visibleForA = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${a.id}, true)`;
      const [{ count }] = await tx.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM products`;
      return Number(count);
    });
    check("GUC = A → sees only A's products", visibleForA === aCount, `saw ${visibleForA}, expected ${aCount}`);

    // 3. GUC = A, fetch B's product by its exact id → invisible (0 rows).
    if (bProduct) {
      const leaked = await app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${a.id}, true)`;
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM products WHERE id = ${bProduct.id}`;
        return rows.length;
      });
      check("GUC = A → cannot read B's row by id", leaked === 0, `leaked ${leaked} rows`);
    }

    // 4. GUC = A, INSERT a row stamped tenant_id = B → rejected by WITH CHECK.
    let rejected = false;
    try {
      await app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${a.id}, true)`;
        await tx.$executeRaw`
          INSERT INTO products (id, "tenantId", sku, name, "priceCents")
          VALUES (${"rls-check-" + Date.now()}, ${b.id}, 'RLS-CHECK', 'rls', 1)`;
      });
    } catch {
      rejected = true;
    }
    check("GUC = A → INSERT stamped tenant B is rejected", rejected);

    // 5. GUC = A → tenants table shows only the caller's own row.
    const tenantsSeen = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${a.id}, true)`;
      const [{ count }] = await tx.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM tenants`;
      return Number(count);
    });
    check("GUC = A → tenants table exposes only self", tenantsSeen === 1, `saw ${tenantsSeen}`);
  } finally {
    await admin.$disconnect();
    await app.$disconnect();
  }

  console.log(failures === 0 ? "\nPASS — DB enforces tenant isolation.\n" : `\nFAIL — ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
