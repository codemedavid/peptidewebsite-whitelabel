/**
 * Self-contained test for the store-admin Customers analytics core:
 *
 *   - src/lib/storefront/customer-analytics.ts
 *       buildAccountStats()  — orders / spent / avg / last / segment / lapsed / recent
 *       buildCustomerKpis()  — all-time vs windowed KPIs
 *       buildRevenueTrend()  — bucket counts per period, money lands in the right bucket
 *       buildSegments()      — VIP / Repeat / One-time / No orders, shares sum to 100
 *       buildLeaders()       — by spend vs by orders, bar % relative to #1
 *       topSpenderShare()    — top-3 share of account revenue
 *       buildAttention()     — no-order accounts + quiet 45d+ buyers
 *       filterCustomers()    — every table filter + search (name/email/phone digits)
 *       customersCsv()       — escaping + spreadsheet formula-injection guard
 *
 *   npm run test:customer-analytics
 */

import assert from "node:assert";
import {
  LAPSED_DAYS,
  VIP_SPEND,
  buildAccountStats,
  buildAttention,
  buildCustomerKpis,
  buildLeaders,
  buildRevenueTrend,
  buildSegments,
  countByFilter,
  csvCell,
  customersCsv,
  filterCustomers,
  topSpenderShare,
  type AccountInput,
  type LedgerEntry,
} from "../src/lib/storefront/customer-analytics";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

const NOW = new Date(2026, 9, 29, 12, 0, 0); // local Oct 29 2026, noon
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const acct = (id: string, over: Partial<AccountInput> = {}): AccountInput => ({
  id,
  name: id.toUpperCase(),
  email: `${id}@mail.com`,
  phone: "",
  status: "active",
  joinedAt: daysAgo(100),
  ...over,
});
const sale = (accountId: string, total: number, ago: number): LedgerEntry => ({ accountId, at: daysAgo(ago), total });

const accounts = [
  acct("vip", { name: "Maria Santos" }),
  acct("rep", { name: "Carlo Mendoza", phone: "+63 917 555 0101" }),
  acct("one", { name: "Rina Bautista" }),
  acct("quiet", { name: "Hannah Garcia" }),
  acct("new", { name: "Joel Navarro", joinedAt: daysAgo(2) }),
  acct("off", { name: "Leo Fernandez", status: "disabled" }),
  acct("gb", { name: "gb.joiner", emailOnly: true, unlinkedOrders: 2 }),
];
const ledger: LedgerEntry[] = [
  sale("vip", 20_000, 1),
  sale("vip", 10_000, 40),
  sale("rep", 3_000, 3),
  sale("rep", 2_000, 20),
  sale("one", 1_500, 10),
  sale("quiet", 4_000, 60),
  sale("quiet", 1_000, 80),
];
const stats = buildAccountStats(accounts, ledger, NOW);

console.log("\nbuildAccountStats");
check("totals, average, last order and segments", () => {
  const vip = stats.get("vip")!;
  assert.equal(vip.orders, 2);
  assert.equal(vip.spent, 30_000);
  assert.equal(vip.avg, 15_000);
  assert.equal(vip.lastAt, daysAgo(1));
  assert.equal(vip.segment, "vip", `≥ ${VIP_SPEND} is VIP`);
  assert.equal(stats.get("rep")!.segment, "repeat");
  assert.equal(stats.get("one")!.segment, "one");
  assert.equal(stats.get("new")!.segment, "none");
});
check(`lapsed = bought, but nothing in ${LAPSED_DAYS} days; recent = within 30`, () => {
  assert.equal(stats.get("quiet")!.lapsed, true);
  assert.equal(stats.get("vip")!.lapsed, false);
  assert.equal(stats.get("new")!.lapsed, false, "never bought is not lapsed");
  assert.equal(stats.get("rep")!.recent, true);
  assert.equal(stats.get("quiet")!.recent, false);
});

console.log("\nbuildCustomerKpis");
check("all time: totals over every account and order", () => {
  const k = Object.fromEntries(buildCustomerKpis({ accounts, ledger, stats, period: "all", now: NOW }).map((x) => [x.id, x]));
  assert.equal(k.total.value, 7);
  assert.equal(k.total.sub, "1 joined this week · 1 email-only");
  assert.equal(k["with-orders"].value, 4);
  assert.equal(k.spent.value, 41_500);
  assert.equal(k.spent.sub, "7 orders");
  assert.equal(Math.round(k.aov.value), Math.round(41_500 / 7));
  assert.equal(k.repeat.value, 3 / 4);
  assert.equal(k.repeat.sub, "3 of 4 buyers");
});
check("7 days: only that window's orders and sign-ups", () => {
  const k = Object.fromEntries(buildCustomerKpis({ accounts, ledger, stats, period: "7d", now: NOW }).map((x) => [x.id, x]));
  assert.equal(k.new.value, 1);
  assert.equal(k.active.value, 2, "vip + rep ordered this week");
  assert.equal(k.revenue.value, 23_000);
  assert.equal(k.repeat.sub, "2 of 2 buyers", "repeat counts lifetime orders of this window's buyers");
});
check("no orders at all → zeros, no NaN", () => {
  const k = buildCustomerKpis({ accounts, ledger: [], stats: buildAccountStats(accounts, [], NOW), period: "30d", now: NOW });
  assert.ok(k.every((x) => Number.isFinite(x.value)));
});

