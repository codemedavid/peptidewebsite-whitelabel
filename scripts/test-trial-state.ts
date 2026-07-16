/**
 * Self-contained test for the pure trial-state core (no DB, no Next runtime).
 * Guards the server-side countdown math every trial surface renders from:
 * the admin banner ("X days left", "Day X of 30", progress %), the expiry
 * gates (paused storefront / locked admin), and the upgrade-credit copy.
 *
 *   - src/lib/trial/trial-state.ts
 *       computeTrialState(input, now) — resolves a tenant's trial window
 *       (Tenant.status + OnboardingSubmission.trial/trialStartsAt/trialEndsAt)
 *       into { onTrial, expired, daysLeft, dayNum, totalDays, pctUsed, endsAt }.
 *
 *   npm run test:trial-state
 */

import assert from "node:assert";

import {
  computeTrialState,
  DEFAULT_TRIAL_DAYS,
  type TrialState,
} from "../src/lib/trial/trial-state";

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
const NOW = new Date("2026-07-16T08:00:00.000Z");

function active(state: TrialState) {
  assert.ok(state.onTrial, "expected onTrial: true");
  return state;
}

console.log("\nTrial state — pure core\n");

// ─────────────────────────── not governed by a trial ─────────────────────────
check("active (paid) tenant is not on trial", () => {
  const s = computeTrialState(
    {
      status: "active",
      trial: true,
      trialStartsAt: new Date(NOW.getTime() - 7 * DAY),
      trialEndsAt: new Date(NOW.getTime() + 23 * DAY),
    },
    NOW,
  );
  assert.deepStrictEqual(s, { onTrial: false, expired: false });
});

check("status 'trial' without a trial window (operator-created default) is not on trial", () => {
  // createTenant stamps every new tenant status:"trial" with no submission —
  // those must never see banners or expiry gates.
  const s = computeTrialState(
    { status: "trial", trial: false, trialStartsAt: null, trialEndsAt: null },
    NOW,
  );
  assert.deepStrictEqual(s, { onTrial: false, expired: false });
});

check("trial flag without an end date is not on trial", () => {
  const s = computeTrialState(
    { status: "trial", trial: true, trialStartsAt: new Date(NOW.getTime()), trialEndsAt: null },
    NOW,
  );
  assert.deepStrictEqual(s, { onTrial: false, expired: false });
});

// ────────────────────────────── mid-trial math ──────────────────────────────
check("mid-trial: 23 days left of 30 → day 8, 23% used (mock reference)", () => {
  const s = active(
    computeTrialState(
      {
        status: "trial",
        trial: true,
        trialStartsAt: new Date(NOW.getTime() - 7 * DAY),
        trialEndsAt: new Date(NOW.getTime() + 23 * DAY),
      },
      NOW,
    ),
  );
  assert.strictEqual(s.expired, false);
  assert.strictEqual(s.daysLeft, 23);
  assert.strictEqual(s.dayNum, 8);
  assert.strictEqual(s.totalDays, 30);
  assert.strictEqual(s.pctUsed, 23);
  assert.strictEqual(s.endsAt.getTime(), NOW.getTime() + 23 * DAY);
});

check("day one: full window ahead → day 1, 0% used", () => {
  const s = active(
    computeTrialState(
      {
        status: "trial",
        trial: true,
        trialStartsAt: NOW,
        trialEndsAt: new Date(NOW.getTime() + 30 * DAY),
      },
      NOW,
    ),
  );
  assert.strictEqual(s.daysLeft, 30);
  assert.strictEqual(s.dayNum, 1);
  assert.strictEqual(s.pctUsed, 0);
});

check("final hours: ends in 12h → 1 day left, day 30", () => {
  const s = active(
    computeTrialState(
      {
        status: "trial",
        trial: true,
        trialStartsAt: new Date(NOW.getTime() - 29.5 * DAY),
        trialEndsAt: new Date(NOW.getTime() + 0.5 * DAY),
      },
      NOW,
    ),
  );
  assert.strictEqual(s.expired, false);
  assert.strictEqual(s.daysLeft, 1);
  assert.strictEqual(s.dayNum, 30);
});

