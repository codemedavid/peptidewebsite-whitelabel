/**
 * Self-contained test for the pure subscription-urgency core (no DB, no Next
 * runtime). Classifies a tenant's operator-set subscription window into the
 * signal the Super Admin "Expiring soon" panel + tenants-list badges render
 * from: ok | due_soon | overdue.
 *
 * Built on computeSubscriptionState (test:subscription-state) — a tenant is
 * near-due when it's on a subscription, not yet expired, and within
 * NEAR_DUE_DAYS of the end; overdue once the window has lapsed.
 *
 *   - src/lib/subscription/near-due.ts
 *       subscriptionUrgency(input, now, nearDueDays?) — { level, daysLeft, endsAt }
 *       NEAR_DUE_DAYS = 7
 *
 *   npm run test:near-due
 */

import assert from "node:assert";

import {
  subscriptionUrgency,
  NEAR_DUE_DAYS,
  type SubscriptionUrgency,
} from "../src/lib/subscription/near-due";

// ──────────────────────────── tiny assertion harness ────────────────────────
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

const DAY = 86_400_000;
const NOW = new Date("2026-07-21T08:00:00.000Z");

function flagged(u: SubscriptionUrgency) {
  assert.notStrictEqual(u.level, "ok", "expected a flagged (non-ok) urgency");
  if (u.level === "ok") throw new Error("unreachable");
  return u;
}

console.log("\nSubscription urgency — pure core\n");

check("NEAR_DUE_DAYS defaults to a 7-day window", () => {
  assert.strictEqual(NEAR_DUE_DAYS, 7);
});

// ───────────────────────────────── ok ───────────────────────────────────────
check("tenant with no subscription window is ok (not flagged)", () => {
  const u = subscriptionUrgency(
    { status: "active", subscriptionStartsAt: null, subscriptionEndsAt: null },
    NOW,
  );
  assert.deepStrictEqual(u, { level: "ok" });
});

check("trial tenant is ok even with a window (trial banner owns it)", () => {
  const u = subscriptionUrgency(
    {
      status: "trial",
      subscriptionStartsAt: new Date(NOW.getTime() - 25 * DAY),
      subscriptionEndsAt: new Date(NOW.getTime() + 2 * DAY),
    },
    NOW,
  );
  assert.strictEqual(u.level, "ok");
});

check("plenty of runway (20 days left) is ok", () => {
  const u = subscriptionUrgency(
    {
      status: "active",
      subscriptionStartsAt: new Date(NOW.getTime() - 10 * DAY),
      subscriptionEndsAt: new Date(NOW.getTime() + 20 * DAY),
    },
    NOW,
  );
  assert.strictEqual(u.level, "ok");
});

check("8 days left is just outside the window → ok", () => {
  const u = subscriptionUrgency(
    {
      status: "active",
      subscriptionStartsAt: new Date(NOW.getTime() - 22 * DAY),
      subscriptionEndsAt: new Date(NOW.getTime() + 8 * DAY),
    },
    NOW,
  );
  assert.strictEqual(u.level, "ok");
});

// ─────────────────────────────── due_soon ───────────────────────────────────
check("exactly 7 days left is within the window (boundary inclusive) → due_soon", () => {
  const u = flagged(
    subscriptionUrgency(
      {
        status: "active",
        subscriptionStartsAt: new Date(NOW.getTime() - 23 * DAY),
        subscriptionEndsAt: new Date(NOW.getTime() + 7 * DAY),
      },
      NOW,
    ),
  );
  assert.strictEqual(u.level, "due_soon");
  assert.strictEqual(u.daysLeft, 7);
  assert.strictEqual(u.endsAt, new Date(NOW.getTime() + 7 * DAY).toISOString());
});

check("2 days left → due_soon with the right days + ISO endsAt", () => {
  const endsAt = new Date(NOW.getTime() + 2 * DAY);
  const u = flagged(
    subscriptionUrgency(
      { status: "active", subscriptionStartsAt: new Date(NOW.getTime() - 28 * DAY), subscriptionEndsAt: endsAt },
      NOW,
    ),
  );
  assert.strictEqual(u.level, "due_soon");
  assert.strictEqual(u.daysLeft, 2);
  assert.strictEqual(u.endsAt, endsAt.toISOString());
});

check("suspended (still-paid) tenant within the window is flagged", () => {
  const u = flagged(
    subscriptionUrgency(
      {
        status: "suspended",
        subscriptionStartsAt: new Date(NOW.getTime() - 27 * DAY),
        subscriptionEndsAt: new Date(NOW.getTime() + 3 * DAY),
      },
      NOW,
    ),
  );
  assert.strictEqual(u.level, "due_soon");
});

// ─────────────────────────────── overdue ────────────────────────────────────
check("already lapsed → overdue, 0 days left", () => {
  const endsAt = new Date(NOW.getTime() - 2 * DAY);
  const u = flagged(
    subscriptionUrgency(
      { status: "active", subscriptionStartsAt: new Date(NOW.getTime() - 32 * DAY), subscriptionEndsAt: endsAt },
      NOW,
    ),
  );
  assert.strictEqual(u.level, "overdue");
  assert.strictEqual(u.daysLeft, 0);
  assert.strictEqual(u.endsAt, endsAt.toISOString());
});

// ─────────────────────────── configurable threshold ─────────────────────────
check("a wider 14-day threshold flags a tenant 10 days out", () => {
  const input = {
    status: "active",
    subscriptionStartsAt: new Date(NOW.getTime() - 20 * DAY),
    subscriptionEndsAt: new Date(NOW.getTime() + 10 * DAY),
  } as const;
  assert.strictEqual(subscriptionUrgency(input, NOW).level, "ok"); // default 7
  assert.strictEqual(subscriptionUrgency(input, NOW, 14).level, "due_soon");
});

// ──────────────────────────────────── summary ───────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
