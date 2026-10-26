/**
 * Paid Access's walls — a static check of the source, so "GB pages talk to Paid Access
 * only through its interface" can't quietly erode.
 *
 *   npm run test:paid-access-boundary
 *
 * Checks: no app code outside src/modules/paid-access touches a paid_access_* table or
 * Prisma delegate; inside the module only server/repo.ts does; nothing outside
 * the module imports its internals (only the entry points index / client / ui
 * / actions); client components never import the server interface at runtime;
 * every server file is marked server-only; and the DB trigger lists exactly
 * the statuses the state machine defines.
 */
import assert from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { PAID_ACCESS_STATUSES } from "../src/modules/paid-access/core";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const ROOT = process.cwd();
const MODULE = path.join("src", "modules", "paid-access");

function walk(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) return name === "node_modules" ? [] : walk(rel);
    return /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
}

/** Source with comments stripped, so a comment can't trip (or satisfy) a check. */
const code = (rel: string) =>
  readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const appFiles = [...walk("src"), ...walk(path.join("mobile", "src"))];
const outside = appFiles.filter((f) => !f.startsWith(MODULE));
const inside = appFiles.filter((f) => f.startsWith(MODULE));

const TABLE_ACCESS = /\b(?:paidAccessFlow|paidAccessMembership|paidAccessPayment|paidAccessEvent|paidAccessWebhookEvent)\s*\.|\bpaid_access_(?:flows|memberships|payments|events|webhook_events)\b/;
// The delegate-name list that scopes tenant queries is configuration, not access.
const ALLOWED_OUTSIDE = new Set([path.join("src", "lib", "db", "tenant-client.ts")]);

test("no app code outside the module reads or writes Paid Access's tables", () => {
  const offenders = outside.filter((f) => !ALLOWED_OUTSIDE.has(f) && TABLE_ACCESS.test(code(f)));
  assert.deepStrictEqual(offenders, []);
});

test("inside the module, only server/repo.ts touches the tables", () => {
  const offenders = inside.filter((f) => !f.endsWith(path.join("server", "repo.ts")) && !f.endsWith(".sql") && TABLE_ACCESS.test(code(f)));
  assert.deepStrictEqual(offenders, []);
});

const ENTRY = /["']@\/modules\/paid-access(\/(client|ui|actions))?["']/;
const ANY = /["']@\/modules\/paid-access[^"']*["']/g;

test("the rest of the app imports only Paid Access's entry points (index, client, ui, actions)", () => {
  const offenders: string[] = [];
  for (const f of outside) {
    for (const m of code(f).match(ANY) ?? []) if (!ENTRY.test(m)) offenders.push(`${f}: ${m}`);
  }
  assert.deepStrictEqual(offenders, []);
});

test("GB surfaces reach access through Paid Access's interface", () => {
  const gate = code(path.join("src", "lib", "storefront", "gb-access.server.ts"));
  assert.match(gate, /from "@\/modules\/paid-access"/);
  assert.match(gate, /getAccess\(/);
});

test("client components never import the server interface at runtime", () => {
  const offenders = appFiles.filter((f) => {
    const src = readFileSync(path.join(ROOT, f), "utf8");
    if (!/^\s*["']use client["']/.test(src)) return false;
    return /^\s*import\s+(?!type\b)[^;]*from\s+["'](@\/modules\/paid-access|\.\.\/index|\.\.\/server\/[^"']+)["']/m.test(src);
  });
  assert.deepStrictEqual(offenders, []);
});

test("every module server file is marked server-only", () => {
  const server = inside.filter((f) => f.includes(`${path.sep}server${path.sep}`) || f === path.join(MODULE, "index.ts"));
  const offenders = server.filter((f) => !/^import "server-only";/m.test(readFileSync(path.join(ROOT, f), "utf8")));
  assert.deepStrictEqual(offenders, []);
});

test("the pure core imports nothing but itself and zod", () => {
  const core = inside.filter((f) => f.includes(`${path.sep}core${path.sep}`));
  const offenders = core.flatMap((f) =>
    [...code(f).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]).filter((spec) => !spec.startsWith("./") && spec !== "zod").map((spec) => `${f}: ${spec}`),
  );
  assert.deepStrictEqual(offenders, []);
});

test("the DB trigger knows exactly the machine's statuses", () => {
  const sql = readFileSync(path.join(ROOT, MODULE, "sql", "paid-access.sql"), "utf8");
  const list = /NEW\.status NOT IN \(([^)]+)\)/.exec(sql.slice(sql.indexOf("paid_access_membership_guard")));
  assert.ok(list, "status list found in the membership guard");
  const inSql = list![1].match(/'([a-z_]+)'/g)!.map((s) => s.slice(1, -1)).sort();
  assert.deepStrictEqual(inSql, [...PAID_ACCESS_STATUSES].sort());
});

test("the production deploy applies Paid Access's DB rules right after db push", () => {
  const build = (JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts["vercel-build"];
  const push = build.indexOf("prisma db push");
  const rules = build.indexOf("src/modules/paid-access/sql/paid-access.sql");
  assert.ok(push >= 0, "vercel-build pushes the schema");
  assert.ok(rules > push, "paid-access.sql is applied after db push");
  assert.ok(rules < build.indexOf("next build"), "…before the app is built");
  const prodBranch = build.slice(build.indexOf("= production ]; then"), build.lastIndexOf("; fi"));
  assert.ok(prodBranch.includes("paid-access.sql"), "only on production deploys, like db push");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
