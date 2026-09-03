/**
 * Enter the owner's "WEBSITE w/BAC SRP" pricelist into tenant `nova-lab`.
 *
 *   npx tsx scripts/seed-nova-lab-pricelist.ts
 *   npm run test:nova-lab-catalog   # verifies the result
 *
 * Idempotent: upserts each pricelist row by (tenantId, slug) through the app's
 * own `productToDbWrite`, so metadata is packed exactly the way the storefront
 * and store admin read it back.
 *
 * Three things this does beyond a plain price fill:
 *  - Keeps the photos. The nine products the owner already created carry
 *    uploaded ImageKit assets; the mapper would blank `images` for any product
 *    it isn't handed an image for, so the existing one is read first and passed
 *    back through.
 *  - Clears `priceOnRequest`. Those nine were created price-on-request, which
 *    outranks the price on every surface — a real SRP has to switch it off.
 *  - Files products under the category *id* ("peptides"), not the label
 *    ("Peptides"). The catalog filters `product.category === chip.id`, so a
 *    label matches no chip and the category filter comes back empty.
 *
 * Doses the sheet supersedes (Tesamorelin 5mg, MOTS-c 10mg) are set to draft
 * rather than deleted: they keep their photos and the owner can restore them.
 */
import { PrismaClient } from "@prisma/client";
import {
  productToDbWrite,
  currencySymbolToIso,
  slugify,
} from "../src/lib/storefront/product-mapping";
import type { Product } from "../src/storefront/types";
import {
  NOVA_LAB_PRICELIST,
  NOVA_LAB_SUPERSEDED,
  NOVA_LAB_CATEGORY,
  NOVA_LAB_CURRENCY_SYMBOL as SYMBOL,
  NOVA_LAB_STOCK as STOCK,
  pricelistDescription,
  type PricelistRow,
} from "./nova-lab-pricelist";

const TENANT_SLUG = "nova-lab";

const prisma = new PrismaClient();

function toStorefrontProduct(row: PricelistRow, image: string | null): Product {
  return {
    id: "",
    name: row.name,
    description: pricelistDescription(row),
    price: row.price,
    currency: SYMBOL,
    purity: "",
    category: NOVA_LAB_CATEGORY,
    featured: false,
    image,
    stock: STOCK,
    available: true,
    discountPrice: 0,
    discountEnabled: false,
    isSet: false,
    inclusions: [],
    molecularWeight: "",
    cas: "",
    storage: "",
    sequence: "",
    sizes: "",
  } as Product;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})\n`);

  const currencyIso = currencySymbolToIso(SYMBOL); // "PHP"
  const existing = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    select: { slug: true, sku: true, images: true, metadata: true },
  });
  const bySlug = new Map(existing.map((p) => [p.slug ?? "", p]));

  for (const row of NOVA_LAB_PRICELIST) {
    const prior = bySlug.get(row.slug);
    const priorImage = Array.isArray(prior?.images) ? (prior.images as string[])[0] : undefined;
    const write = productToDbWrite(
      toStorefrontProduct(row, priorImage ?? null),
      currencyIso,
      SYMBOL,
    );

    // Carry anything the owner set that the pricelist has no opinion on (COA
    // url, purity, …), then let the mapped values win. `priceOnRequest` is
    // dropped deliberately: the row now has a real SRP.
    const { priceOnRequest: _dropped, ...priorMeta } = (prior?.metadata ?? {}) as Record<
      string,
      unknown
    >;
    const metadata = { ...priorMeta, ...((write.metadata as Record<string, unknown>) ?? {}) };

    await prisma.product.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: row.slug } },
      update: {
        name: write.name,
        description: write.description,
        priceCents: write.priceCents,
        currency: write.currency,
        stock: write.stock,
        status: write.status,
        active: write.active,
        images: write.images as never,
        metadata: metadata as never,
      },
      create: {
        tenantId: tenant.id,
        sku: slugify(row.name).toUpperCase(),
        slug: row.slug,
        name: write.name,
        description: write.description,
        priceCents: write.priceCents,
        currency: write.currency,
        stock: write.stock,
        status: write.status,
        active: write.active,
        images: write.images as never,
        metadata: metadata as never,
      },
    });
    console.log(
      `  ✓ ${row.name.padEnd(30)} ${SYMBOL}${row.price.toLocaleString()}` +
        `${prior ? "" : "   (new)"}`,
    );
  }

  // Hide the doses the sheet replaces — draft, not deleted.
  for (const slug of NOVA_LAB_SUPERSEDED) {
    const prior = bySlug.get(slug);
    if (!prior) {
      console.log(`  · ${slug} — nothing to hide`);
      continue;
    }
    await prisma.product.update({
      where: { tenantId_slug: { tenantId: tenant.id, slug } },
      data: { status: "draft", active: false },
    });
    console.log(`  ⊘ ${slug} — hidden (superseded by the pricelist dose)`);
  }

  const total = await prisma.product.count({ where: { tenantId: tenant.id } });
  const live = await prisma.product.count({
    where: { tenantId: tenant.id, active: true, status: "active" },
  });
  console.log(
    `\nDone. ${NOVA_LAB_PRICELIST.length} pricelist rows upserted — ` +
      `${live} live of ${total} products for this tenant.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
