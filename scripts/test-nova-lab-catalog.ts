/**
 * DB gate for the Nova Lab retail catalog: asserts the tenant's products match
 * the owner's "WEBSITE w/BAC SRP" pricelist
 * (scripts/nova-lab-pricelist.ts) row for row.
 *
 *   npm run test:nova-lab-catalog
 *
 * Covers, per pricelist row: the product exists, is live (active + status
 * "active"), carries the exact SRP in centavos, prices in PHP with the ₱ display
 * symbol, has dropped the price-on-request flag it was created with, is
 * buyable (real stock or made-to-order), and states the BAC inclusion in its
 * description. Plus catalog-wide: superseded doses are hidden, no live product
 * is left at ₱0, no live product sits outside the pricelist, and every live
 * product's metadata.category is a category *id* — a label like "Peptides"
 * silently matches no chip, so the category filter would return nothing.
 */
import { PrismaClient } from "@prisma/client";
import {
  NOVA_LAB_PRICELIST,
  NOVA_LAB_SUPERSEDED,
  NOVA_LAB_CATEGORY,
  NOVA_LAB_CURRENCY_SYMBOL,
  pricelistDescription,
} from "./nova-lab-pricelist";
import { SEED_CATEGORIES } from "../src/storefront/data";

const TENANT_SLUG = "nova-lab";

let failures = 0;
let checks = 0;

function ok(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  ok(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);

  const rows = await prisma.product.findMany({ where: { tenantId: tenant.id } });
  const bySlug = new Map(rows.map((r) => [r.slug ?? "", r]));
  const meta = (r: (typeof rows)[number]) => (r.metadata ?? {}) as Record<string, unknown>;

  console.log(`Nova Lab catalog vs. pricelist (${rows.length} products in DB)\n`);

  for (const row of NOVA_LAB_PRICELIST) {
    const p = bySlug.get(row.slug);
    if (!p) {
      ok(`${row.name} exists`, false, `no product with slug "${row.slug}"`);
      continue;
    }
    const m = meta(p);
    eq(`${row.name} — name`, p.name, row.name);
    eq(`${row.name} — price`, p.priceCents, row.price * 100);
    eq(`${row.name} — currency`, p.currency, "PHP");
    eq(`${row.name} — display symbol`, m.currencySymbol, NOVA_LAB_CURRENCY_SYMBOL);
    ok(`${row.name} — live on the storefront`, p.active && p.status === "active", `active=${p.active} status=${p.status}`);
    ok(`${row.name} — no longer price-on-request`, m.priceOnRequest !== true);
    ok(
      `${row.name} — buyable`,
      p.stock > 0 || m.madeToOrder === true,
      `stock=${p.stock} madeToOrder=${String(m.madeToOrder)}`,
    );
    eq(`${row.name} — description`, p.description, pricelistDescription(row));
  }

  // ── Catalog-wide invariants ────────────────────────────────────────────────
  console.log("");
  const live = rows.filter((r) => r.active && r.status === "active");
  const priced = new Set(NOVA_LAB_PRICELIST.map((r) => r.slug));

  for (const slug of NOVA_LAB_SUPERSEDED) {
    const p = bySlug.get(slug);
    ok(
      `superseded "${slug}" hidden from the storefront`,
      !!p && !p.active && p.status !== "active",
      p ? `active=${p.active} status=${p.status}` : "row missing entirely",
    );
  }

  eq(
    "no live product left at ₱0",
    live.filter((r) => r.priceCents <= 0).map((r) => r.slug),
    [],
  );
  eq(
    "no live product outside the pricelist",
    live.filter((r) => !priced.has(r.slug ?? "")).map((r) => r.slug),
    [],
  );

  // A product storing the category *label* matches no chip, so the filter
  // returns an empty catalog. Ids only.
  const validIds = new Set(SEED_CATEGORIES.map((c) => c.id));
  eq(
    "every live product filed under a real category id",
    live.filter((r) => !validIds.has(String(meta(r).category ?? ""))).map((r) => `${r.slug}:${String(meta(r).category)}`),
    [],
  );
  eq(
    "catalog category is the expected one",
    [...new Set(live.map((r) => String(meta(r).category)))],
    [NOVA_LAB_CATEGORY],
  );

  console.log(`\n${checks} checks, ${failures} failure(s)`);
  if (failures > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
