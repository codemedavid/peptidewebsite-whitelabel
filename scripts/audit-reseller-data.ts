/**
 * READ-ONLY AUDIT: which tenants carry product `reseller` metadata, and is each
 * entitled to the Reseller portal (storefront.reseller)? Mirrors the live
 * entitlement resolution (plan features ∪ enabled overrides − revocations,
 * honoring override expiry — src/lib/features/entitlements.ts).
 *
 * Flags:
 *   UNENTITLED+DATA  — the pepstack-davao bug shape: feature off, data present
 *                      (harmless after the stripResellerPricing gate ships, but
 *                      the data is likely stray)
 *   SUSPICIOUS PRICE — a wholesale leg under 20% of retail (possible typo),
 *                      flagged even for entitled tenants
 *
 *   npx tsx scripts/audit-reseller-data.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});
const KEY = "storefront.reseller";
const SUSPICIOUS_RATIO = 0.2;

async function main() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { slug: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      plan: { select: { features: { select: { feature: { select: { key: true } } } } } },
      featureOverrides: {
        select: { enabled: true, expiresAt: true, feature: { select: { key: true } } },
      },
    },
  });

  const now = Date.now();
  let buggy = 0;
  let suspicious = 0;

  for (const t of tenants) {
    // Same resolution as getEntitlements(): plan ∪ enabled overrides − revocations.
    let entitled = t.plan?.features.some((pf) => pf.feature.key === KEY) ?? false;
    for (const o of t.featureOverrides) {
      if (o.feature.key !== KEY) continue;
      if (o.expiresAt && o.expiresAt.getTime() < now) continue;
      entitled = o.enabled;
    }

    const products = await prisma.product.findMany({
      where: { tenantId: t.id },
      select: { name: true, priceCents: true, metadata: true, status: true },
    });
    const withReseller = products
      .map((p) => {
        const meta = (p.metadata ?? {}) as Record<string, unknown>;
        const r = meta.reseller as
          | { vialsOnly?: number; completeSet?: number; minQty?: number }
          | undefined;
        return r ? { name: p.name, retail: (p.priceCents ?? 0) / 100, r, status: p.status } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (withReseller.length === 0) continue; // no reseller data → nothing to report

    const flag = entitled ? "entitled " : "UNENTITLED+DATA";
    if (!entitled) buggy++;
    console.log(`\n${t.slug} (${t.name}) — reseller feature ${entitled ? "ON" : "OFF"} [${flag}]`);
    for (const p of withReseller) {
      const legs = [p.r.vialsOnly, p.r.completeSet].filter(
        (v): v is number => typeof v === "number" && v > 0,
      );
      const lowest = legs.length ? Math.min(...legs) : null;
      const isSuspicious = lowest != null && p.retail > 0 && lowest < p.retail * SUSPICIOUS_RATIO;
      if (isSuspicious) suspicious++;
      console.log(
        `  ${p.name.padEnd(40)} retail=${String(p.retail).padStart(7)}  ` +
          `vialsOnly=${p.r.vialsOnly ?? "—"} completeSet=${p.r.completeSet ?? "—"} minQty=${p.r.minQty ?? "—"}` +
          `${p.status === "archived" ? "  (archived)" : ""}${isSuspicious ? "  ⚠ SUSPICIOUS PRICE" : ""}`,
      );
    }
  }

  console.log(
    `\n${tenants.length} tenants scanned · ${buggy} with the bug shape (feature OFF + reseller data) · ${suspicious} suspicious wholesale legs`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
