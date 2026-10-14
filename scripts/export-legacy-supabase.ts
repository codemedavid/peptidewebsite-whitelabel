/**
 * Export a legacy store's public tables off its (still live) Supabase project,
 * through the PostgREST API, into JSON files the import scripts read.
 *
 * Built for stores on the old Vite + Supabase peptide app — the template HP
 * GLOW and The Peppy Lab ran on. Read-only against the old project.
 *
 *   LEGACY_SUPABASE_KEY=<anon key> npx tsx scripts/export-legacy-supabase.ts \
 *     --url=https://<ref>.supabase.co --out=.migration/<slug>
 *
 * The key is read from the environment, never a flag, so it stays out of shell
 * history. The output can hold customer PII (orders) — `.migration/` is
 * gitignored; delete the folder once the migration is signed off.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TABLES = [
  "products",
  "product_variations",
  "categories",
  "payment_methods",
  "vouchers",
  "shipping_locations",
  "site_settings",
  "faqs",
  "orders",
] as const;

/** PostgREST caps a page server-side; ask for well under that and walk on. */
const PAGE = 500;

function flag(name: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) throw new Error(`Missing --${name}=`);
  return hit.slice(name.length + 3);
}

async function fetchTable(base: string, key: string, table: string): Promise<unknown[]> {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${base}/rest/v1/${table}?select=*&order=created_at.asc.nullsfirst&offset=${offset}&limit=${PAGE}`;
    let res = await fetch(url, { headers });
    // Tables without created_at (e.g. site_settings) reject the order clause.
    if (res.status === 400) res = await fetch(url.replace(/&order=[^&]+/, ""), { headers });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
    const page = (await res.json()) as unknown[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function main() {
  const base = flag("url").replace(/\/+$/, "");
  const out = flag("out");
  const key = process.env.LEGACY_SUPABASE_KEY;
  if (!key) throw new Error("Set LEGACY_SUPABASE_KEY to the old project's anon key.");

  mkdirSync(join(process.cwd(), out), { recursive: true });
  console.log(`\n  Exporting ${base} → ${out}\n`);
  for (const table of TABLES) {
    try {
      const rows = await fetchTable(base, key, table);
      writeFileSync(join(process.cwd(), out, `${table}.json`), JSON.stringify(rows, null, 2));
      console.log(`  ${table.padEnd(20)} ${rows.length}`);
    } catch (err) {
      console.log(`  ${table.padEnd(20)} skipped — ${(err as Error).message.slice(0, 120)}`);
    }
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
