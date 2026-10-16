/**
 * Gate for src/lib/db/pool-config.ts — how DATABASE_URL becomes a node-postgres
 * pool behind Prisma's driver adapter (see the header of that file for why).
 *
 *   npm run test:db-pool-config
 */
import assert from "node:assert";

import { DEFAULT_POOL_MAX, pgAdapterSchema, pgPoolConfig } from "../src/lib/db/pool-config";

const POOLER = "postgresql://u:p@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("pool-config");

test("strips Prisma-only params the pg driver does not understand", () => {
  const cfg = pgPoolConfig({ DATABASE_URL: `${POOLER}?pgbouncer=true&connection_limit=3` });
  assert.strictEqual(cfg.connectionString, POOLER);
});

test("keeps params that pg does understand", () => {
  const cfg = pgPoolConfig({ DATABASE_URL: `${POOLER}?pgbouncer=true&application_name=pepweb` });
  assert.strictEqual(cfg.connectionString, `${POOLER}?application_name=pepweb`);
});

test("remote hosts always connect over TLS (pg's default is plaintext)", () => {
  const cfg = pgPoolConfig({ DATABASE_URL: POOLER });
  assert.deepStrictEqual(cfg.ssl, { rejectUnauthorized: false });
});

test("local databases skip TLS", () => {
  for (const host of ["localhost", "127.0.0.1"]) {
    const cfg = pgPoolConfig({ DATABASE_URL: `postgresql://u:p@${host}:5432/db` });
    assert.strictEqual(cfg.ssl, false, host);
  }
});

test("an explicit sslmode=disable is honoured", () => {
  const cfg = pgPoolConfig({ DATABASE_URL: `${POOLER}?sslmode=disable` });
  assert.strictEqual(cfg.ssl, false);
  assert.strictEqual(cfg.connectionString, POOLER);
});

test("pool size defaults small and honours connection_limit, then DB_POOL_MAX", () => {
  assert.strictEqual(pgPoolConfig({ DATABASE_URL: POOLER }).max, DEFAULT_POOL_MAX);
  assert.strictEqual(pgPoolConfig({ DATABASE_URL: `${POOLER}?connection_limit=3` }).max, 3);
  assert.strictEqual(pgPoolConfig({ DATABASE_URL: `${POOLER}?connection_limit=3`, DB_POOL_MAX: "8" }).max, 8);
});

test("a nonsense pool size falls back to the default", () => {
  for (const bad of ["0", "-2", "abc", ""]) {
    assert.strictEqual(pgPoolConfig({ DATABASE_URL: POOLER, DB_POOL_MAX: bad }).max, DEFAULT_POOL_MAX, bad);
  }
});

test("?schema= reaches the adapter (pg ignores it), so a second instance can live in its own schema", () => {
  assert.strictEqual(pgAdapterSchema({ DATABASE_URL: `${POOLER}?pgbouncer=true&schema=pepweb` }), "pepweb");
});

test("no ?schema= leaves the adapter on its default (public)", () => {
  assert.strictEqual(pgAdapterSchema({ DATABASE_URL: POOLER }), undefined);
  assert.strictEqual(pgAdapterSchema({ DATABASE_URL: `${POOLER}?schema=` }), undefined);
  assert.strictEqual(pgAdapterSchema({}), undefined);
});

test("a missing DATABASE_URL fails loudly", () => {
  assert.throws(() => pgPoolConfig({}), /DATABASE_URL/);
});

console.log(`\n${passed} passed`);
