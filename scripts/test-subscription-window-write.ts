/**
 * RED→GREEN reproducer for the "saving a billing" crash: the operator's
 * Subscription window save threw an uncaught error (surfacing as the generic
 * "An error occurred in the Server Components render" digest) whenever the
 * not-yet-migrated `subscriptionPriceCents` column ([[live-db-state]],
 * [[subscription-price-override]]) didn't exist on the live DB.
 *
 * The read path (src/lib/subscription/subscription-info.ts) already tolerates
 * that column via a fail-open retry; this guards the matching WRITE resilience:
 *
 *   src/lib/subscription/persist-window.ts
 *     writeSubscriptionWindow(update, data)
 *       - "full"          the whole window (incl. price) persisted
 *       - "without-price" retried without the pending-migration column so the
 *                         core window (cycle/start/end/amount) still saves
 *       - rethrows        a genuine DB error the retry can't paper over
 *
 * A Prisma write includes a field in its SQL whenever the key is present in
 * `data` — even when its value is null — so the retry must OMIT the key, not
 * set it to null. The fake `update` below mimics that: it rejects if
 * `subscriptionPriceCents` is an own key of the payload.
 *
 *   npm run test:subscription-window
 */

import assert from "node:assert";

import { writeSubscriptionWindow, type WindowWrite } from "../src/lib/subscription/persist-window";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
    });
}

const FULL: WindowWrite = {
  subscriptionCycle: "monthly",
  subscriptionStartsAt: new Date("2026-07-01T00:00:00.000Z"),
  subscriptionEndsAt: new Date("2026-08-01T00:00:00.000Z"),
  subscriptionAmountCents: 149900,
  subscriptionPriceCents: 99900,
};

const CLEAR: WindowWrite = {
  subscriptionCycle: null,
  subscriptionStartsAt: null,
  subscriptionEndsAt: null,
  subscriptionAmountCents: null,
  subscriptionPriceCents: null,
};

/** A prisma-like writer that rejects when the migrated column is referenced. */
function updaterMissingPriceColumn(seen: Array<Record<string, unknown>>) {
  return async (data: Record<string, unknown>) => {
    seen.push(data);
    if (Object.prototype.hasOwnProperty.call(data, "subscriptionPriceCents")) {
      throw new Error(
        "The column `Tenant.subscriptionPriceCents` does not exist in the current database.",
      );
    }
    return { id: "t1" };
  };
}

async function run() {
  console.log("\nsubscription window write resilience\n");

  await check("persists the full window (price included) when the column exists", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const outcome = await writeSubscriptionWindow(async (data) => {
      seen.push(data);
      return { id: "t1" };
    }, FULL);
    assert.strictEqual(outcome, "full");
    assert.strictEqual(seen.length, 1, "should write exactly once");
    assert.strictEqual(seen[0].subscriptionPriceCents, 99900, "price must be persisted");
  });

  await check("retries WITHOUT the price column when it is not migrated yet", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const outcome = await writeSubscriptionWindow(updaterMissingPriceColumn(seen), FULL);
    assert.strictEqual(outcome, "without-price");
    assert.strictEqual(seen.length, 2, "should attempt full, then retry once");
    // The retry must OMIT the key entirely (not send null) or Prisma still
    // references the missing column.
    assert.ok(
      !Object.prototype.hasOwnProperty.call(seen[1], "subscriptionPriceCents"),
      "retry payload must not contain subscriptionPriceCents at all",
    );
    // Core window columns still persist.
    assert.strictEqual(seen[1].subscriptionCycle, "monthly");
    assert.strictEqual(seen[1].subscriptionAmountCents, 149900);
  });

  await check("clearing the window also tolerates the missing column", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const outcome = await writeSubscriptionWindow(updaterMissingPriceColumn(seen), CLEAR);
    assert.strictEqual(outcome, "without-price");
    assert.ok(
      !Object.prototype.hasOwnProperty.call(seen[1], "subscriptionPriceCents"),
      "clear retry must omit the price key",
    );
    assert.strictEqual(seen[1].subscriptionCycle, null, "clear still nulls the core columns");
  });

  await check("a transient first failure must NOT silently drop the price (no blind retry)", async () => {
    // First write fails for a NON-column reason (connection blip, serialization
    // conflict) and a second attempt would succeed. A blind retry would then
    // persist the window WITHOUT the price and report success — silently losing
    // the operator's Monthly price due. The error must propagate instead; only
    // the missing-price-column failure earns the drop-and-retry.
    let calls = 0;
    let threw = false;
    try {
      await writeSubscriptionWindow(async () => {
        calls += 1;
        if (calls === 1) throw new Error("connection refused");
        return { id: "t1" };
      }, FULL);
    } catch (e) {
      threw = true;
      assert.match(e instanceof Error ? e.message : "", /connection refused/);
    }
    assert.ok(threw, "transient failure must propagate — a lossy retry hides the dropped price");
  });

  await check("still retries when the failure is the missing price column (Prisma P2022 code)", async () => {
    // Same as the message-matched case above, but signalled via the Prisma
    // error code alone — how PrismaClientKnownRequestError actually arrives.
    const seen: Array<Record<string, unknown>> = [];
    const outcome = await writeSubscriptionWindow(async (data) => {
      seen.push(data);
      if (Object.prototype.hasOwnProperty.call(data, "subscriptionPriceCents")) {
        const err = new Error("The column does not exist in the current database.") as Error & {
          code?: string;
        };
        err.code = "P2022";
        throw err;
      }
      return { id: "t1" };
    }, FULL);
    assert.strictEqual(outcome, "without-price");
    assert.strictEqual(seen.length, 2, "should attempt full, then retry once");
  });

  await check("rethrows a genuine DB error the retry can't recover from", async () => {
    let threw = false;
    try {
      await writeSubscriptionWindow(async () => {
        throw new Error("connection refused");
      }, FULL);
    } catch (e) {
      threw = true;
      assert.match(e instanceof Error ? e.message : "", /connection refused/);
    }
    assert.ok(threw, "a persistent write failure must propagate, not be swallowed");
  });

  // ──────────────────────────── summary ─────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void run();
