/**
 * Two-tenant isolation test (Task B4) — the release gate for tenant isolation.
 *
 * Self-contained: spins up an in-process Postgres (PGlite, WASM) and applies the
 * real schema + RLS, so it runs anywhere with NO Docker / Supabase / network.
 * Run with:  npm run test:isolation
 *
 * It seeds two tenants (A and B) with deliberately OVERLAPPING data — same SKUs,
 * slugs, distinctIds, order/contact identities — then proves a query for A can
 * never see B (and vice-versa) across every layer:
 *
 *   Layer 1 — forTenant() Prisma extension (src/lib/db/tenant-client.ts), the
 *     active primary defense. Products / orders / media / analytics return only
 *     the bound tenant; a query that forges the other tenant's id in `where`
 *     is overridden, not honored.
 *   Request layer — middleware (src/middleware.ts) strips client-supplied
 *     x-tenant-id / x-tenant-slug, so a request forging another tenant's id
 *     cannot influence resolution; only the host-derived x-tenant-host is trusted.
 *   Storage — one tenant's media URLs never reference another tenant's path.
 *   Layer 2 — Postgres RLS (prisma/roles.sql + prisma/rls.sql) under the
 *     restricted, non-superuser `app_user` role: fails closed with no GUC set,
 *     and blocks cross-tenant reads AND writes at the database itself.
 *
 * Because the assertions run the REAL forTenant() and the REAL rls.sql, the test
 * FAILS LOUDLY (exit 1) if a tenantId filter or an RLS policy is ever removed.
 *
 * NOTE on Layer 2 in PGlite: PGlite's bootstrap user is a superuser (BYPASSRLS),
 * exactly like the privileged `postgres` role used for migrations/seeds. We
 * therefore SET ROLE to the seeded non-superuser `app_user` before the RLS
 * assertions, mirroring how the app connects in production. (See prisma/rls-check.ts
 * for the same checks run against a real Supabase Postgres once B1/B2 are live.)
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";

const ROOT = process.cwd();
const SCHEMA = path.join(ROOT, "prisma", "schema.prisma");
const ROLES_SQL = path.join(ROOT, "prisma", "roles.sql");
const RLS_SQL = path.join(ROOT, "prisma", "rls.sql");

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? passed++ : failed++;
}
function eq<T>(name: string, got: T, want: T) {
  check(name, Object.is(got, want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
function section(title: string) {
  console.log(`\n${title}`);
}

// ──────────────────────────── shared setup ──────────────────────────────────

/** Full CREATE TABLE … DDL for the current schema, generated offline (no DB). */
function schemaDdl(): string {
  return execSync(
    `npx prisma migrate diff --from-empty --to-schema-datamodel "${SCHEMA}" --script`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
}

async function newPg(ddl: string, withRls: boolean): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(ddl);
  if (withRls) {
    await pg.exec(readFileSync(ROLES_SQL, "utf8"));
    await pg.exec(readFileSync(RLS_SQL, "utf8"));
  }
  return pg;
}

/** A Prisma client backed by the in-process PGlite instance. */
function clientFor(pg: PGlite): PrismaClient {
  // pglite-prisma-adapter targets a newer @prisma/driver-adapter-utils than the
  // installed @prisma/client; the runtime shapes match, so bridge the type skew.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaPGlite(pg) as any;
  return new PrismaClient({ adapter });
}

type Seeded = {
  A: string;
  B: string;
  bProductId: string;
  counts: { products: number; orders: number; media: number; events: number };
};

/**
 * Seed two tenants with OVERLAPPING data via the raw (un-scoped) client — so the
 * rows genuinely coexist in one table and the isolation assertions are meaningful.
 * A gets two products / two orders / two media / three events; B gets one of each,
 * reusing A's SKU, slug, distinctId, contact email — i.e. the values overlap but
 * the rows must never cross.
 */
