/**
 * Customer accounts against a real Postgres (in-process PGlite, the same harness
 * as test:isolation) through the REAL forTenant() extension — the queries here
 * are the ones actions/customer-accounts.ts runs.
 *
 * Proves the schema half of "each tenant has its own customer list":
 *   - one email is one account PER STORE, and two stores can share an email;
 *   - store A's scoped client can't read, count, disable or sign in B's customer;
 *   - My Account lists exactly the orders stamped with the account, minus trash;
 *   - deleting an account keeps its orders (the FK nulls out, history survives);
 *   - a stored password verifies and a wrong one doesn't.
 *
 *   npm run test:customer-accounts-db
 */

import { execSync } from "node:child_process";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { hashPassword, verifyPassword } from "../src/lib/auth/password-hash";
import { resolveCustomerSession } from "../src/lib/storefront/customer-account";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (ok) passed++;
  else failed++;
}

const SCHEMA = path.join(process.cwd(), "prisma", "schema.prisma");

async function main() {
  const ddl = execSync(`npx prisma migrate diff --from-empty --to-schema-datamodel "${SCHEMA}" --script`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const pg = new PGlite();
  await pg.exec(ddl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = new PrismaClient({ adapter: new PrismaPGlite(pg) as any });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  const { forTenant } = await import("../src/lib/db/tenant-client");

  const plan = await db.plan.create({ data: { key: "starter", name: "Starter" } });
  const A = (await db.tenant.create({ data: { name: "Store A", slug: "store-a", planId: plan.id } })).id;
  const B = (await db.tenant.create({ data: { name: "Store B", slug: "store-b", planId: plan.id } })).id;
  const a = forTenant(A);
  const b = forTenant(B);

  console.log("\nOne email, one account per store");
  const ana = await a.storefrontCustomer.create({
    data: { tenantId: A, name: "Ana", email: "ana@x.com", passwordHash: hashPassword("correct horse") },
  });
  let dup = "";
  try {
    await a.storefrontCustomer.create({
      data: { tenantId: A, name: "Ana 2", email: "ana@x.com", passwordHash: hashPassword("whatever1") },
    });
  } catch (e) {
    dup = (e as { code?: string }).code ?? "threw";
  }
  check("a second sign-up with the same email on the same store is rejected (P2002)", dup === "P2002", dup);
  const anaB = await b.storefrontCustomer.create({
    data: { tenantId: B, name: "Ana on B", email: "ana@x.com", passwordHash: hashPassword("different pw") },
  });
  check("the same email can sign up on another store", !!anaB.id && anaB.id !== ana.id);

  console.log("\nTenant isolation (sign-in lookup, list, disable)");
  const seenFromB = await b.storefrontCustomer.findFirst({ where: { email: "ana@x.com" } });
  check("store B's sign-in lookup finds B's row, never A's", seenFromB?.id === anaB.id);
  check("store B's password does not open store A's account", !verifyPassword("different pw", ana.passwordHash));
  check("store A's password verifies on store A", verifyPassword("correct horse", ana.passwordHash));
  const listA = await a.storefrontCustomer.findMany({});
  check("store A's Customers list has only A's customers", listA.length === 1 && listA[0].id === ana.id);
  const crossDisable = await b.storefrontCustomer.updateMany({ where: { id: ana.id }, data: { status: "disabled" } });
  check("store B can't disable store A's customer (0 rows)", crossDisable.count === 0);
  const crossRead = await b.storefrontCustomer.findFirst({ where: { id: ana.id } });
  check(
    "a store-A cookie replayed on store B resolves to nobody",
    resolveCustomerSession({ tenantId: A, customerId: ana.id, sessionVersion: 1 }, crossRead, B) === null,
  );

  console.log("\nMy Account order history");
  const order = (n: string, over: Record<string, unknown> = {}) =>
    a.storefrontOrder.create({ data: { tenantId: A, orderNumber: n, ...over } });
  await order("A-1", { customerAccountId: ana.id });
  await order("A-2", { customerAccountId: ana.id });
  await order("A-3", { customerAccountId: ana.id, deletedAt: new Date() }); // trashed
  await order("A-4"); // guest, same store
  const mine = await a.storefrontOrder.findMany({ where: { deletedAt: null, customerAccountId: ana.id } });
  check(
    "lists the account's orders, excluding trash and guest orders",
    mine.map((o) => o.orderNumber).sort().join(",") === "A-1,A-2",
    mine.map((o) => o.orderNumber).join(","),
  );
  const withCount = await a.storefrontCustomer.findFirst({
    where: { id: ana.id },
    select: { _count: { select: { orders: { where: { deletedAt: null } } } } },
  });
  check("the admin order count ignores trashed orders", withCount?._count.orders === 2, String(withCount?._count.orders));
  const fromB = await b.storefrontOrder.findMany({ where: { customerAccountId: ana.id } });
  check("store B sees none of A's account orders", fromB.length === 0);

  console.log("\nRevocation");
  const bumped = await a.storefrontCustomer.update({
    where: { id: ana.id },
    data: { status: "disabled", sessionVersion: { increment: 1 } },
  });
  check("disabling bumps sessionVersion", bumped.sessionVersion === 2);
  check(
    "an existing session no longer resolves",
    resolveCustomerSession({ tenantId: A, customerId: ana.id, sessionVersion: 1 }, bumped, A) === null,
  );

  console.log("\nDeleting an account keeps the order history");
  await db.storefrontCustomer.delete({ where: { id: ana.id } });
  const kept = await a.storefrontOrder.findMany({ where: { orderNumber: { in: ["A-1", "A-2"] } } });
  check(
    "orders survive with customerAccountId nulled",
    kept.length === 2 && kept.every((o) => o.customerAccountId === null),
  );

  await db.$disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
