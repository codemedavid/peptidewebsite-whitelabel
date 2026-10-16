/**
 * Put tenant `pepsys-compound` (Pep-sy's Compound) on the SHOWCASE home layout
 * — the test tenant for the new layout.
 *
 * Read-modify-write into the shared `branding.config` blob (never clobbering
 * the rest of the Brand config), same pattern as configure-luminara-hero.ts.
 * Two keys change:
 *
 *   • homeLayout → "showcase"
 *   • boutique.assurances → four promise lines, ONLY when the store has none.
 *     They feed the promise bar, the hero trust row and the closing strip, and
 *     every one is taken from the store's own existing copy (its hero chip,
 *     its hero sub-line and its enabled contact channels) — nothing the store
 *     does not already say about itself.
 *
 * Re-running is safe: an owner who has since edited their assurances keeps
 * them. Undo: set homeLayout back to "classic" (assurances are harmless — the
 * classic layout does not render them).
 *
 * Run from the project root:
 *   npx tsx scripts/configure-pepsys-showcase.ts
 */
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import { normalizeAssurances } from "../src/lib/storefront/boutique-home";

const TENANT_SLUG = "pepsys-compound";

const ASSURANCES = [
  {
    id: "pepsys-lab",
    label: "Third-party lab verified",
    note: "Research-grade peptides, independently tested.",
  },
  {
    id: "pepsys-delivery",
    label: "Discreet nationwide delivery",
    note: "Shipped anywhere in the Philippines.",
  },
  {
    id: "pepsys-protocols",
    label: "Clear protocols",
    note: "Step-by-step guides and a dosing calculator.",
  },
  {
    id: "pepsys-support",
    label: "Real support",
    note: "Message us on WhatsApp or Telegram.",
  },
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const branding = await prisma.branding.findUnique({
    where: { tenantId: tenant.id },
    select: { config: true },
  });
  const current = (branding?.config ?? {}) as Record<string, unknown>;
  const boutique =
    current.boutique && typeof current.boutique === "object" && !Array.isArray(current.boutique)
      ? (current.boutique as Record<string, unknown>)
      : {};
  const existing = normalizeAssurances(boutique.assurances);

  const config: Record<string, unknown> = {
    ...current,
    homeLayout: "showcase",
    boutique: existing.length > 0 ? boutique : { ...boutique, assurances: ASSURANCES },
  };

  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: { config: config as Prisma.InputJsonValue },
    create: { tenantId: tenant.id, config: config as Prisma.InputJsonValue },
  });

  console.log(`  • homeLayout: ${JSON.stringify(current.homeLayout ?? null)} → "showcase"`);
  console.log(
    existing.length > 0
      ? `  • assurances: kept the store's own ${existing.length}`
      : `  • assurances: added ${ASSURANCES.length} (from the store's own copy)`,
  );
  console.log(
    "\nNext: the storefront caches branding. Press Save on any branding screen in\n" +
      "the store admin, or restart the server, for the live page to pick this up.",
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
