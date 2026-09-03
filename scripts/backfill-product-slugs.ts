/**
 * Give every product a slug, so every product has a shareable link.
 *
 * WHY: `Product.slug` is nullable and is only generated on the CREATE path
 * (src/actions/products.ts). Anything that reached the table another way — the
 * 88-product Dragon Peptides import, bulk seeds, the legacy migrations — has
 * none. Those products still LINK (product-link.ts falls back to the row id),
 * but the link an owner sends reads:
 *
 *     /p/clx7f2q90000abcd1234efgh      instead of      /p/retatrutide-10mg
 *
 * The id form works forever and is never broken by this script: findProductByLinkKey
 * and the /p/[slug] route both match slug OR id, so links already sent keep
 * resolving after the backfill gives their product a real slug.
 *
 * Slugs are issued with the SAME slugify + uniqueize pair the create path uses,
 * and uniqueness is resolved per tenant against the slugs already taken there,
 * so this can never collide with one the app has issued (the DB enforces
 * @@unique([tenantId, slug]) underneath either way).
 *
 * Products that already have a slug are never touched — a slug is a public URL,
 * and rewriting one silently breaks every link already sent.
 *
 * SAFE BY DEFAULT — dry run unless `--apply` is passed:
 *   npx tsx scripts/backfill-product-slugs.ts              # print plan
 *   npx tsx scripts/backfill-product-slugs.ts --apply      # write
 *   npx tsx scripts/backfill-product-slugs.ts --tenant k-glow
 */

import "dotenv/config";

import { prisma } from "../src/lib/db/prisma";
import { slugify, uniqueize } from "../src/lib/storefront/product-mapping";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const tenantArg = argv.indexOf("--tenant");
const TENANT_SLUG = tenantArg >= 0 ? argv[tenantArg + 1] : undefined;

async function main() {
  const products = await prisma.product.findMany({
    where: TENANT_SLUG ? { tenant: { slug: TENANT_SLUG } } : {},
    select: {
      id: true,
      name: true,
      slug: true,
      tenantId: true,
      tenant: { select: { slug: true } },
    },
    // Oldest first, so a stable, reproducible order decides who gets the bare
    // slug and who gets "-2" when two products share a name.
    orderBy: [{ tenantId: "asc" }, { createdAt: "asc" }],
  });

  // Slugs already taken, per tenant — seeded from the rows that have one so a
  // generated slug can never collide with a slug the app issued.
  const taken = new Map<string, Set<string>>();
  for (const p of products) {
    if (!taken.has(p.tenantId)) taken.set(p.tenantId, new Set());
    const slug = (p.slug ?? "").trim();
    if (slug) taken.get(p.tenantId)!.add(slug);
  }

  const planned: { id: string; slug: string; line: string }[] = [];
  let alreadySet = 0;

  for (const p of products) {
    if ((p.slug ?? "").trim()) {
      alreadySet++;
      continue;
    }
    const set = taken.get(p.tenantId)!;
    const slug = uniqueize(slugify(p.name), set);
    // Claim it immediately so the next same-named product in this run gets "-2"
    // rather than colliding at write time.
    set.add(slug);
    planned.push({
      id: p.id,
      slug,
      line: `  ${p.tenant.slug.padEnd(18)} ${p.name.slice(0, 42).padEnd(44)} → ${slug}`,
    });
  }

  console.log(`\nProduct slug backfill${TENANT_SLUG ? ` — tenant ${TENANT_SLUG}` : ""}\n`);
  console.log(`  scanned:      ${products.length}`);
  console.log(`  already set:  ${alreadySet}`);
  console.log(`  to backfill:  ${planned.length}\n`);

  if (planned.length === 0) {
    console.log("Nothing to do.\n");
    return;
  }

  for (const p of planned) console.log(p.line);

  if (!APPLY) {
    console.log(`\nDry run — re-run with --apply to write ${planned.length} slug(s).\n`);
    return;
  }

  let written = 0;
  let failed = 0;
  for (const p of planned) {
    try {
      await prisma.product.update({ where: { id: p.id }, data: { slug: p.slug } });
      written++;
    } catch (e) {
      // A unique-constraint loss to a concurrent write is survivable: that
      // product keeps its id-based link and the next run picks it up.
      failed++;
      console.error(`  ✗ ${p.slug} — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\nWrote ${written} slug(s)${failed ? `, ${failed} failed` : ""}.`);
  // Cached pages hold the old rows: a direct-Prisma script cannot bust
  // `unstable_cache`, so the storefront serves slugless products (id links)
  // until a tenant mutation revalidates or the server restarts. Links minted
  // from those stale rows still resolve — both keys work — so this is a cosmetic
  // delay, not a broken window.
  console.log("Storefront caches revalidate on the next tenant save or restart.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
