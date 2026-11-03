// Member tracker (mnm-pepsabuy, 2026-11-03): "how many group buys did each
// customer join — for the whole of December, for the last 3 months?"
// A member = the round report's definition (account, email OR phone, chained).
// A round counts once per member, in the window where they ORDERED in it.
//
// Run: npm run test:gb-participation

import assert from "node:assert";
import {
  buildParticipation,
  participationWindow,
  monthOptions,
  type ParticipationOrder,
} from "../src/lib/storefront/gb-participation";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

const NOW = new Date("2027-01-15T04:00:00Z"); // 15 Jan 2027, Manila noon
const o = (roundId: string, date: string, customer: ParticipationOrder["customer"], total = 1000, status = "confirmed"): ParticipationOrder => ({
  roundId,
  roundName: `GB ${roundId}`,
  date,
  status,
  total,
  customer,
});
const erika = { name: "Erika", email: "erika@x.com", phone: "0917 555 0101" };
const ORDERS: ParticipationOrder[] = [
  o("oct", "2026-10-10T02:00:00Z", erika),
  o("dec1", "2026-12-02T02:00:00Z", erika),
  o("dec1", "2026-12-03T02:00:00Z", { name: "Erika M", phone: "+63 917 555 0101" }, 500), // same member (phone), same round
  o("dec2", "2026-12-20T02:00:00Z", { email: "ERIKA@x.com" }),                           // same member (email)
  o("dec2", "2026-12-21T02:00:00Z", { name: "Jo", email: "jo@x.com" }),
  o("jan", "2027-01-05T02:00:00Z", { name: "Jo", email: "jo@x.com" }, 2000, "cancelled"), // cancelled = not joined
];

console.log("windows");
check("a calendar month (Manila time) — 1 Dec 00:00 to 1 Jan 00:00", () => {
  const w = participationWindow({ kind: "month", month: "2026-12" }, NOW);
  assert.equal(w.from?.toISOString(), "2026-11-30T16:00:00.000Z");
  assert.equal(w.to?.toISOString(), "2026-12-31T16:00:00.000Z");
});
check("last 3 months = the 3 calendar months before this one plus this one so far", () => {
  const w = participationWindow({ kind: "last", months: 3 }, NOW);
  assert.equal(w.from?.toISOString(), "2026-09-30T16:00:00.000Z"); // 1 Oct
  assert.equal(w.to, null);
});
check("all time is unbounded", () => {
  const w = participationWindow({ kind: "all" }, NOW);
  assert.equal(w.from, null);
  assert.equal(w.to, null);
});
check("month picker lists this month first, newest → oldest, from the first order", () => {
  const months = monthOptions(ORDERS, NOW);
  assert.deepEqual(months.map((m) => m.value), ["2027-01", "2026-12", "2026-11", "2026-10"]);
  assert.equal(months[1].label, "December 2026");
});

console.log("counting");
check("December: Erika joined 2 group buys (3 checkouts merged into one member)", () => {
  const rows = buildParticipation(ORDERS, participationWindow({ kind: "month", month: "2026-12" }, NOW));
  const e = rows.find((r) => r.email === "erika@x.com");
  assert.ok(e, "Erika present");
  assert.equal(e!.groupBuys, 2);
  assert.equal(e!.checkouts, 3);
  assert.equal(e!.spent, 2500);
  assert.deepEqual(e!.rounds, ["GB dec1", "GB dec2"]);
});
check("all time: Erika joined 3, Jo 1 (the cancelled January order doesn't count)", () => {
  const rows = buildParticipation(ORDERS, participationWindow({ kind: "all" }, NOW));
  assert.equal(rows.find((r) => r.email === "erika@x.com")?.groupBuys, 3);
  assert.equal(rows.find((r) => r.email === "jo@x.com")?.groupBuys, 1);
});
check("ranked by group buys joined, then spend; nobody outside the window", () => {
  const rows = buildParticipation(ORDERS, participationWindow({ kind: "month", month: "2026-10" }, NOW));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, "erika@x.com");
  const all = buildParticipation(ORDERS, participationWindow({ kind: "all" }, NOW));
  assert.equal(all[0].email, "erika@x.com");
});
check("identity links across the whole history, not just the window", () => {
  // In December alone, the email-only order still merges with Erika's phone order.
  const rows = buildParticipation(ORDERS, participationWindow({ kind: "month", month: "2026-12" }, NOW));
  assert.equal(rows.filter((r) => r.email === "erika@x.com" || r.contact.includes("0917")).length, 1);
});
check("the newest name/contact wins, and last joined is the newest counted order", () => {
  const [e] = buildParticipation(ORDERS, participationWindow({ kind: "all" }, NOW));
  assert.equal(e.name, "Erika M");
  assert.equal(e.lastJoinedAt, "2026-12-20T02:00:00Z");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
