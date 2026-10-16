/**
 * Move a "Complete Set includes: • …" list out of each product DESCRIPTION and
 * onto that product's "Complete Set" variation (`variations[].includes`).
 *
 * WHY (thepeppylab, 2026-10-17): the list lived in the description, so a buyer
 * who picked "Vial Only" was still told the syringes, pads and cases came with
 * it. Per-variation `includes` (see scripts/test-variation-includes.ts) shows
 * the list only while Complete Set is picked.
 *
 * Only a product whose description ENDS with the block is touched: a heading
 * line "Complete Set includes:" followed by nothing but "•" bullet lines. Any
 * other shape is reported and skipped rather than guessed at. A Complete Set
 * option that already has a list is skipped too, so re-running is a no-op.
 *
 * SAFE BY DEFAULT — dry run unless `--apply` is passed. `--apply` first writes
 * every touched row's original description + metadata to
 * .rehost-backup/set-includes-<tenant>-<timestamp>.json (gitignored).
 *
 *   npx tsx scripts/move-set-includes-to-variation.ts --tenant thepeppylab
 *   npx tsx scripts/move-set-includes-to-variation.ts --tenant thepeppylab --apply
 *
 * The storefront caches catalog rows, so after --apply press Save on any store
 * admin screen (or redeploy) — see the migration-script cache gap.
 */

import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import { cleanIncludes, parseIncludes } from "../src/lib/storefront/variations";
import type { ProductMetadata } from "../src/lib/storefront/product-mapping";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const tenantArg = argv.indexOf("--tenant");
const TENANT_SLUG = tenantArg >= 0 ? argv[tenantArg + 1] : undefined;

const HEADING = /^\s*complete set includes:?\s*$/i;
const BULLET = /^\s*•/;
const SET_NAME = "complete set";

type Plan =
  | { kind: "move"; description: string; includes: string; setIndex: number }
  | { kind: "skip"; reason: string };

/** Split a description into (kept text, bullet list) when it ends with the block. */
export function splitSetBlock(description: string): { kept: string; items: string[] } | null {
  const lines = description.replace(/\r\n/g, "\n").split("\n");
  const at = lines.findIndex((l) => HEADING.test(l));
  if (at < 0) return null;
  const tail = lines.slice(at + 1).filter((l) => l.trim() !== "");
  if (tail.length === 0 || !tail.every((l) => BULLET.test(l))) return null;
  return {
    kept: lines.slice(0, at).join("\n").trimEnd(),
    items: parseIncludes(tail.join("\n")),
  };
}

function planFor(description: string, meta: ProductMetadata): Plan {
  const split = splitSetBlock(description);
  if (!split) return { kind: "skip", reason: "description does not end with a bullet-only 'Complete Set includes:' block" };
  const variations = Array.isArray(meta.variations) ? meta.variations : [];
  const setIndex = variations.findIndex((v) => v.name.trim().toLowerCase() === SET_NAME);
  if (setIndex < 0) return { kind: "skip", reason: "no 'Complete Set' variation" };
  if (variations[setIndex].includes) return { kind: "skip", reason: "Complete Set already has an includes list" };
  const includes = cleanIncludes(split.items.join("\n"));
  if (!includes) return { kind: "skip", reason: "block had no items" };
  return { kind: "move", description: split.kept, includes, setIndex };
}

async function main() {
  if (!TENANT_SLUG) throw new Error("Pass --tenant <slug>.");
  const products = await prisma.product.findMany({
    where: { tenant: { slug: TENANT_SLUG } },
    select: { id: true, name: true, description: true, metadata: true },
    orderBy: { name: "asc" },
  });

  const moves: { id: string; name: string; before: { description: string | null; metadata: unknown }; description: string; metadata: ProductMetadata }[] = [];
  for (const p of products) {
    const description = p.description ?? "";
    if (!/complete set includes/i.test(description)) continue;
    const meta = (p.metadata ?? {}) as ProductMetadata;
    const plan = planFor(description, meta);
    if (plan.kind === "skip") {
      console.log(`  – SKIP ${p.name}: ${plan.reason}`);
      continue;
    }
    const variations = (meta.variations ?? []).map((v, i) =>
      i === plan.setIndex ? { ...v, includes: plan.includes } : v,
    );
    moves.push({
      id: p.id,
      name: p.name,
      before: { description: p.description, metadata: p.metadata },
      description: plan.description,
      metadata: { ...meta, variations },
    });
    console.log(`  ✓ ${p.name}: ${plan.includes.split("\n").length} items → Complete Set`);
  }

  console.log(`\n${moves.length} product(s) to update on ${TENANT_SLUG}.`);
  if (!APPLY) {
    if (moves[0]) {
      console.log(`\nExample — ${moves[0].name}\n  new description:\n${moves[0].description.replace(/^/gm, "    ")}`);
      const set = moves[0].metadata.variations?.find((v) => v.includes);
      console.log(`  Complete Set includes:\n${(set?.includes ?? "").replace(/^/gm, "    ")}`);
    }
    console.log("\nDry run — nothing written. Re-run with --apply.");
    return;
  }

  const dir = join(process.cwd(), ".rehost-backup");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `set-includes-${TENANT_SLUG}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(moves.map((m) => ({ id: m.id, name: m.name, ...m.before })), null, 2));
  console.log(`Backup: ${file}`);

  // One small write per product (no interactive transaction — see the
  // transaction round-trip budget); each write is independent and idempotent.
  for (const m of moves) {
    await prisma.product.update({
      where: { id: m.id },
      data: { description: m.description, metadata: m.metadata as Prisma.InputJsonValue },
    });
  }
  console.log(`Applied ${moves.length} update(s).`);
  console.log("Next: press Save on any store-admin screen (or redeploy) so the cached catalog refreshes.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
