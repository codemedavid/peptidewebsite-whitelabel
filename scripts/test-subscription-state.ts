/**
 * Self-contained test for the pure subscription-state core (no DB, no Next
 * runtime). Guards the server-side countdown math the subscription-duration
 * surfaces render from: the store-admin banner ("X days left", "Day X of Y",
 * progress %) and the platform-admin tenant-detail window row.
 *
 * Mirrors the trial-state core (test:trial-state) but for PAID tenants:
 * where the trial window is governed by Tenant.status === "trial" + an opted-in
 * OnboardingSubmission, the subscription window is governed by a paid tenant
 * (status !== "trial") carrying an operator-set Tenant.subscriptionEndsAt.
 *
 *   - src/lib/subscription/subscription-state.ts
 *       computeSubscriptionState(input, now) — resolves a tenant's paid window
 *       (Tenant.status + subscriptionStartsAt/subscriptionEndsAt) into
 *       { onSubscription, expired, daysLeft, dayNum, totalDays, pctUsed, endsAt }.
 *
 *   npm run test:subscription-state
 */

import assert from "node:assert";

import {
  computeSubscriptionState,
  DEFAULT_SUBSCRIPTION_DAYS,
  brandSubscriptionFrom,
  type SubscriptionState,
} from "../src/lib/subscription/subscription-state";

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

function active(state: SubscriptionState) {
  assert.ok(state.onSubscription, "expected onSubscription: true");
  return state;
}

console.log("\nSubscription state — pure core\n");

// ───────────────────────── not governed by a subscription ────────────────────
check("trial tenant is not on a subscription (the trial banner owns that)", () => {
  const s = computeSubscriptionState(
    {
      status: "trial",
      subscriptionStartsAt: new Date(NOW.getTime() - 7 * DAY),
      subscriptionEndsAt: new Date(NOW.getTime() + 23 * DAY),
    },
    NOW,
  );
  assert.deepStrictEqual(s, { onSubscription: false, expired: false });
});

check("paid tenant without a subscription window is not on a subscription", () => {
  const s = computeSubscriptionState(
    { status: "active", subscriptionStartsAt: null, subscriptionEndsAt: null },
    NOW,
  );
  assert.deepStrictEqual(s, { onSubscription: false, expired: false });
});

check("a start date but no end date is not on a subscription", () => {
  const s = computeSubscriptionState(
    { status: "active", subscriptionStartsAt: NOW, subscriptionEndsAt: null },
    NOW,
  );
  assert.deepStrictEqual(s, { onSubscription: false, expired: false });
});

