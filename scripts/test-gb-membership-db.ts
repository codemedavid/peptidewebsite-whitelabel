/**
 * Postgres gate for paid group-buy access — the rules the DATABASE enforces,
 * so no code path (a new action, a script, a direct SQL edit) can skip them.
 * Boots the real schema in in-process PGlite, applies
 * prisma/group-buy-memberships.sql (twice — it must be idempotent), then
 * attacks it with raw SQL.
 *
 *   npm run test:gb-membership-db
 *
 * Covers: a request is born pending_payment; no skipped or backward states;
 * reject/revoke need a reason and refund needs a reference; one live request
 * per customer per round (a rejected one frees the slot); tenant/round/
 * customer/amount are immutable; the round must belong to the same tenant;
 * the fee is a positive integer; deleting the customer keeps the paid record;
 * a round with requests cannot be deleted; the audit log is append-only.
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

async function rejects(p: Promise<unknown>, pattern: RegExp) {
  try {
    await p;
  } catch (e) {
    assert.match((e as Error).message, pattern);
    return;
  }
  assert.fail(`expected the database to refuse (${pattern})`);
}

async function main() {
  const schema = path.join(process.cwd(), "prisma", "schema.prisma");
  const ddl = execSync(`npx prisma migrate diff --from-empty --to-schema-datamodel "${schema}" --script`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const rules = readFileSync(path.join(process.cwd(), "prisma", "group-buy-memberships.sql"), "utf8");

  const pg = new PGlite();
  await pg.exec(ddl);

  await test("rules file applies, and re-applies cleanly (idempotent)", async () => {
    await pg.exec(rules);
    await pg.exec(rules);
  });

  // ── Fixtures: two stores, a round each, customers ──
  await pg.exec(`
    INSERT INTO plans (id, key, name) VALUES ('p_1', 'basic', 'Basic');
    INSERT INTO tenants (id, slug, name, "planId") VALUES
      ('t_a', 'store-a', 'Store A', 'p_1'), ('t_b', 'store-b', 'Store B', 'p_1');
    INSERT INTO group_buys (id, "tenantId", name, "paidJoin", "joinFeeCents") VALUES
      ('gb_a', 't_a', 'Round A', true, 50000), ('gb_a2', 't_a', 'Round A2', true, 50000),
      ('gb_b', 't_b', 'Round B', true, 30000);
    INSERT INTO storefront_customers (id, "tenantId", email, name, "passwordHash", "updatedAt") VALUES
      ('c_ana', 't_a', 'ana@example.com', 'Ana', 'x', now()),
      ('c_bea', 't_a', 'bea@example.com', 'Bea', 'x', now());
  `);

  let seq = 0;
  const insert = (o: { id?: string; tenant?: string; gb?: string; customer?: string | null; status?: string; amount?: number }) =>
    pg.query(
      `INSERT INTO group_buy_memberships (id, "tenantId", "groupBuyId", "customerId", "customerName", "customerEmail", status, "amountCents", "updatedAt")
       VALUES ($1, $2, $3, $4, 'Ana', 'ana@example.com', $5, $6, now())`,
      [o.id ?? `m_${++seq}`, o.tenant ?? "t_a", o.gb ?? "gb_a", o.customer === undefined ? "c_ana" : o.customer, o.status ?? "pending_payment", o.amount ?? 50000],
    );
  const setStatus = (id: string, status: string, extra = "") =>
    pg.query(`UPDATE group_buy_memberships SET status = $2 ${extra} WHERE id = $1`, [id, status]);
  const statusOf = async (id: string) =>
    ((await pg.query<{ status: string }>(`SELECT status FROM group_buy_memberships WHERE id = $1`, [id])).rows[0] ?? {}).status;

  console.log("birth");

  await test("a request is born pending_payment", async () => {
    await insert({ id: "m_born" });
    assert.strictEqual(await statusOf("m_born"), "pending_payment");
  });

  await test("a request cannot be born approved (or any later state)", async () => {
    for (const s of ["paid_pending_approval", "approved", "rejected", "refunded", "revoked"]) {
      await rejects(insert({ customer: "c_bea", gb: "gb_a2", status: s }), /must start as pending_payment/);
    }
  });

  await test("the fee must be a positive amount", async () => {
    await rejects(insert({ customer: "c_bea", amount: 0 }), /amount/i);
    await rejects(insert({ customer: "c_bea", amount: -100 }), /amount/i);
  });

  await test("the round must belong to the same store", async () => {
    await rejects(insert({ customer: "c_bea", tenant: "t_b", gb: "gb_a" }), /same store/);
  });

  await test("an unknown status is refused", async () => {
    await rejects(setStatus("m_born", "cancelled"), /status/);
  });

  console.log("lifecycle");

  await test("no skipping: pending_payment → approved is refused", async () => {
    await rejects(setStatus("m_born", "approved"), /cannot move from pending_payment to approved/);
  });

  await test("the legal path pending → paid → approved → revoked", async () => {
    await setStatus("m_born", "paid_pending_approval");
    await setStatus("m_born", "approved");
    await rejects(setStatus("m_born", "revoked"), /reason/);
    await setStatus("m_born", "revoked", `, "reviewReason" = 'Shared prices'`);
    assert.strictEqual(await statusOf("m_born"), "revoked");
  });

  await test("no going backwards (revoked → approved, approved → pending)", async () => {
    await rejects(setStatus("m_born", "approved"), /cannot move/);
    await insert({ id: "m_back", customer: "c_bea" });
    await setStatus("m_back", "paid_pending_approval");
    await rejects(setStatus("m_back", "pending_payment"), /cannot move/);
  });

  await test("reject needs a reason; refund needs a refund reference", async () => {
    await rejects(setStatus("m_back", "rejected"), /reason/);
    await rejects(setStatus("m_back", "rejected", `, "reviewReason" = '   '`), /reason/);
    await setStatus("m_back", "rejected", `, "reviewReason" = 'Wrong amount'`);
    await rejects(setStatus("m_back", "refunded"), /refund reference/);
    await setStatus("m_back", "refunded", `, "refundReference" = 'GC-1234'`);
    assert.strictEqual(await statusOf("m_back"), "refunded");
  });

  await test("refunded is terminal", async () => {
    for (const s of ["pending_payment", "paid_pending_approval", "approved", "rejected", "revoked"]) {
      await rejects(setStatus("m_back", s, `, "reviewReason" = 'x'`), /cannot move/);
    }
  });

  console.log("no double payments");

  await test("a second live request for the same customer + round is refused", async () => {
    await insert({ id: "m_live", customer: "c_bea" }); // bea's previous one is refunded → slot is free
    await rejects(insert({ customer: "c_bea" }), /group_buy_memberships_one_live|duplicate key/);
  });

  await test("a revoked member cannot open a fresh request on that round", async () => {
    // ana was revoked on gb_a above
    await rejects(insert({ customer: "c_ana" }), /group_buy_memberships_one_live|duplicate key/);
  });

  await test("access is per round: the same customer can request another round", async () => {
    await insert({ id: "m_other_round", customer: "c_ana", gb: "gb_a2" });
  });

  console.log("immutability");

  await test("tenant, round, customer and amount cannot be rewritten", async () => {
    await rejects(pg.query(`UPDATE group_buy_memberships SET "amountCents" = 1 WHERE id = 'm_live'`), /cannot be changed/);
    await rejects(pg.query(`UPDATE group_buy_memberships SET "tenantId" = 't_b' WHERE id = 'm_live'`), /cannot be changed/);
    await rejects(pg.query(`UPDATE group_buy_memberships SET "groupBuyId" = 'gb_a2' WHERE id = 'm_live'`), /cannot be changed/);
    await rejects(pg.query(`UPDATE group_buy_memberships SET "customerId" = 'c_ana' WHERE id = 'm_live'`), /cannot be changed/);
  });

  await test("ordinary fields (reference, receipt) can still be written", async () => {
    await pg.query(`UPDATE group_buy_memberships SET reference = 'REF-777', method = 'GCash' WHERE id = 'm_live'`);
  });

  console.log("deletes");

  await test("deleting the customer keeps the paid record (customerId → NULL)", async () => {
    await pg.query(`DELETE FROM storefront_customers WHERE id = 'c_bea'`);
    const row = (await pg.query<{ customerId: string | null; customerEmail: string }>(
      `SELECT "customerId", "customerEmail" FROM group_buy_memberships WHERE id = 'm_live'`,
    )).rows[0];
    assert.strictEqual(row.customerId, null);
    assert.strictEqual(row.customerEmail, "ana@example.com");
  });

  await test("a round that has requests cannot be deleted", async () => {
    await rejects(pg.query(`DELETE FROM group_buys WHERE id = 'gb_a'`), /foreign key|violates/);
  });

  console.log("audit log");

  await test("events can be appended but never edited", async () => {
    await pg.query(
      `INSERT INTO group_buy_membership_events (id, "tenantId", "membershipId", "fromStatus", "toStatus", "actorKind", "actorId", reason)
       VALUES ('e1', 't_a', 'm_live', NULL, 'pending_payment', 'customer', 'c_bea', '')`,
    );
    await rejects(pg.query(`UPDATE group_buy_membership_events SET reason = 'edited' WHERE id = 'e1'`), /append-only/);
  });

  await test("an event must point at a request in the same store", async () => {
    await rejects(
      pg.query(
        `INSERT INTO group_buy_membership_events (id, "tenantId", "membershipId", "toStatus", "actorKind")
         VALUES ('e2', 't_b', 'm_live', 'approved', 'owner')`,
      ),
      /same store/,
    );
  });

  await test("deleting a whole store still cascades (offboarding works)", async () => {
    await pg.query(`DELETE FROM tenants WHERE id = 't_b'`);
    await pg.query(`DELETE FROM tenants WHERE id = 't_a'`);
    const left = (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM group_buy_memberships`)).rows[0].n;
    assert.strictEqual(left, 0);
  });

  await pg.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
