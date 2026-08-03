/**
 * Set per-way management of the two order paths for a tenant — which of the
 * on-hand and group-buy paths the storefront actually offers.
 *
 *   open    — sells normally
 *   closed  — still shown, marked closed, nothing addable to cart
 *   hidden  — off the storefront entirely; the store reads as a one-way store
 *
 * Writes branding.config.twoWaysMode, merging into the existing config blob
 * (never clobbers other fields). Reversible: re-run with different states.
 * Hiding BOTH ways is refused — a store needs at least one way to buy.
 *
 * The store owner can do this themselves in Store Admin → Group Buys → "Ways to
 * order"; this script is for the operator setting a tenant up.
 *
 *   npx tsx scripts/configure-two-ways-mode.ts <slug> <onHand> <groupBuy>
 *   npx tsx scripts/configure-two-ways-mode.ts dragon-peptides hidden open
 */

import { PrismaClient } from "@prisma/client";

import {
  normalizeTwoWaysMode,
  type TwoWaysMode,
  type WayState,
} from "../src/lib/storefront/two-ways-mode";

const prisma = new PrismaClient();
const STATES: WayState[] = ["open", "closed", "hidden"];

function parseState(value: string | undefined, label: string): WayState {
  if (!value || !STATES.includes(value as WayState)) {
    throw new Error(`${label} must be one of ${STATES.join(" | ")}, got "${value ?? ""}"`);
  }
  return value as WayState;
}

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error("usage: configure-two-ways-mode.ts <slug> <onHand> <groupBuy>");
  const requested: TwoWaysMode = {
    onHand: parseState(process.argv[3], "onHand"),
    groupBuy: parseState(process.argv[4], "groupBuy"),
  };
  // Same normalizer the storefront and the server action use, so this script
  // can't write a state they'd refuse — notably both ways hidden.
  const mode = normalizeTwoWaysMode(requested);
  if (mode.onHand !== requested.onHand || mode.groupBuy !== requested.groupBuy) {
    throw new Error(
      "Refused: a store needs at least one way to order. Hiding both was rejected.",
    );
  }

  const tenant = await prisma.tenant.findFirst({
    where: { slug },
    include: { branding: true },
  });
  if (!tenant) throw new Error(`No tenant with slug "${slug}"`);
  if (!tenant.branding) throw new Error(`Tenant "${slug}" has no branding row`);

  const config = (tenant.branding.config ?? {}) as Record<string, unknown>;
  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: { config: { ...config, twoWaysMode: mode } },
  });

  console.log(
    `✓ ${slug}: branding.config.twoWaysMode = ` +
      `{ onHand: "${mode.onHand}", groupBuy: "${mode.groupBuy}" }`,
  );
  // The setting only bites with the Group Buy module on — without it there is no
  // second way to sell through, so the storefront and the checkout gate both
  // leave it unenforced rather than walling the store.
  console.log("  note: requires the Group Buy module; otherwise both ways stay open.");
}

main()
  .catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