// ─────────────────────────── mid-subscription math ───────────────────────────
check("mid-period: 23 days left of 30 → day 8, 23% used", () => {
  const s = active(
    computeSubscriptionState(
      {
        status: "active",
        subscriptionStartsAt: new Date(NOW.getTime() - 7 * DAY),
        subscriptionEndsAt: new Date(NOW.getTime() + 23 * DAY),
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
    computeSubscriptionState(
      {
        status: "active",
        subscriptionStartsAt: NOW,
        subscriptionEndsAt: new Date(NOW.getTime() + 30 * DAY),
      },
      NOW,
    ),
  );
  assert.strictEqual(s.daysLeft, 30);
  assert.strictEqual(s.dayNum, 1);
  assert.strictEqual(s.pctUsed, 0);
});

check("annual window: 365-day term computes totalDays from start/end", () => {
  const s = active(
    computeSubscriptionState(
      {
        status: "active",
        subscriptionStartsAt: new Date(NOW.getTime() - 100 * DAY),
        subscriptionEndsAt: new Date(NOW.getTime() + 265 * DAY),
      },
      NOW,
    ),
  );
  assert.strictEqual(s.totalDays, 365);
  assert.strictEqual(s.daysLeft, 265);
  assert.strictEqual(s.dayNum, 101);
});

check("suspended (still-paid) tenant with a window IS governed", () => {
  const s = active(
    computeSubscriptionState(
      {
        status: "suspended",
        subscriptionStartsAt: new Date(NOW.getTime() - 5 * DAY),
        subscriptionEndsAt: new Date(NOW.getTime() + 25 * DAY),
      },
      NOW,
    ),
  );
  assert.strictEqual(s.daysLeft, 25);
});

check("missing start date falls back to a default window", () => {
  const s = active(
    computeSubscriptionState(
      {
        status: "active",
        subscriptionStartsAt: null,
        subscriptionEndsAt: new Date(NOW.getTime() + 10 * DAY),
      },
      NOW,
    ),
  );
  assert.strictEqual(s.totalDays, DEFAULT_SUBSCRIPTION_DAYS);
  assert.strictEqual(s.daysLeft, 10);
});

check("accepts ISO-string dates (brand JSON round-trip)", () => {
  const s = active(
    computeSubscriptionState(
      {
        status: "active",
        subscriptionStartsAt: new Date(NOW.getTime() - 7 * DAY).toISOString(),
        subscriptionEndsAt: new Date(NOW.getTime() + 23 * DAY).toISOString(),
      },
      NOW,
    ),
  );
  assert.strictEqual(s.daysLeft, 23);
});

// ─────────────────────────────────── expiry ─────────────────────────────────
check("expired an hour ago → expired, 0 days left, 100% used, day clamped to total", () => {
  const s = active(
    computeSubscriptionState(
      {
        status: "active",
        subscriptionStartsAt: new Date(NOW.getTime() - 30 * DAY - 3_600_000),
        subscriptionEndsAt: new Date(NOW.getTime() - 3_600_000),
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
  const s = active(
    computeSubscriptionState(
      {
        status: "active",
        subscriptionStartsAt: new Date(NOW.getTime() - 30 * DAY),
        subscriptionEndsAt: new Date(NOW.getTime()),
      },
      NOW,
    ),
  );
  assert.strictEqual(s.expired, true);
  assert.strictEqual(s.daysLeft, 0);
});

check("degenerate window (end before start) clamps to a sane 1+ day total", () => {
  const s = active(
    computeSubscriptionState(
      {
        status: "active",
        subscriptionStartsAt: new Date(NOW.getTime() + 5 * DAY),
        subscriptionEndsAt: new Date(NOW.getTime() + 2 * DAY),
      },
      NOW,
    ),
  );
  assert.ok(s.totalDays >= 1, "totalDays >= 1");
  assert.ok(s.dayNum >= 1 && s.dayNum <= s.totalDays, "dayNum stays in range");
  assert.ok(s.pctUsed >= 0 && s.pctUsed <= 100, "pctUsed stays in range");
});

// ──────────────────────────── brand projection ──────────────────────────────
check("brandSubscriptionFrom returns undefined when not governed (legacy byte-identical)", () => {
  const s = computeSubscriptionState(
    { status: "active", subscriptionStartsAt: null, subscriptionEndsAt: null },
    NOW,
  );
  assert.strictEqual(brandSubscriptionFrom(s), undefined);
});

check("brandSubscriptionFrom serializes endsAt to an ISO string", () => {
  const s = computeSubscriptionState(
    {
      status: "active",
      subscriptionStartsAt: new Date(NOW.getTime() - 7 * DAY),
      subscriptionEndsAt: new Date(NOW.getTime() + 23 * DAY),
    },
    NOW,
  );
  const brand = brandSubscriptionFrom(s);
  assert.ok(brand, "expected a projected brand.subscription");
  assert.strictEqual(typeof brand.endsAt, "string");
  assert.strictEqual(brand.daysLeft, 23);
  assert.strictEqual(brand.onSubscription, true);
});

// ───────────────────── billing projection (amount due) ──────────────────────
// The tenant Billing page must show the amount the provider set up in the super
// admin. brandSubscriptionFrom takes the resolved billing terms and carries
// them into brand.subscription; invalid/unset values are omitted so legacy
// brands stay byte-identical.

const GOVERNED = computeSubscriptionState(
  {
    status: "active",
    subscriptionStartsAt: new Date(NOW.getTime() - 7 * DAY),
    subscriptionEndsAt: new Date(NOW.getTime() + 23 * DAY),
  },
  NOW,
);

check("billing terms project amountDueCents + cycle into brand.subscription", () => {
  const brand = brandSubscriptionFrom(GOVERNED, { amountDueCents: 149_900, cycle: "monthly" });
  assert.ok(brand, "expected a projected brand.subscription");
  assert.strictEqual(brand.amountDueCents, 149_900);
  assert.strictEqual(brand.cycle, "monthly");
});

check("a comped ₱0 price is a real amount and projects as 0", () => {
  const brand = brandSubscriptionFrom(GOVERNED, { amountDueCents: 0, cycle: "monthly" });
  assert.ok(brand);
  assert.strictEqual(brand.amountDueCents, 0);
});

check("null/unset billing terms are omitted from the projection", () => {
  const brand = brandSubscriptionFrom(GOVERNED, { amountDueCents: null, cycle: null });
  assert.ok(brand);
  assert.ok(!("amountDueCents" in brand), "amountDueCents omitted when null");
  assert.ok(!("cycle" in brand), "cycle omitted when null");
});

check("negative or non-finite amounts are omitted (never shown to the tenant)", () => {
  const negative = brandSubscriptionFrom(GOVERNED, { amountDueCents: -500, cycle: "monthly" });
  assert.ok(negative);
  assert.ok(!("amountDueCents" in negative), "negative omitted");
  const nan = brandSubscriptionFrom(GOVERNED, { amountDueCents: Number.NaN, cycle: "monthly" });
  assert.ok(nan);
  assert.ok(!("amountDueCents" in nan), "NaN omitted");
});

check("calling without billing terms stays back-compatible (no new fields)", () => {
  const brand = brandSubscriptionFrom(GOVERNED);
  assert.ok(brand);
  assert.ok(!("amountDueCents" in brand), "no amountDueCents without billing arg");
  assert.ok(!("cycle" in brand), "no cycle without billing arg");
});

check("billing terms on a not-governed state still project nothing", () => {
  const s = computeSubscriptionState(
    { status: "active", subscriptionStartsAt: null, subscriptionEndsAt: null },
    NOW,
  );
  assert.strictEqual(brandSubscriptionFrom(s, { amountDueCents: 149_900, cycle: "monthly" }), undefined);
});

// ──────────────────────────────────── summary ───────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
