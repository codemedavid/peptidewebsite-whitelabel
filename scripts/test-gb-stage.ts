/**
 * Group-buy stages (src/lib/storefront/gb-stage.ts).
 *
 *   npm run test:gb-stage
 *
 *   Open → [Bunuan time, only with Bunuan] → Closed (Ligwak review) → [Payment time, pay_later only]
 *
 * Admin-driven and forward-only. Start Bunuan is blocked while pay_first orders
 * await a payment check, skips straight to Closed when every kit is already
 * full, and Bunuan closes itself when the last kit fills. Payment time waits for
 * the Ligwak lock. The matrix below is spelled out by hand as an oracle.
 */
import assert from "node:assert";

import {
  GB_STAGES,
  allowedNextStages,
  autoAdvance,
  canOrder,
  editsLocked,
  normalizeGbStage,
  resolveStageMove,
  stageLabel,
  type GbStage,
  type StageContext,
} from "../src/lib/storefront/gb-stage";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

const full: StageContext = {
  hasBunuan: true,
  hasLigwak: true,
  paymentMode: "pay_later",
  ligwakLocked: false,
  blockers: 0,
  allKitsFilled: false,
};
const ctx = (extra: Partial<StageContext> = {}): StageContext => ({ ...full, ...extra });
const options = (from: GbStage, c: StageContext) =>
  allowedNextStages(from, c).map((o) => `${o.stage}:${o.allowed ? "ok" : "blocked"}`);

console.log("\nthe stage list\n");

check("four stages, in lifecycle order", () => {
  assert.deepEqual([...GB_STAGES], ["open", "bunuan", "closed", "payment"]);
});
check("unknown / missing stage reads as open (every existing round)", () => {
  assert.equal(normalizeGbStage(undefined), "open");
  assert.equal(normalizeGbStage("ligwak"), "open");
  assert.equal(normalizeGbStage(" Closed "), "closed");
});
check("labels the admin sees", () => {
  assert.deepEqual(GB_STAGES.map(stageLabel), ["Open", "Bunuan time", "Closed", "Payment time"]);
});

console.log("\nallowedNextStages — hand-written matrix\n");

check("Open, store with Bunuan → Bunuan or Closed", () => {
  assert.deepEqual(options("open", ctx()), ["bunuan:ok", "closed:ok"]);
});
check("Open, store without Bunuan → Closed only", () => {
  assert.deepEqual(options("open", ctx({ hasBunuan: false })), ["closed:ok"]);
});
check("Bunuan → Closed", () => {
  assert.deepEqual(options("bunuan", ctx()), ["closed:ok"]);
});
check("Closed, pay_later → Payment time (blocked until Ligwak is locked)", () => {
  assert.deepEqual(options("closed", ctx()), ["payment:blocked"]);
  assert.deepEqual(options("closed", ctx({ ligwakLocked: true })), ["payment:ok"]);
});
check("Closed, pay_later, store without Ligwak → Payment time straight away", () => {
  assert.deepEqual(options("closed", ctx({ hasLigwak: false })), ["payment:ok"]);
});
check("Closed, pay_first → nowhere (Closed is the end)", () => {
  assert.deepEqual(options("closed", ctx({ paymentMode: "pay_first", ligwakLocked: true })), []);
});
check("Payment time → nowhere", () => {
  assert.deepEqual(options("payment", ctx({ ligwakLocked: true })), []);
});
check("never backwards", () => {
  for (const from of GB_STAGES) {
    const back = allowedNextStages(from, ctx({ ligwakLocked: true })).filter(
      (o) => GB_STAGES.indexOf(o.stage) <= GB_STAGES.indexOf(from),
    );
    assert.deepEqual(back, [], from);
  }
});

console.log("\nStart Bunuan\n");

check("pay_first with orders awaiting a payment check → blocked, says how many", () => {
  const opt = allowedNextStages("open", ctx({ paymentMode: "pay_first", blockers: 3 })).find((o) => o.stage === "bunuan")!;
  assert.equal(opt.allowed, false);
  assert.ok(opt.reason?.includes("3"), opt.reason);
});
check("pay_later ignores blockers (every placed order already counts)", () => {
  const opt = allowedNextStages("open", ctx({ blockers: 3 })).find((o) => o.stage === "bunuan")!;
  assert.equal(opt.allowed, true);
});
check("every kit already full → allowed, but skips straight to Closed", () => {
  const opt = allowedNextStages("open", ctx({ allKitsFilled: true })).find((o) => o.stage === "bunuan")!;
  assert.deepEqual([opt.allowed, opt.skipsTo], [true, "closed"]);
  assert.deepEqual(resolveStageMove("open", "bunuan", ctx({ allKitsFilled: true })), {
    ok: true,
    stage: "closed",
    skipped: true,
  });
});

console.log("\nresolveStageMove\n");

check("a normal move lands where asked", () => {
  assert.deepEqual(resolveStageMove("open", "bunuan", ctx()), { ok: true, stage: "bunuan", skipped: false });
  assert.deepEqual(resolveStageMove("bunuan", "closed", ctx()), { ok: true, stage: "closed", skipped: false });
});
check("a blocked move returns the reason", () => {
  const r = resolveStageMove("closed", "payment", ctx());
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason.toLowerCase().includes("ligwak"), JSON.stringify(r));
});
check("a move that isn't offered is refused", () => {
  assert.equal(resolveStageMove("open", "payment", ctx()).ok, false);
  assert.equal(resolveStageMove("open", "bunuan", ctx({ hasBunuan: false })).ok, false);
  assert.equal(resolveStageMove("closed", "open", ctx()).ok, false);
  assert.equal(resolveStageMove("open", "open", ctx()).ok, false);
});

console.log("\nautoAdvance\n");

check("Bunuan closes itself the moment every kit fills", () => {
  assert.equal(autoAdvance("bunuan", { allKitsFilled: true }), "closed");
  assert.equal(autoAdvance("bunuan", { allKitsFilled: false }), "bunuan");
});
check("no other stage moves by itself", () => {
  for (const s of ["open", "closed", "payment"] as const) assert.equal(autoAdvance(s, { allKitsFilled: true }), s);
});

console.log("\nordering and editing\n");

check("customers can order during Open and Bunuan only", () => {
  assert.deepEqual(GB_STAGES.map(canOrder), [true, true, false, false]);
});
check("admin order edits lock at Payment time, and once Ligwak is locked", () => {
  assert.deepEqual(GB_STAGES.map((s) => editsLocked(s)), [false, false, false, true]);
  assert.equal(editsLocked("closed", true), true);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