check("missing start date falls back to a 30-day window", () => {
  const s = active(
    computeTrialState(
      {
        status: "trial",
        trial: true,
        trialStartsAt: null,
        trialEndsAt: new Date(NOW.getTime() + 10 * DAY),
      },
      NOW,
    ),
  );
  assert.strictEqual(s.totalDays, DEFAULT_TRIAL_DAYS);
  assert.strictEqual(s.daysLeft, 10);
});

check("operator-set custom window: 14 days, half used → day 8 of 14, 50%", () => {
  const s = active(
    computeTrialState(
      {
        status: "trial",
        trial: true,
        trialStartsAt: new Date(NOW.getTime() - 7 * DAY),
        trialEndsAt: new Date(NOW.getTime() + 7 * DAY),
      },
      NOW,
    ),
  );
  assert.strictEqual(s.totalDays, 14);
  assert.strictEqual(s.daysLeft, 7);
  assert.strictEqual(s.dayNum, 8);
  assert.strictEqual(s.pctUsed, 50);
});

check("accepts ISO-string dates (brand JSON round-trip)", () => {
  const s = active(
    computeTrialState(
      {
        status: "trial",
        trial: true,
        trialStartsAt: new Date(NOW.getTime() - 7 * DAY).toISOString(),
        trialEndsAt: new Date(NOW.getTime() + 23 * DAY).toISOString(),
      },
      NOW,
    ),
  );
  assert.strictEqual(s.daysLeft, 23);
});

// ─────────────────────────────────── expiry ─────────────────────────────────
check("expired an hour ago → expired, 0 days left, 100% used, day clamped to total", () => {
  const s = active(
    computeTrialState(
      {
        status: "trial",
        trial: true,
        trialStartsAt: new Date(NOW.getTime() - 30 * DAY - 3_600_000),
        trialEndsAt: new Date(NOW.getTime() - 3_600_000),
      },
      NOW,
    ),
  );
  assert.strictEqual(s.expired, true);
  assert.strictEqual(s.daysLeft, 0);
  assert.strictEqual(s.dayNum, 30);
  assert.strictEqual(s.pctUsed, 100);
});

check("exactly at the end instant counts as expired", () => {
  const end = new Date(NOW.getTime());
  const s = active(
    computeTrialState(
      {
        status: "trial",
        trial: true,
        trialStartsAt: new Date(NOW.getTime() - 30 * DAY),
        trialEndsAt: end,
      },
      NOW,
    ),
  );
  assert.strictEqual(s.expired, true);
  assert.strictEqual(s.daysLeft, 0);
});

check("long-expired trial never goes negative or over 100%", () => {
  const s = active(
    computeTrialState(
      {
        status: "trial",
        trial: true,
        trialStartsAt: new Date(NOW.getTime() - 400 * DAY),
        trialEndsAt: new Date(NOW.getTime() - 370 * DAY),
      },
      NOW,
    ),
  );
  assert.strictEqual(s.daysLeft, 0);
  assert.strictEqual(s.pctUsed, 100);
  assert.ok(s.dayNum >= 1 && s.dayNum <= s.totalDays, "dayNum stays in range");
});

check("degenerate window (end before start) clamps to a sane 1+ day total", () => {
  const s = active(
    computeTrialState(
      {
        status: "trial",
        trial: true,
        trialStartsAt: new Date(NOW.getTime() + 5 * DAY),
        trialEndsAt: new Date(NOW.getTime() + 2 * DAY),
      },
      NOW,
    ),
  );
  assert.ok(s.totalDays >= 1, "totalDays >= 1");
  assert.ok(s.dayNum >= 1 && s.dayNum <= s.totalDays, "dayNum stays in range");
  assert.ok(s.pctUsed >= 0 && s.pctUsed <= 100, "pctUsed stays in range");
});

// ──────────────────────────────────── summary ───────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