async function seed(db: PrismaClient): Promise<Seeded> {
  const plan = await db.plan.create({ data: { key: "growth", name: "Automated Growth" } });
  const A = await db.tenant.create({ data: { name: "Acme Peptides", slug: "acme", planId: plan.id } });
  const B = await db.tenant.create({ data: { name: "Rival Labs", slug: "rival", planId: plan.id } });

  // Products — same SKU + slug across tenants (allowed: unique is [tenantId, sku]).
  await db.product.create({ data: { tenantId: A.id, sku: "BPC-157-5MG", slug: "bpc-157", name: "A · BPC-157", priceCents: 4999 } });
  await db.product.create({ data: { tenantId: A.id, sku: "TB-500-5MG", slug: "tb-500", name: "A · TB-500", priceCents: 5999 } });
  const bProduct = await db.product.create({ data: { tenantId: B.id, sku: "BPC-157-5MG", slug: "bpc-157", name: "B · BPC-157", priceCents: 9999 } });

  // Orders — overlapping distinctId; orderNumber is unique per [tenantId, orderNumber],
  // so both tenants can reuse the same formatted code.
  await db.order.create({ data: { tenantId: A.id, distinctId: "visitor-42", orderNumber: "ORD-1001", totalCents: 4999 } });
  await db.order.create({ data: { tenantId: A.id, distinctId: "visitor-42", orderNumber: "ORD-1002", totalCents: 5999 } });
  await db.order.create({ data: { tenantId: B.id, distinctId: "visitor-42", orderNumber: "ORD-1001", totalCents: 9999 } });

  // Contacts — overlapping identity.
  await db.contact.create({ data: { tenantId: A.id, distinctId: "visitor-42", email: "buyer@example.com" } });
  await db.contact.create({ data: { tenantId: B.id, distinctId: "visitor-42", email: "buyer@example.com" } });

  // Media — namespaced per tenant under tenant/<tenantId>/… (see Task B3).
  for (const name of ["logo.png", "hero.jpg"]) {
    await db.mediaAsset.create({
      data: { tenantId: A.id, imagekitId: `tenant/${A.id}/${name}`, url: `https://ik.imagekit.io/demo/tenant/${A.id}/${name}`, type: "image" },
    });
  }
  await db.mediaAsset.create({
    data: { tenantId: B.id, imagekitId: `tenant/${B.id}/logo.png`, url: `https://ik.imagekit.io/demo/tenant/${B.id}/logo.png`, type: "image" },
  });

  // Analytics — raw events + pre-aggregated metric, same period/name across tenants.
  let n = 0;
  for (const t of [A.id, A.id, A.id, B.id, B.id]) {
    await db.event.create({ data: { id: `evt_${n++}`, tenantId: t, distinctId: "visitor-42", name: "product_viewed" } });
  }
  await db.automationMetric.create({ data: { tenantId: A.id, period: "2026-05", emailsSent: 10 } });
  await db.automationMetric.create({ data: { tenantId: B.id, period: "2026-05", emailsSent: 99 } });

  return { A: A.id, B: B.id, bProductId: bProduct.id, counts: { products: 2, orders: 2, media: 2, events: 3 } };
}

// ──────────────────────────── Suite 1: forTenant() (Layer 1) ────────────────

async function suiteAppLayer(ddl: string) {
  const pg = await newPg(ddl, /* withRls */ false);
  const db = clientFor(pg);

  // Inject our PGlite-backed client as the app singleton BEFORE importing the
  // tenant client, so forTenant() exercises the REAL extension against this DB.
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  const { forTenant } = await import("../src/lib/db/tenant-client");

  const { A, B, counts } = await seed(db);
  const a = forTenant(A);
  const b = forTenant(B);

  section("Layer 1 — forTenant() returns ONLY the bound tenant's rows");
  const allTenant = <T extends { tenantId: string }>(rows: T[], id: string) => rows.every((r) => r.tenantId === id);

  const aProducts = await a.product.findMany();
  eq("products: A count", aProducts.length, counts.products);
  check("products: every row belongs to A", allTenant(aProducts, A));
  check("products: A never sees B's product", !aProducts.some((p) => p.name.startsWith("B ·")));
  eq("products: A count() agrees", await a.product.count(), counts.products);

  const aOrders = await a.order.findMany();
  eq("orders: A count", aOrders.length, counts.orders);
  check("orders: every row belongs to A", allTenant(aOrders, A));

  const aMedia = await a.mediaAsset.findMany();
  eq("media: A count", aMedia.length, counts.media);
  check("media: every row belongs to A", allTenant(aMedia, A));

  const aEvents = await a.event.findMany();
  eq("analytics(events): A count", aEvents.length, counts.events);
  check("analytics(events): every row belongs to A", allTenant(aEvents, A));

  const aMetrics = await a.automationMetric.findMany();
  eq("analytics(metric): A count", aMetrics.length, 1);
  eq("analytics(metric): A sees its own value (10), not B's (99)", aMetrics[0]?.emailsSent, 10);

  const aContacts = await a.contact.findMany();
  check("contacts: every row belongs to A", allTenant(aContacts, A));

  // Sanity: the data genuinely overlaps, so the assertions above are meaningful.
  // (Un-scoped, both tenants' rows coexist; if the filter were removed, the
  // scoped reads above would return these larger counts and fail.)
  const rawProducts = await db.product.count();
  check("sanity: un-scoped sees BOTH tenants (filter is doing work)", rawProducts > counts.products, `raw=${rawProducts} scoped=${counts.products}`);

  section("Forged tenant id in query args is OVERRIDDEN, not honored");
  const forgedProducts = await a.product.findMany({ where: { tenantId: B } as never });
  eq("products: forge where.tenantId=B while scoped to A → still A's count", forgedProducts.length, counts.products);
  check("products: forged read returns only A's rows", allTenant(forgedProducts, A));
  eq("products: forged count() → A's count", await a.product.count({ where: { tenantId: B } as never }), counts.products);
  const forgedOrders = await a.order.findMany({ where: { tenantId: B } as never });
  check("orders: forged read returns only A's rows", forgedOrders.length === counts.orders && allTenant(forgedOrders, A));

  section("Image URLs never cross tenants");
  const aRefs = aMedia.flatMap((m) => [m.url, m.imagekitId]);
  check("A's media all live under tenant/<A>/", aRefs.every((r) => r.includes(`tenant/${A}/`)));
  check("A's media never reference B's id or path", !aRefs.some((r) => r.includes(B)));
  const bMedia = await b.mediaAsset.findMany();
  const bRefs = bMedia.flatMap((m) => [m.url, m.imagekitId]);
  check("B's media all live under tenant/<B>/ and never reference A", bRefs.every((r) => r.includes(`tenant/${B}/`)) && !bRefs.some((r) => r.includes(A)));

  await db.$disconnect();
  return { A, B };
}

