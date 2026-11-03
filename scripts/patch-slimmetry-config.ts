// One-off: add Slimmetry's promo codes + on-brand hero copy into branding.config.
// Idempotent (overwrites just promoCodes + hero keys). Run: npx tsx scripts/patch-slimmetry-config.ts
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db/prisma";
import { normalizePromoCodes } from "../src/lib/storefront/promo";

const DIR = "/private/tmp/claude-501/-Users-ynadonaire-peptide-website-whitelabel-v1/6dbf97db-f28d-4a9b-87d5-96ae97291452/scratchpad/slim/export";
const TENANT = "slimmetry";

type RawPromo = {
  id: string; code: string; discount_type: string; discount_value: number;
  min_purchase_amount: number | null; usage_limit: number | null; usage_count: number | null;
  end_date: string | null; active: boolean;
};

async function main() {
  const raw: RawPromo[] = JSON.parse(readFileSync(`${DIR}/promo_codes.json`, "utf8"));
  const promoCodes = normalizePromoCodes(
    raw.map((p) => ({
      id: p.id,
      code: p.code,
      type: p.discount_type === "percent" ? "percent" : "fixed",
      value: Number(p.discount_value) || 0,
      minPurchase: Number(p.min_purchase_amount) || 0,
      usageLimit: p.usage_limit ?? null,
      used: Number(p.usage_count) || 0,
      expiry: p.end_date ? p.end_date.slice(0, 10) : null,
      active: p.active === true,
    })),
  );

  const hero = {
    heroChipLabel: "Your partner in the journey to confidence.",
    heroLine1: "Glow.Slim.Transform",
    heroLine2: "with Slimmetry",
    heroSub: "Carefully curated products • Transparent sourcing • Real user journeys",
    heroCta1: "Explore Products",
    heroCta2: "View Lab Reports",
  };

  const row = await prisma.branding.findFirst({ where: { tenantId: TENANT } });
  const current = (row?.config ?? {}) as Record<string, unknown>;
  const config = { ...current, ...hero, promoCodes };
  await prisma.branding.update({ where: { tenantId: TENANT }, data: { config } });
  console.log(`✓ promoCodes: ${promoCodes.length} (of ${raw.length} raw), hero copy set`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