console.log("\nbuildRevenueTrend");
check("bucket counts per period", () => {
  assert.equal(buildRevenueTrend(ledger, "7d", NOW).bars.length, 7);
  assert.equal(buildRevenueTrend(ledger, "30d", NOW).bars.length, 5);
  assert.equal(buildRevenueTrend(ledger, "90d", NOW).bars.length, 3);
  assert.equal(buildRevenueTrend(ledger, "all", NOW).bars.length, 6);
});
check("money lands in the right bucket, and only in-window money counts", () => {
  const week = buildRevenueTrend(ledger, "7d", NOW);
  assert.equal(week.bars.reduce((s, b) => s + b.total, 0), 23_000);
  assert.equal(week.bars[week.bars.length - 2].total, 20_000, "yesterday's ₱20,000");
  const month = buildRevenueTrend(ledger, "30d", NOW);
  assert.equal(month.bars.reduce((s, b) => s + b.total, 0), 20_000 + 3_000 + 2_000 + 1_500);
});

console.log("\nbuildSegments");
check("counts, revenue and shares that add up", () => {
  const seg = Object.fromEntries(buildSegments(accounts, stats, "rule").map((s) => [s.key, s]));
  assert.equal(seg.vip.count, 1);
  assert.equal(seg.vip.revenue, 30_000);
  assert.equal(seg.repeat.count, 2, "rep + quiet");
  assert.equal(seg.none.count, 3, "new + off + gb");
  const sum = Object.values(seg).reduce((s, x) => s + x.pct, 0);
  assert.ok(Math.abs(sum - 100) < 1e-9);
});

console.log("\nbuildLeaders / topSpenderShare");
check("by spend: biggest first, bar relative to #1, non-buyers excluded", () => {
  const rows = buildLeaders(accounts, stats, "spend");
  assert.deepEqual(rows.map((r) => r.id), ["vip", "rep", "quiet", "one"]);
  assert.equal(rows[0].pct, 100);
  assert.equal(rows[1].pct, Math.round((5_000 / 30_000) * 100));
});
check("by orders: most orders first, spend breaks ties", () => {
  assert.deepEqual(buildLeaders(accounts, stats, "orders").map((r) => r.id), ["vip", "rep", "quiet", "one"]);
});
check("top-3 share of account revenue; null without revenue", () => {
  assert.equal(topSpenderShare(stats), (30_000 + 5_000 + 5_000) / 41_500);
  assert.equal(topSpenderShare(buildAccountStats(accounts, [], NOW)), null);
});

console.log("\nbuildAttention");
check("no-order accounts and quiet buyers (biggest spender named first)", () => {
  const a = buildAttention(accounts, stats, NOW);
  assert.equal(a.noOrders.count, 3);
  assert.deepEqual(a.toLink, { accounts: 1, orders: 2 });
  assert.equal(a.noOrders.joinedThisWeek, 1);
  assert.equal(a.lapsed.count, 1);
  assert.deepEqual(a.lapsed.names, ["Hannah Garcia"]);
  assert.equal(a.lapsed.lastAt, daysAgo(60));
});

console.log("\nfilterCustomers / countByFilter");
check("each filter's membership and order", () => {
  const ids = (f: Parameters<typeof filterCustomers>[2], q = "") => filterCustomers(accounts, stats, f, q).map((a) => a.id);
  assert.deepEqual(ids("top"), ["vip", "rep", "quiet", "one"]);
  assert.deepEqual(ids("recent"), ["vip", "rep", "one"]);
  assert.deepEqual(ids("lapsed"), ["quiet"]);
  assert.deepEqual(ids("none").sort(), ["gb", "new", "off"]);
  assert.deepEqual(ids("unlinked"), ["gb"]);
  assert.deepEqual(ids("email-only"), ["gb"]);
  assert.deepEqual(ids("disabled"), ["off"]);
  assert.equal(ids("all")[0], "new", "All = newest first (gb joined 100 days ago)");
});
check("search matches name, email, and phone digits", () => {
  assert.deepEqual(filterCustomers(accounts, stats, "all", "maria").map((a) => a.id), ["vip"]);
  assert.deepEqual(filterCustomers(accounts, stats, "all", "QUIET@").map((a) => a.id), ["quiet"]);
  assert.deepEqual(filterCustomers(accounts, stats, "all", "0917-555").map((a) => a.id), ["rep"]);
});
check("counts match filters", () => {
  const c = countByFilter(accounts, stats);
  assert.equal(c.all, 7);
  assert.equal(c.top, 4);
  assert.equal(c.none, 3);
  assert.equal(c["email-only"], 1);
  assert.equal(c.unlinked, 1);
  assert.equal(c.disabled, 1);
});

console.log("\ncustomersCsv");
check("quotes commas/quotes and neutralizes formula cells", () => {
  assert.equal(csvCell('Cruz, "Paolo"'), '"Cruz, ""Paolo"""');
  assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell("+639175550101"), "'+639175550101");
  assert.equal(csvCell("@evil"), "'@evil");
});
check("money columns only when stats are given", () => {
  const withMoney = customersCsv([accounts[0]], stats).split("\n");
  assert.equal(withMoney[0], "Name,Email,Phone,Status,Account,Joined,Segment,Orders,Total spent,Avg order,Last order");
  assert.ok(withMoney[1].includes("VIP,2,30000.00,15000.00"));
  assert.equal(customersCsv([accounts[0]], null).split("\n")[0], "Name,Email,Phone,Status,Account,Joined");
  assert.ok(customersCsv([accounts[6]], null).includes(",email only,"));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
