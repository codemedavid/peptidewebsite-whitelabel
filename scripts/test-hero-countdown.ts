// Self-contained test gate for the hero group-buy countdown
// (src/lib/storefront/hero-countdown.ts): the owner's on/off switch + optional
// heading text, stored in branding.config.heroCountdown, resolved against the
// rounds. Pure — no DB, no React.
//
//   npm run test:hero-countdown
//
// Covers: default OFF, normalization of garbage, heading on/off + automatic
// text + {name}, closing vs opening phase, open-ended live round, scheduled
// rounds without groupbuy.scheduled, earliest upcoming wins, clock parts.

import {
  countdownParts,
  HERO_COUNTDOWN_DEFAULTS,
  HERO_COUNTDOWN_LIMITS,
  normalizeHeroCountdown,
  pickCountdownTarget,
  resolveHeroCountdown,
} from "../src/lib/storefront/hero-countdown";
import type { GroupBuy } from "../src/lib/storefront/group-buy";
import {
  HERO_COUNTDOWN_AUTO_HEADING as APP_AUTO_HEADING,
  HERO_COUNTDOWN_LIMITS as APP_LIMITS,
  normalizeHeroCountdown as appNormalize,
} from "../mobile/src/features/admin/group-buys/model";
import { HERO_COUNTDOWN_AUTO_HEADING } from "../src/lib/storefront/hero-countdown";

let failures = 0;
let checks = 0;

function ok(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const NOW = new Date("2026-10-25T12:00:00.000Z");
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

function round(patch: Partial<GroupBuy>): GroupBuy {
  return {
    id: "gb1",
    name: "GB #1",
    description: "",
    status: "active",
    startsAt: null,
    endsAt: null,
    deliveryEta: "",
    productIds: [],
    slotGoal: 0,
    batchNumber: "",
    minVials: null,
    maxVials: null,
    closedAt: null,
    createdAt: iso(-48 * HOUR),
    updatedAt: iso(-48 * HOUR),
    ...patch,
  };
}

const SCHED = { scheduled: true };
const NO_SCHED = { scheduled: false };

console.log("normalize");
eq("missing config = defaults (OFF)", normalizeHeroCountdown(undefined), { ...HERO_COUNTDOWN_DEFAULTS });
eq("array is garbage", normalizeHeroCountdown([1, 2]), { ...HERO_COUNTDOWN_DEFAULTS });
ok("only literal true enables", !normalizeHeroCountdown({ enabled: "yes" }).enabled);
ok("heading shows unless false", normalizeHeroCountdown({ showHeading: 0 }).showHeading);
ok("heading off with false", !normalizeHeroCountdown({ showHeading: false }).showHeading);
eq("trims + collapses whitespace", normalizeHeroCountdown({ closingHeading: "  Hurry\n  up  " }).closingHeading, "Hurry up");
eq(
  "caps heading length",
  normalizeHeroCountdown({ openingHeading: "x".repeat(500) }).openingHeading.length,
  HERO_COUNTDOWN_LIMITS.heading,
);
const input = { enabled: true, closingHeading: " a " };
normalizeHeroCountdown(input);
eq("never mutates input", input, { enabled: true, closingHeading: " a " });

console.log("target");
const live = round({ endsAt: iso(5 * HOUR) });
eq("live round with end → closing", pickCountdownTarget([live], SCHED, NOW), {
  phase: "closing",
  target: live.endsAt,
  roundName: "GB #1",
});
eq("open-ended live round → nothing", pickCountdownTarget([round({})], SCHED, NOW), null);
const soon = round({ id: "gb2", name: "GB #2", status: "scheduled", startsAt: iso(10 * HOUR), endsAt: iso(50 * HOUR) });
const later = round({ id: "gb3", name: "GB #3", status: "scheduled", startsAt: iso(30 * HOUR) });
eq("next scheduled round → opening", pickCountdownTarget([later, soon], SCHED, NOW), {
  phase: "opening",
  target: soon.startsAt,
  roundName: "GB #2",
});
eq("no groupbuy.scheduled → no opening countdown", pickCountdownTarget([soon], NO_SCHED, NOW), null);
eq("live round beats upcoming", pickCountdownTarget([soon, live], SCHED, NOW)?.phase, "closing");
eq("open-ended live blocks opening", pickCountdownTarget([soon, round({})], SCHED, NOW), null);
eq("draft rounds never count", pickCountdownTarget([round({ status: "draft", startsAt: iso(HOUR) })], SCHED, NOW), null);
eq("lapsed live round → nothing", pickCountdownTarget([round({ endsAt: iso(-HOUR) })], SCHED, NOW), null);

console.log("resolve");
eq("disabled → null even with a live round", resolveHeroCountdown({}, [live], SCHED, NOW), null);
eq("enabled, automatic heading", resolveHeroCountdown({ enabled: true }, [live], SCHED, NOW), {
  phase: "closing",
  target: live.endsAt!,
  roundName: "GB #1",
  heading: "GB #1 closes in",
});
eq(
  "owner heading with {name}",
  resolveHeroCountdown({ enabled: true, openingHeading: "{name} drops in" }, [soon], SCHED, NOW)?.heading,
  "GB #2 drops in",
);
eq(
  "phase picks its own heading",
  resolveHeroCountdown({ enabled: true, openingHeading: "Opening soon" }, [live], SCHED, NOW)?.heading,
  "GB #1 closes in",
);
eq("heading off → null heading", resolveHeroCountdown({ enabled: true, showHeading: false }, [live], SCHED, NOW)?.heading, null);
eq("enabled but nothing coming up → null", resolveHeroCountdown({ enabled: true }, [], SCHED, NOW), null);

console.log("clock");
eq(
  "splits days/hours/minutes/seconds",
  countdownParts(iso(((2 * 24 + 3) * 60 + 4) * 60_000 + 5_000), NOW.getTime()),
  { days: 2, hours: 3, minutes: 4, seconds: 5, done: false },
);
eq("past target clamps to zero", countdownParts(iso(-HOUR), NOW.getTime()), {
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
  done: true,
});

console.log("app mirror (mobile/src/features/admin/group-buys/model.ts)");
eq("same limits", APP_LIMITS, { ...HERO_COUNTDOWN_LIMITS });
eq("same automatic headings", APP_AUTO_HEADING, { ...HERO_COUNTDOWN_AUTO_HEADING });
for (const sample of [
  undefined,
  null,
  [1],
  "x",
  { enabled: true },
  { enabled: "yes", showHeading: false },
  { enabled: true, closingHeading: "  Hurry\n up ", openingHeading: "o".repeat(200) },
  { showHeading: 0, closingHeading: 42 },
]) {
  eq(`normalizes the same: ${JSON.stringify(sample)?.slice(0, 40)}`, appNormalize(sample), normalizeHeroCountdown(sample));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
