/**
 * Open (or fully revert) a TEST group-buy round on k-glow.
 *
 * This writes to the LIVE database — k-glow is an active tenant with no
 * access-code gate, so while the round is `active` it is visible to real
 * customers and the assigned products sell at their group-buy price. The round
 * is deliberately named so anyone who sees it knows it is a test, and it closes
 * automatically 24h after it is opened.
 *
 *   npx tsx scripts/kglow-test-gb.ts open     # tag products + open the round
 *   npx tsx scripts/kglow-test-gb.ts revert   # delete the round + untag products
 *
 * `revert` restores each product's metadata to the EXACT state captured on
 * 2026-07-30 before this script first ran (see `original` below) — Semax and
 * 5-Amino-1MQ were already tagged `productType: "gb"` with no price, so a blind
 * "delete both keys" revert would have silently untagged two live products.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import {
  normalizeGroupBuy,
  groupBuyToDbWrite,
} from "../src/lib/storefront/group-buy";

const TENANT_SLUG = "k-glow";

/** Marks the round this script owns, so `revert` can never touch a real one. */
const ROUND_NAME = "TEST ROUND — staff testing only";

const HOURS_OPEN = 24;

type Assignment = {
  id: string;
  label: string;
  /** Group-buy unit price in pesos. Must be below the product's regular price. */
  gbPrice: number;
  /** Product metadata as it was BEFORE this script ran — the revert target. */
  original: { productType?: "gb"; gbPrice?: number };
};

/** Four single-row, in-stock products. The duplicate-name rows (Tirzepatide,
 *  GHK-CU, KPV) are deliberately excluded — see the gb-assignment-drift note. */
const ASSIGNMENTS: readonly Assignment[] = [
  {
    id: "cms1fba2n000xjs04ry4awso7",
    label: "Tirzepatide 30mg",
    gbPrice: 900,
    original: {},
  },
  {
    id: "cms1hngy6000jl10499exfl8c",
    label: "Tirzepatide 15mg",
    gbPrice: 690,
    original: {},
  },
  {
    id: "cmrwzf9dp000lmeze5cvb5rc5",
    label: "Semax",
    gbPrice: 2650,
    original: { productType: "gb" },
  },
  {
    id: "cmryjlulf0009moby57x5pyw2",
    label: "5-Amino-1MQ",
    gbPrice: 2400,
    original: { productType: "gb" },
  },
];

const db = new PrismaClient();

async function tenantId(): Promise<string> {
  const t = await db.tenant.findFirstOrThrow({
    where: { slug: TENANT_SLUG },
    select: { id: true },
  });
  return t.id;
}

/** Rewrite one product's metadata immutably, keeping every unrelated key. */
async function writeMetadata(
  id: string,
  patch: (meta: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const row = await db.product.findUniqueOrThrow({
    where: { id },
    select: { metadata: true },
  });
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  await db.product.update({
    where: { id },
    data: { metadata: patch(meta) as Prisma.InputJsonValue },
  });
}

async function open(): Promise<void> {
  const tid = await tenantId();

  const existing = await db.groupBuy.findFirst({
    where: { tenantId: tid, status: "active" },
    select: { id: true, name: true },
  });
  if (existing) {
    throw new Error(
      `k-glow already has an ACTIVE round (${existing.name}, ${existing.id}). ` +
        `Exactly one active round per tenant is an invariant — close that one first.`,
    );
  }

  for (const a of ASSIGNMENTS) {
    const row = await db.product.findUniqueOrThrow({
      where: { id: a.id },
      select: { name: true, priceCents: true },
    });
    const regular = row.priceCents / 100;
    if (a.gbPrice >= regular) {
      throw new Error(
        `${a.label}: gb price ${a.gbPrice} is not below regular ${regular} — the storefront would show no saving.`,
      );
    }
    await writeMetadata(a.id, (meta) => ({
      ...meta,
      productType: "gb",
      gbPrice: a.gbPrice,
    }));
    console.log(`  tagged ${row.name} — ₱${regular} → ₱${a.gbPrice}`);
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + HOURS_OPEN * 60 * 60 * 1000);
  const round = normalizeGroupBuy({
    name: ROUND_NAME,
    description:
      "Internal test round. Not a real group buy — please do not place an order against it.",
    status: "active",
    startsAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    deliveryEta: "3–4 weeks after close",
    productIds: ASSIGNMENTS.map((a) => a.id),
    slotGoal: 30,
    batchNumber: "TEST-B1",
    minVials: 20,
    maxVials: 60,
  });

  const created = await db.groupBuy.create({
    data: { tenantId: tid, ...groupBuyToDbWrite(round) },
  });
  console.log(`\nopened round ${created.id}`);
  console.log(`  status  ${created.status}`);
  console.log(
    `  window  ${created.startsAt?.toISOString()} → ${created.endsAt?.toISOString()}`,
  );
}

async function revert(): Promise<void> {
  const tid = await tenantId();

  const rounds = await db.groupBuy.findMany({
    where: { tenantId: tid, name: ROUND_NAME },
    select: { id: true },
  });
  for (const r of rounds) {
    const orders = await db.storefrontOrder.count({
      where: { groupBuyId: r.id },
    });
    if (orders > 0) {
      console.log(
        `  round ${r.id} has ${orders} order(s) — cancelling instead of deleting so the orders keep their round.`,
      );
      await db.groupBuy.update({
        where: { id: r.id },
        data: { status: "cancelled", closedAt: new Date() },
      });
      continue;
    }
    await db.groupBuy.delete({ where: { id: r.id } });
    console.log(`  deleted round ${r.id}`);
  }

  for (const a of ASSIGNMENTS) {
    await writeMetadata(a.id, (meta) => {
      const { productType: _type, gbPrice: _price, ...rest } = meta;
      return { ...rest, ...a.original };
    });
    const restored =
      Object.keys(a.original).length === 0
        ? "untagged"
        : JSON.stringify(a.original);
    console.log(`  restored ${a.label} → ${restored}`);
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "open" && mode !== "revert") {
    throw new Error("usage: npx tsx scripts/kglow-test-gb.ts <open|revert>");
  }
  console.log(`${mode} — tenant ${TENANT_SLUG}\n`);
  if (mode === "open") await open();
  else await revert();
  console.log("\ndone.");
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
