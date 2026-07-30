/**
 * Flip every store that runs Order Ratio Control over to the bac-water CAP.
 *
 * Before: the rule was a FLOOR — "every peptide needs 1 bacteriostatic water,
 * add 2 more to check out" — so a customer who only wanted peptides was stopped.
 * After: the rule is a CAP — bac water may not exceed the peptide vials in the
 * cart. Buying peptides alone is fine; only a surplus of water is rejected.
 *
 * For each tenant whose `groupBuyRules.ratio.enabled` is true:
 *   · ratio.direction            → "cap"
 *   · ratio.mode "auto_add"      → "strict"  (a surplus can't be auto-added away)
 *   · ratio.message with {shortfall}/{required} → ""  (floor-worded copy would
 *     tell the customer to ADD water while blocking them for having too much;
 *     blank falls back to the built-in cap copy)
 * and, for every tenant that explicitly stored it:
 *   · checkoutRules.bacWaterValidation true → false  (the coarse "please add
 *     bacteriostatic water" floor — it contradicts a cap. Tenants that never
 *     stored a value already inherit the new OFF default.)
 *
 * Only these keys are touched; the rest of branding.config is spread through
 * untouched. Idempotent — a second run reports "already capped" and writes
 * nothing.
 *
 * SAFE BY DEFAULT — dry run unless `--apply` is passed:
 *   npx tsx scripts/migrate-bacwater-cap.ts            # print the plan
 *   npx tsx scripts/migrate-bacwater-cap.ts --apply    # write it
 *
 *   npm run migrate:bacwater-cap
 */

import "dotenv/config";

import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import { normalizeGroupBuyRules, type GroupBuyRules } from "../src/lib/storefront/group-buy-rules";
import { normalizeCheckoutRules } from "../src/lib/storefront/checkout-rules";

const APPLY = process.argv.slice(2).includes("--apply");

/** Copy written for the floor reads as nonsense once the rule is a cap. */
const FLOOR_TOKENS = /\{(shortfall|required)\}/;

type Change = { key: string; from: string; to: string };

/** The ratio block as it should look under the cap, plus what changed. */
function capRatio(rules: GroupBuyRules): { ratio: GroupBuyRules["ratio"]; changes: Change[] } {
  const r = rules.ratio;
  const changes: Change[] = [];

  if (r.direction !== "cap") {
    changes.push({ key: "ratio.direction", from: r.direction, to: "cap" });
  }
  const mode = r.mode === "auto_add" ? "strict" : r.mode;
  if (mode !== r.mode) {
    changes.push({ key: "ratio.mode", from: r.mode, to: mode });
  }
  const message = FLOOR_TOKENS.test(r.message) ? "" : r.message;
  if (message !== r.message) {
    changes.push({ key: "ratio.message", from: `"${r.message}"`, to: "(built-in cap copy)" });
  }

  return { ratio: { ...r, direction: "cap", mode, message }, changes };
}

async function main() {
  const tenants = await prisma.tenant.findMany({ orderBy: { slug: "asc" } });
  console.log(
    `\nbac-water cap migration — ${APPLY ? "APPLY" : "DRY RUN"} (${tenants.length} tenants)\n`,
  );

  let planned = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    const branding = await prisma.branding.findFirst({ where: { tenantId: tenant.id } });
    if (!branding) continue;

    const config = (branding.config ?? {}) as Record<string, unknown>;
    const rules = normalizeGroupBuyRules(config.groupBuyRules);
    const changes: Change[] = [];
    const next: Record<string, unknown> = { ...config };

    // 1. The ratio rule itself — only for stores actually running it.
    if (rules.ratio.enabled) {
      const { ratio, changes: ratioChanges } = capRatio(rules);
      changes.push(...ratioChanges);
      if (ratioChanges.length > 0) {
        next.groupBuyRules = { ...rules, ratio } satisfies GroupBuyRules;
      }
    }

    // 2. The coarse "peptide orders must include bac water" floor. Only rewritten
    //    where a tenant explicitly stored `true` — an absent value already reads
    //    as the new OFF default, so writing one would just add config noise.
    const storedCheckout = (config.checkoutRules ?? null) as Record<string, unknown> | null;
    if (storedCheckout && storedCheckout.bacWaterValidation === true) {
      changes.push({ key: "checkoutRules.bacWaterValidation", from: "true", to: "false" });
      next.checkoutRules = {
        ...normalizeCheckoutRules(storedCheckout),
        bacWaterValidation: false,
      };
    }

    if (changes.length === 0) {
      skipped++;
      const why = rules.ratio.enabled ? "already capped" : "ratio rule not in use";
      console.log(`  · ${tenant.slug.padEnd(22)} — no change (${why})`);
      continue;
    }

    planned++;
    console.log(`  ✎ ${tenant.slug}`);
    for (const c of changes) console.log(`      ${c.key}: ${c.from} → ${c.to}`);

    if (APPLY) {
      await prisma.branding.update({
        where: { id: branding.id },
        data: { config: next as Prisma.InputJsonValue },
      });
    }
  }

  console.log(
    `\n${planned} tenant(s) ${APPLY ? "updated" : "to update"}, ${skipped} unchanged.` +
      (APPLY ? "" : "\nDRY RUN — re-run with --apply to write.\n"),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
