/**
 * Re-map each peppies-intl product's `metadata.category` to the REAL category id
 * defined in branding.config. The original seed wrote human labels ("Weight Loss",
 * "Anti-Aging", "Skin & Beauty") that match no category id, so the storefront's
 * category filters showed everything as empty. This rewrites them to the correct
 * cat<...> ids (read-modify-write on metadata so no other fields are lost).
 *
 * Idempotent. Pass --dry to preview without writing.
 *
 *   npx tsx scripts/fix-peppies-categories.ts --dry
 *   npx tsx scripts/fix-peppies-categories.ts
 */
import { PrismaClient } from "@prisma/client";

// Use the DIRECT (non-pooled) connection for this one-off migration — the
// pgbouncer pooler on :6543 has been intermittently dropping connections.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});
const TENANT_SLUG = "peppies-intl";
const DRY = process.argv.includes("--dry");

/** Retry a thunk a few times to ride out transient connection resets. */
async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      console.warn(`  …${label} attempt ${i}/${tries} failed: ${msg}`);
    }
  }
  throw lastErr;
}

// Real category ids from branding.config (verified live).
const CAT = {
  weight: "cat1780358264850_fwc5d", // "weight management"
  beauty: "cat1780358518257_hwzir", // "beauty & anti-aging"
  wellness: "cat1780358547765_expfb", // "wellness & vitality"
  peptides: "cat1780358212051_j3nwh", // "all peptides"
} as const;

type CatKey = keyof typeof CAT;

// Per-product assignment, keyed by product name (filled from the classification
// workflow). Every active product must appear here.
const ASSIGNMENTS: Record<string, CatKey> = {
  "Tirzepatide 15 mg": "weight",
  "Tirzepatide 30 mg": "weight",
  "Retatrutide 15 mg": "weight",
  "Retatrutide 30 mg": "weight",
  "Lipo-C 10 mg": "weight",
  "AOD-9604 5 mg": "weight",
  "Lemon Bottle 10 ml": "weight", // 2/3 lens majority — fat-dissolving lipolysis; medium confidence
  "GHK-Cu 50 mg": "beauty",
  "GHK-Cu 100 mg": "beauty",
  "SNAP-8": "beauty",
  "Glutathione 1500 mg": "beauty",
  "NAD+ 500 mg": "wellness",
  "Epitalon 50 mg": "wellness",
  "MOTS-c 40 mg": "wellness",
};

async function main() {
  const tenant = await withRetry("connect", () =>
    prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } }),
  );
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})${DRY ? "  [DRY RUN]" : ""}\n`);

  const products = await withRetry("load products", () =>
    prisma.product.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, name: true, metadata: true },
    }),
  );

  let changed = 0;
  const unmapped: string[] = [];
  for (const p of products) {
    const key = ASSIGNMENTS[p.name];
    if (!key) {
      unmapped.push(p.name);
      continue;
    }
    const targetId = CAT[key];
    const meta = { ...((p.metadata ?? {}) as Record<string, unknown>) };
    const before = typeof meta.category === "string" ? meta.category : "";
    if (before === targetId) {
      console.log(`  = ${p.name.padEnd(28)} already ${key} (${targetId})`);
      continue;
    }
    meta.category = targetId;
    console.log(`  → ${p.name.padEnd(28)} ${JSON.stringify(before)} ⇒ ${key} (${targetId})`);
    if (!DRY) {
      await withRetry(`update ${p.name}`, () =>
        prisma.product.update({
          where: { id: p.id },
          data: { metadata: meta as never },
        }),
      );
    }
    changed++;
  }

  if (unmapped.length) {
    console.log(`\n⚠ ${unmapped.length} product(s) had no assignment and were left untouched:`);
    for (const n of unmapped) console.log(`    - ${n}`);
  }
  console.log(`\n${DRY ? "Would update" : "Updated"} ${changed} product(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
