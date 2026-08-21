/**
 * Recover the orders of a group-buy round that was RENAMED AND REUSED instead of
 * being closed and replaced.
 *
 * When an owner edits a live round's name and window rather than creating a new
 * one, every order from the previous run keeps pointing at the same GroupBuy row.
 * The round's report then sizes a supplier order that silently includes vials
 * already bought and shipped in the previous run.
 *
 * The tell is the order's own `groupBuyName` snapshot, stamped at checkout and
 * never rewritten: it still says what the customer was shown. Orders whose
 * snapshot disagrees with the round's current name belong to an earlier run.
 *
 * This script splits them onto a reconstructed, CLOSED round of their own. It
 * never edits the snapshots (they are the historical record) and never touches
 * the orders that legitimately belong to the current run.
 *
 * DRY RUN BY DEFAULT — pass --apply to write.
 *
 *   npx tsx scripts/split-reused-gb-round.ts <slug> <roundId> "<new round name>"
 *   npx tsx scripts/split-reused-gb-round.ts <slug> <roundId> "<name>" --apply
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const fmt = (x: Date | null | undefined) =>
  x ? x.toISOString().slice(0, 16).replace("T", " ") : "—";

/** One day of clearance before the surviving round opens, so the reconstructed
 *  window can never overlap it and pull an order back the other way. */
const GAP_MS = 60 * 60 * 1000;

async function main() {
  const [slug, roundId, newName] = process.argv.slice(2);
  const apply = process.argv.includes("--apply");
  if (!slug || !roundId || !newName) {
    throw new Error('usage: split-reused-gb-round.ts <slug> <roundId> "<new round name>" [--apply]');
  }

  const tenant = await prisma.tenant.findFirst({ where: { slug }, select: { id: true } });
  if (!tenant) throw new Error(`No tenant with slug "${slug}"`);

  const round = await prisma.groupBuy.findFirst({ where: { id: roundId, tenantId: tenant.id } });
  if (!round) throw new Error(`No round ${roundId} on ${slug}`);

  const orders = await prisma.storefrontOrder.findMany({
    where: { tenantId: tenant.id, deletedAt: null, groupBuyId: round.id },
    select: {
      id: true, orderNumber: true, placedAt: true, status: true,
      paymentStatus: true, groupBuyName: true, items: true,
    },
    orderBy: { placedAt: "asc" },
  });

  // An order belongs to an EARLIER run when its checkout snapshot names a round
  // this row is no longer called. A blank snapshot is left alone: it proves
  // nothing, and guessing would move an order on no evidence at all.
  const strays = orders.filter(
    (o) => (o.groupBuyName ?? "").trim() !== "" && o.groupBuyName!.trim() !== round.name.trim(),
  );
  const keep = orders.filter((o) => !strays.includes(o));

  console.log(`Round "${round.name}" (${round.status})`);
  console.log(`  window ${fmt(round.startsAt)} → ${fmt(round.endsAt)}`);
  console.log(`  ${orders.length} order(s) currently attributed\n`);

  if (!strays.length) {
    console.log("No order disagrees with the round name — nothing to split.");
    await prisma.$disconnect();
    return;
  }

  const vials = (o: (typeof orders)[number]) =>
    ((o.items ?? []) as Array<{ qty: number }>).reduce((s, i) => s + i.qty, 0);
  const sum = (list: typeof orders) => list.reduce((s, o) => s + vials(o), 0);

  console.log(`MOVE → "${newName}"  (${strays.length} order(s), ${sum(strays)} vials)`);
  for (const o of strays) {
    console.log(`  ${o.orderNumber}  ${fmt(o.placedAt)}  ${o.status}/${o.paymentStatus}  ${String(vials(o)).padStart(3)} vials  snapshot="${o.groupBuyName}"`);
  }
  console.log(`\nSTAY → "${round.name}"  (${keep.length} order(s), ${sum(keep)} vials)`);
  for (const o of keep) {
    console.log(`  ${o.orderNumber}  ${fmt(o.placedAt)}  ${o.status}/${o.paymentStatus}  ${String(vials(o)).padStart(3)} vials  snapshot="${o.groupBuyName ?? ""}"`);
  }

  // The reconstructed window spans the strays and stops before the surviving
  // round opens, so resolveRoundOrders' date fallback can never claim an order
  // for both rounds.
  const times = strays.map((o) => o.placedAt?.getTime()).filter((t): t is number => !!t);
  const startsAt = new Date(Math.min(...times) - GAP_MS);
  const openOfSurvivor = round.startsAt?.getTime() ?? Infinity;
  const endsAt = new Date(Math.min(Math.max(...times) + GAP_MS, openOfSurvivor - GAP_MS));

  // Only the products these orders actually contain — a reconstructed round must
  // not claim an assignment it never had.
  const productIds = [
    ...new Set(
      strays.flatMap((o) =>
        ((o.items ?? []) as Array<{ productId?: string }>)
          .map((i) => i.productId)
          .filter((id): id is string => !!id),
      ),
    ),
  ];

  console.log(`\nNew round: "${newName}"`);
  console.log(`  status  closed  (never goes live, never gates the cart)`);
  console.log(`  window  ${fmt(startsAt)} → ${fmt(endsAt)}`);
  console.log(`  closedAt ${fmt(endsAt)} · productIds ${productIds.length}`);

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to commit.");
    await prisma.$disconnect();
    return;
  }

  const created = await prisma.$transaction(async (tx) => {
    const gb = await tx.groupBuy.create({
      data: {
        tenantId: tenant.id,
        name: newName,
        status: "closed",
        startsAt,
        endsAt,
        closedAt: endsAt,
        productIds,
        // Descriptive fields (description, deliveryEta, batchNumber, the vial
        // thresholds) are deliberately left blank rather than copied from the
        // surviving round: they describe the CURRENT run, and stamping them on
        // a reconstructed one would assert facts about the old run that are not
        // recoverable. batchNumber blank falls back to the round name.
      },
    });
    // groupBuyName is deliberately NOT rewritten: it is what the customer was
    // shown, and it is the only evidence this split was ever needed.
    await tx.storefrontOrder.updateMany({
      where: { id: { in: strays.map((o) => o.id) }, tenantId: tenant.id },
      data: { groupBuyId: gb.id },
    });
    return gb;
  });

  console.log(`\n✓ Created round ${created.id} and moved ${strays.length} order(s) onto it.`);
  console.log(`  "${round.name}" now reports ${keep.length} order(s) / ${sum(keep)} vials.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