// ──────────────────────────── Suite 2: middleware (request layer) ──────────

async function suiteMiddleware(realTenantId: string) {
  section("Request layer — middleware strips a forged tenant id");
  const { middleware } = await import("../src/middleware");
  const { NextRequest } = await import("next/server");

  const req = new NextRequest("http://acme.localhost:3000/", {
    headers: { host: "acme.localhost:3000", "x-tenant-id": realTenantId, "x-tenant-slug": "rival" },
  });
  const res = await middleware(req as never);
  const h = (res as { headers: Headers }).headers;
  const overrides = (h.get("x-middleware-override-headers") ?? "").split(",").map((s) => s.trim());

  check("forged x-tenant-id is NOT forwarded to the app", h.get("x-middleware-request-x-tenant-id") === null);
  check("forged x-tenant-slug is NOT forwarded to the app", h.get("x-middleware-request-x-tenant-slug") === null);
  check("x-tenant-id / x-tenant-slug absent from forwarded header set", !overrides.includes("x-tenant-id") && !overrides.includes("x-tenant-slug"));
  eq("only the host-derived x-tenant-host is trusted", h.get("x-middleware-request-x-tenant-host"), "acme.localhost");
}

// ──────────────────────────── Suite 3: Postgres RLS (Layer 2) ──────────────

async function suiteRls(ddl: string) {
  section("Layer 2 — Postgres RLS enforces isolation under the app_user role");
  let pg: PGlite;
  try {
    pg = await newPg(ddl, /* withRls */ true);
  } catch (e) {
    check("roles.sql + rls.sql apply cleanly", false, (e as Error).message.split("\n")[0]);
    return;
  }
  check("roles.sql + rls.sql apply cleanly", true);

  // Seed as the privileged (superuser, BYPASSRLS) connection — like migrations.
  const db = clientFor(pg);
  const { A, B, bProductId, counts } = await seed(db);

  // Drop to the restricted role the policies bind to. From here, RLS applies.
  await pg.exec("SET ROLE app_user");
  const who = (await pg.query<{ current_user: string }>("SELECT current_user")).rows[0].current_user;
  eq("connection is now the non-superuser app_user", who, "app_user");

  // Run each check in its own transaction so a set_config(.., true) is scoped to
  // it and a rejected write can't poison later checks.
  async function withGuc<T>(tenantId: string | null, fn: () => Promise<T>): Promise<T> {
    await pg.exec("BEGIN");
    try {
      if (tenantId !== null) await pg.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      return await fn();
    } finally {
      await pg.exec("ROLLBACK");
    }
  }
  const count = async (sql: string) => Number((await pg.query<{ c: number }>(sql)).rows[0].c);

  const noGuc = await withGuc(null, () => count("SELECT count(*)::int c FROM products"));
  eq("no GUC set → fails closed (0 products visible)", noGuc, 0);

  const aVisible = await withGuc(A, () => count("SELECT count(*)::int c FROM products"));
  eq("GUC=A → sees exactly A's products", aVisible, counts.products);

  const leaked = await withGuc(A, async () =>
    (await pg.query<{ id: string }>("SELECT id FROM products WHERE id = $1", [bProductId])).rows.length,
  );
  eq("GUC=A → cannot read B's product by its id", leaked, 0);

  const tenantsSeen = await withGuc(A, () => count("SELECT count(*)::int c FROM tenants"));
  eq("GUC=A → tenants table exposes only A", tenantsSeen, 1);

  let writeRejected = false;
  await withGuc(A, async () => {
    try {
      await pg.query(
        `INSERT INTO products (id, "tenantId", sku, name, "priceCents") VALUES ($1, $2, 'X', 'x', 1)`,
        [`leak_${Date.now()}`, B],
      );
    } catch {
      writeRejected = true;
    }
  });
  check("GUC=A → INSERT stamped tenant B is rejected by WITH CHECK", writeRejected);

  await pg.exec("RESET ROLE");
  await db.$disconnect();
}

// ──────────────────────────── run ───────────────────────────────────────────

async function main() {
  console.log("Two-tenant isolation test (B4) — in-process Postgres (PGlite)\n" + "=".repeat(60));
  const ddl = schemaDdl();

  const { A } = await suiteAppLayer(ddl);
  await suiteMiddleware(A);
  await suiteRls(ddl);

  console.log("\n" + "=".repeat(60));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("ISOLATION TEST FAILED — do not ship.");
    process.exit(1);
  }
  console.log("ISOLATION HOLDS — tenant data does not cross.");
  process.exit(0);
}

main().catch((e) => {
  console.error("\nIsolation test crashed:\n", e);
  process.exit(1);
});
