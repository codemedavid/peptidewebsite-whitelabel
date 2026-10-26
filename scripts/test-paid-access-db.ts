/**
 * Paid Access — the rules the DATABASE enforces (src/modules/paid-access/sql/paid-access.sql),
 * so no code path (a new action, a script, a hand-run UPDATE) can skip a step,
 * oversell a slot, re-price a payment or rewrite the audit log.
 *
 * Boots the real schema in in-process PGlite, applies the SQL twice (it must
 * be idempotent), then attacks it with raw SQL. The status matrix is checked
 * against the pure machine (itself checked against a hand-written oracle in
 * test:paid-access-core): every status pair, for every preset.
 *
 *   npm run test:paid-access-db
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import {
  PAID_ACCESS_PRESET_IDS,
  PAID_ACCESS_STATUSES,
  edgeAllowed,
  firstStatus,
  presetSettings,
  type PaidAccessSettings,
  type PaidAccessStep,
} from "../src/modules/paid-access/core";

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

const AMOUNT = 50000;
const snap = (steps: PaidAccessStep[]): PaidAccessSettings => ({
  ...presetSettings("pay_then_approve"),
  steps,
  payment: { ...presetSettings("pay_then_approve").payment, amountCents: AMOUNT },
});

async function main() {
  const schema = path.join(process.cwd(), "prisma", "schema.prisma");
  const ddl = execSync(`npx prisma migrate diff --from-empty --to-schema-datamodel "${schema}" --script`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const rules = readFileSync(path.join(process.cwd(), "src", "modules", "paid-access", "sql", "paid-access.sql"), "utf8");

  const pg = new PGlite();
  await pg.exec(ddl);

  await test("rules file applies, and re-applies cleanly (idempotent)", async () => {
    await pg.exec(rules);
    await pg.exec(rules);
  });

  await pg.exec(`
    INSERT INTO plans (id, key, name) VALUES ('p_1', 'basic', 'Basic');
    INSERT INTO tenants (id, slug, name, "planId") VALUES ('t_a', 'store-a', 'Store A', 'p_1'), ('t_b', 'store-b', 'Store B', 'p_1');
    INSERT INTO group_buys (id, "tenantId", name) VALUES
      ('gb_a', 't_a', 'Round A'), ('gb_cap', 't_a', 'Capped'), ('gb_mx', 't_a', 'Matrix'), ('gb_b', 't_b', 'Round B');
    INSERT INTO storefront_customers (id, "tenantId", email, name, "passwordHash", "updatedAt") VALUES
      ('c_ana', 't_a', 'ana@example.com', 'Ana', 'x', now()),
      ('c_bea', 't_a', 'bea@example.com', 'Bea', 'x', now()),
      ('c_cy', 't_a', 'cy@example.com', 'Cy', 'x', now()),
      ('c_dee', 't_a', 'dee@example.com', 'Dee', 'x', now());
    INSERT INTO paid_access_flows (id, "tenantId", "groupBuyId", settings, "maxSlots", "updatedAt") VALUES
      ('f_a', 't_a', 'gb_a', '{}', NULL, now()),
      ('f_cap', 't_a', 'gb_cap', '{}', 2, now()),
      ('f_mx', 't_a', 'gb_mx', '{}', NULL, now()),
      ('f_b', 't_b', 'gb_b', '{}', NULL, now());
  `);

  let seq = 0;
  type Ins = { id?: string; tenant?: string; flow?: string; gb?: string; customer?: string | null; status?: string; steps?: PaidAccessStep[] };
  const insert = (o: Ins = {}) => {
    const steps = o.steps ?? ["payment", "approval"];
    return pg.query(
      `INSERT INTO paid_access_memberships (id, "tenantId", "flowId", "groupBuyId", "customerId", "customerName", "customerEmail",
         status, "settingsSnapshot", "settingsVersion", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'Ana', 'ana@example.com', $6, $7, 1, now())`,
      [
        o.id ?? `m_${++seq}`,
        o.tenant ?? "t_a",
        o.flow ?? "f_a",
        o.gb ?? "gb_a",
        o.customer === undefined ? "c_ana" : o.customer,
        o.status ?? firstStatus(steps),
        JSON.stringify(snap(steps)),
      ],
    );
  };
  const update = (id: string, set: string, params: unknown[] = []) =>
    pg.query(`UPDATE paid_access_memberships SET ${set} WHERE id = $1`, [id, ...params]);
  const one = async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows[0];
  const slotsTaken = async (flow: string) =>
    (await one<{ slotsTaken: number }>(`SELECT "slotsTaken" FROM paid_access_flows WHERE id = $1`, [flow]))!.slotsTaken;

  console.log("\nbirth");

  await test("a membership is born at its snapshot's first step (or on the waitlist)", async () => {
    await insert({ id: "m_born", customer: "c_ana" });
    await insert({ id: "m_wait", customer: "c_bea", status: "waitlisted" });
    await insert({ id: "m_open", customer: "c_cy", steps: [], status: "active" });
  });

  await test("a membership cannot be born further along (no skipping payment or approval)", async () => {
    for (const status of ["payment_review", "approval_pending", "active", "rejected"]) {
      await rejects(insert({ customer: "c_dee", status }), /must start at its first step/);
    }
  });

  await test("the round and store must match the flow", async () => {
    await rejects(insert({ customer: "c_dee", tenant: "t_b" }), /flow's store and round/);
    await rejects(insert({ customer: "c_dee", gb: "gb_b" }), /flow's store and round/);
  });

  await test("an unknown status is refused", async () => {
    await rejects(update("m_born", `status = 'approved'`), /unknown status/);
  });

  console.log("\nstatus × status, every preset (DB vs the pure machine)");

  for (const id of [...PAID_ACCESS_PRESET_IDS, "form_pay_approve"] as const) {
    const steps: PaidAccessStep[] = id === "form_pay_approve" ? ["form", "payment", "approval"] : presetSettings(id).steps;
    await test(`${id}: the database allows exactly the machine's edges`, async () => {
      const s = snap(steps);
      const mid = `mx_${id}`;
      await pg.query(
        `INSERT INTO paid_access_memberships (id, "tenantId", "flowId", "groupBuyId", "customerId", "customerName", "customerEmail",
           status, "settingsSnapshot", "settingsVersion", "updatedAt")
         VALUES ($1, 't_a', 'f_mx', 'gb_mx', NULL, 'X', 'x@example.com', 'waitlisted', $2, 1, now())`,
        [mid, JSON.stringify(s)],
      );
      // Headroom on the counter: the placement above bypasses it, the moves below don't.
      await pg.exec(`ALTER TABLE paid_access_flows DISABLE TRIGGER USER`);
      await pg.query(`UPDATE paid_access_flows SET "slotsTaken" = 100000 WHERE id = 'f_mx'`);
      await pg.exec(`ALTER TABLE paid_access_flows ENABLE TRIGGER USER`);
      let checked = 0;
      for (const from of PAID_ACCESS_STATUSES) {
        for (const to of PAID_ACCESS_STATUSES) {
          if (from === to) continue;
          // Place the row at `from` behind the rules' back, then try the move.
          await pg.exec(`ALTER TABLE paid_access_memberships DISABLE TRIGGER USER`);
          await pg.query(`UPDATE paid_access_memberships SET status = $2, "reviewReason" = 'r', "refundStatus" = 'none' WHERE id = $1`, [mid, from]);
          await pg.exec(`ALTER TABLE paid_access_memberships ENABLE TRIGGER USER`);
          let ok = true;
          try {
            await pg.query(`UPDATE paid_access_memberships SET status = $2 WHERE id = $1`, [mid, to]);
          } catch {
            ok = false;
          }
          assert.strictEqual(ok, edgeAllowed(from, to, s), `${from} → ${to}: db ${ok ? "allowed" : "refused"}`);
          checked++;
        }
      }
      assert.strictEqual(checked, 90);
    });
  }

  console.log("\nreasons, immutables, one live membership");

  await test("rejecting and revoking need a reason", async () => {
    await insert({ id: "m_rr", customer: "c_dee", flow: "f_a" });
    await rejects(update("m_rr", `status = 'rejected', "reviewReason" = '  '`), /needs a reason/);
    await update("m_rr", `status = 'rejected', "reviewReason" = 'Wrong amount'`);
  });

  await test("store, flow, round, snapshot and version can never change; the customer only to NULL", async () => {
    await rejects(update("m_born", `"tenantId" = 't_b'`), /cannot be changed/);
    await rejects(update("m_born", `"flowId" = 'f_cap'`), /cannot be changed/);
    await rejects(update("m_born", `"groupBuyId" = 'gb_cap'`), /cannot be changed/);
    await rejects(update("m_born", `"settingsSnapshot" = '{"steps":[]}'`), /cannot be changed/);
    await rejects(update("m_born", `"settingsVersion" = 2`), /cannot be changed/);
    await rejects(update("m_born", `"customerId" = 'c_bea'`), /cannot be changed/);
  });

  await test("one live membership per customer per round (no double-joining)", async () => {
    await rejects(insert({ customer: "c_ana" }), /duplicate key|unique/i);
    await rejects(insert({ customer: "c_bea", status: "waitlisted" }), /duplicate key|unique/i);
  });

  await test("a rejection with a refund still owed blocks re-joining; once refunded it frees the customer", async () => {
    await update("m_rr", `"refundStatus" = 'pending'`);
    await rejects(insert({ customer: "c_dee" }), /duplicate key|unique/i);
    await rejects(update("m_rr", `"refundStatus" = 'refunded'`), /refund reference/);
    await update("m_rr", `"refundStatus" = 'refunded', "refundReference" = 'GC-REFUND-1'`);
    await insert({ id: "m_dee2", customer: "c_dee" });
  });

  await test("refund statuses only move forward, and only on a rejected membership", async () => {
    await rejects(update("m_rr", `"refundStatus" = 'pending'`), /refund cannot move/);
    await rejects(update("m_born", `"refundStatus" = 'pending'`), /only a rejected/);
  });

  console.log("\nslots (capacity 2)");

  await test("slots are counted by the database and can't be oversold", async () => {
    await insert({ id: "s1", customer: "c_ana", flow: "f_cap", gb: "gb_cap" });
    await insert({ id: "s2", customer: "c_bea", flow: "f_cap", gb: "gb_cap" });
    assert.strictEqual(await slotsTaken("f_cap"), 2);
    await rejects(insert({ id: "s3", customer: "c_cy", flow: "f_cap", gb: "gb_cap" }), /PAID_ACCESS_FULL/);
    assert.strictEqual(await slotsTaken("f_cap"), 2);
  });

  await test("a full round still takes waitlisters (they hold no slot)", async () => {
    await insert({ id: "s3w", customer: "c_cy", flow: "f_cap", gb: "gb_cap", status: "waitlisted" });
    assert.strictEqual(await slotsTaken("f_cap"), 2);
  });

  await test("promoting from the waitlist needs a free slot", async () => {
    await rejects(update("s3w", `status = 'payment_pending'`), /PAID_ACCESS_FULL/);
  });

  await test("an expired payment releases its slot, and the waitlister can take it", async () => {
    await update("s1", `status = 'expired'`);
    assert.strictEqual(await slotsTaken("f_cap"), 1);
    await update("s3w", `status = 'payment_pending'`);
    assert.strictEqual(await slotsTaken("f_cap"), 2);
  });

  await test("moving between slot-holding steps keeps the count; leaving releases it", async () => {
    await update("s2", `status = 'payment_review'`);
    await update("s2", `status = 'approval_pending'`);
    await update("s2", `status = 'active'`);
    assert.strictEqual(await slotsTaken("f_cap"), 2);
    await update("s2", `status = 'revoked', "reviewReason" = 'Spam'`);
    assert.strictEqual(await slotsTaken("f_cap"), 1);
  });

  await test("app code can't write the slot counter by hand", async () => {
    await rejects(pg.query(`UPDATE paid_access_flows SET "slotsTaken" = 0 WHERE id = 'f_cap'`), /slot counter/);
    await rejects(
      pg.query(`INSERT INTO paid_access_flows (id, "tenantId", "groupBuyId", settings, "slotsTaken", "updatedAt") VALUES ('f_x', 't_a', 'gb_mx', '{}', 5, now())`),
      /slot counter|duplicate/,
    );
  });

  await test("a flow belongs to its round's store, and can't be moved", async () => {
    await rejects(
      pg.query(`INSERT INTO paid_access_flows (id, "tenantId", "groupBuyId", settings, "updatedAt") VALUES ('f_bad', 't_b', 'gb_a', '{}', now())`),
      /same store|duplicate/,
    );
    await rejects(pg.query(`UPDATE paid_access_flows SET "groupBuyId" = 'gb_b' WHERE id = 'f_a'`), /cannot be changed/);
    await pg.query(`UPDATE paid_access_flows SET "maxSlots" = 1, version = version + 1 WHERE id = 'f_cap'`);
  });

  console.log("\nmoney");

  const pay = (o: { id: string; m: string; amount?: number; status?: string; provider?: string; ref?: string | null; tenant?: string; kind?: string }) =>
    pg.query(
      `INSERT INTO paid_access_payments (id, "tenantId", "membershipId", provider, "providerRef", "amountCents", kind, status, "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [o.id, o.tenant ?? "t_a", o.m, o.provider ?? "manual", o.ref ?? null, o.amount ?? AMOUNT, o.kind ?? "full", o.status ?? "submitted"],
    );
  const payUpdate = (id: string, set: string) => pg.query(`UPDATE paid_access_payments SET ${set} WHERE id = $1`, [id]);

  await test("a payment must charge exactly the member's snapshot price", async () => {
    await rejects(pay({ id: "p_cheap", m: "m_born", amount: 1 }), /snapshot price/);
    await rejects(pay({ id: "p_kind", m: "m_born", kind: "deposit" }), /snapshot/);
    await pay({ id: "p_1", m: "m_born" });
  });

  await test("no payment can be taken on a flow without a payment step", async () => {
    await rejects(pay({ id: "p_free", m: "m_open" }), /no payment step/);
  });

  await test("a payment belongs to its membership's store", async () => {
    await rejects(pay({ id: "p_x", m: "m_born", tenant: "t_b" }), /same store/);
  });

  await test("one proof under review at a time, and at most one confirmed payment (no double charge)", async () => {
    await rejects(pay({ id: "p_2", m: "m_born" }), /duplicate key|unique/i);
    await payUpdate("p_1", `status = 'confirmed'`);
    await rejects(pay({ id: "p_3", m: "m_born", provider: "fake", ref: "chk_1", status: "initiated" }).then(() => payUpdate("p_3", `status = 'confirmed'`)), /duplicate key|unique/i);
  });

  await test("a provider's charge can only be recorded once", async () => {
    await pay({ id: "p_on1", m: "m_dee2", provider: "fake", ref: "chk_dup", status: "initiated" });
    await rejects(pay({ id: "p_on2", m: "m_dee2", provider: "fake", ref: "chk_dup", status: "initiated" }), /duplicate key|unique/i);
  });

  await test("payment statuses only move forward; amount and provider are immutable", async () => {
    await rejects(payUpdate("p_1", `status = 'submitted'`), /cannot move/);
    await rejects(payUpdate("p_1", `"amountCents" = 1`), /cannot be changed/);
    await rejects(payUpdate("p_on1", `provider = 'manual'`), /cannot be changed/);
    await rejects(pay({ id: "p_born_ok", m: "m_dee2", status: "confirmed" }), /must start/);
  });

  await test("a rejected proof needs a reason", async () => {
    await pay({ id: "p_rej", m: "m_dee2" });
    await rejects(payUpdate("p_rej", `status = 'rejected'`), /reason/);
    await payUpdate("p_rej", `status = 'rejected', "rejectReason" = 'Blurry'`);
  });

  await test("a deposit is credited to one order, once", async () => {
    await rejects(payUpdate("p_1", `"creditedOrderId" = 'o_1'`), /deposit/);
  });

  console.log("\naudit log");

  await test("the audit log is append-only and stays in its store", async () => {
    await pg.query(
      `INSERT INTO paid_access_events (id, "tenantId", "groupBuyId", "membershipId", kind, "actorKind") VALUES ('e_1', 't_a', 'gb_a', 'm_born', 'transition', 'admin')`,
    );
    await rejects(pg.query(`UPDATE paid_access_events SET reason = 'edited' WHERE id = 'e_1'`), /append-only/);
    await rejects(
      pg.query(`INSERT INTO paid_access_events (id, "tenantId", "groupBuyId", "membershipId", kind, "actorKind") VALUES ('e_2', 't_b', 'gb_a', 'm_born', 'transition', 'admin')`),
      /same store/,
    );
  });

  console.log("\ndeletion");

  await test("a round with members can't be deleted on its own", async () => {
    await rejects(pg.query(`DELETE FROM group_buys WHERE id = 'gb_a'`), /foreign key|violates/i);
  });

  await test("deleting the customer keeps the membership and its payment (SetNull)", async () => {
    await pg.query(`DELETE FROM storefront_customers WHERE id = 'c_ana'`);
    const m = await one<{ customerId: string | null }>(`SELECT "customerId" FROM paid_access_memberships WHERE id = 'm_born'`);
    assert.strictEqual(m!.customerId, null);
  });

  await test("deleting a whole store still cascades (offboarding works)", async () => {
    await pg.query(`DELETE FROM tenants WHERE id = 't_a'`);
    const left = await one<{ n: number }>(`SELECT count(*)::int AS n FROM paid_access_memberships WHERE "tenantId" = 't_a'`);
    assert.strictEqual(left!.n, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
