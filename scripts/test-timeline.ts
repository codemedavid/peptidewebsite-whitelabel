/**
 * Self-contained test for the pure core behind the storefront Timeline — the
 * owner-written step list (e.g. a group-buy schedule) shown on the Track Order
 * page, in the hero, or both. Operator-granted (FEATURES.STORE_TIMELINE), then
 * the owner switches it on, writes the steps and picks where it shows.
 *
 *   src/lib/storefront/timeline.ts
 *     normalizeTimeline(input)       — untrusted branding.config → closed shape.
 *     isTimelineVisible(cfg, where)  — enabled && has steps && placed there.
 *     timelineStepStates(cfg)        — done / current / upcoming per step.
 *
 *   npm run test:timeline
 */

import assert from "node:assert";

import {
  DEFAULT_TIMELINE,
  TIMELINE_EXAMPLE,
  TIMELINE_LIMITS,
  normalizeTimeline,
  isTimelineVisible,
  timelineStepStates,
  type TimelineConfig,
} from "../src/lib/storefront/timeline";

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

const withSteps = (over: Partial<TimelineConfig> = {}): TimelineConfig =>
  normalizeTimeline({
    enabled: true,
    title: "Group buy schedule",
    placement: "track",
    currentStep: 1,
    steps: [
      { title: "Orders open", date: "Oct 25", note: "" },
      { title: "Orders close", date: "Nov 1", note: "" },
      { title: "Ships out", date: "~Nov 14", note: "" },
    ],
    ...over,
  });

console.log("\nStorefront Timeline — pure core\n");

// ── normalizeTimeline ───────────────────────────────────────────────────────
console.log("normalizeTimeline");

check("non-object → the off-by-default baseline", () => {
  assert.deepEqual(normalizeTimeline(null), DEFAULT_TIMELINE);
  assert.deepEqual(normalizeTimeline("x"), DEFAULT_TIMELINE);
  assert.equal(DEFAULT_TIMELINE.enabled, false);
  assert.equal(DEFAULT_TIMELINE.steps.length, 0);
});

check("enabled is strict boolean (truthy strings stay off)", () => {
  assert.equal(normalizeTimeline({ enabled: "true" }).enabled, false);
  assert.equal(normalizeTimeline({ enabled: 1 }).enabled, false);
  assert.equal(normalizeTimeline({ enabled: true }).enabled, true);
});

check("unknown placement falls back to the Track page", () => {
  assert.equal(normalizeTimeline({ placement: "footer" }).placement, "track");
  assert.equal(normalizeTimeline({ placement: "hero" }).placement, "hero");
  assert.equal(normalizeTimeline({ placement: "both" }).placement, "both");
});

check("text is trimmed and length-capped", () => {
  const cfg = normalizeTimeline({
    title: "  Schedule  ",
    steps: [{ title: "x".repeat(500), date: "d".repeat(500), note: "n".repeat(500) }],
  });
  assert.equal(cfg.title, "Schedule");
  assert.equal(cfg.steps[0].title.length, TIMELINE_LIMITS.stepTitle);
  assert.equal(cfg.steps[0].date.length, TIMELINE_LIMITS.date);
  assert.equal(cfg.steps[0].note.length, TIMELINE_LIMITS.note);
});

check("steps without a title are dropped; the list is count-capped", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ title: `Step ${i}`, date: "", note: "" }));
  assert.equal(normalizeTimeline({ steps: many }).steps.length, TIMELINE_LIMITS.steps);
  const cfg = normalizeTimeline({ steps: [{ title: "  ", date: "Oct 1" }, { title: "Real" }, "junk"] });
  assert.deepEqual(cfg.steps, [{ title: "Real", date: "", note: "" }]);
});

check("currentStep is clamped to the step list", () => {
  assert.equal(withSteps({ currentStep: 9 }).currentStep, 2);
  assert.equal(withSteps({ currentStep: -5 }).currentStep, -1);
  assert.equal(withSteps({ currentStep: 1.5 as number }).currentStep, -1);
  assert.equal(withSteps({ currentStep: "1" as unknown as number }).currentStep, -1);
  assert.equal(normalizeTimeline({ currentStep: 0, steps: [] }).currentStep, -1);
});

check("normalizing twice is a no-op (save → render round-trip)", () => {
  const once = withSteps();
  assert.deepEqual(normalizeTimeline(once), once);
  assert.deepEqual(normalizeTimeline(TIMELINE_EXAMPLE), TIMELINE_EXAMPLE);
});

// ── isTimelineVisible ───────────────────────────────────────────────────────
console.log("isTimelineVisible (enabled && steps && placed there)");

check("absent / disabled / empty → hidden everywhere", () => {
  assert.equal(isTimelineVisible(undefined, "track"), false);
  assert.equal(isTimelineVisible(withSteps({ enabled: false }), "track"), false);
  assert.equal(isTimelineVisible(withSteps({ steps: [] }), "track"), false);
});

check("placement decides where it shows", () => {
  assert.equal(isTimelineVisible(withSteps({ placement: "track" }), "track"), true);
  assert.equal(isTimelineVisible(withSteps({ placement: "track" }), "hero"), false);
  assert.equal(isTimelineVisible(withSteps({ placement: "hero" }), "hero"), true);
  assert.equal(isTimelineVisible(withSteps({ placement: "hero" }), "track"), false);
  assert.equal(isTimelineVisible(withSteps({ placement: "both" }), "track"), true);
  assert.equal(isTimelineVisible(withSteps({ placement: "both" }), "hero"), true);
});

// ── timelineStepStates ──────────────────────────────────────────────────────
console.log("timelineStepStates");

check("before current = done, current, after = upcoming", () => {
  assert.deepEqual(timelineStepStates(withSteps({ currentStep: 1 })), ["done", "current", "upcoming"]);
  assert.deepEqual(timelineStepStates(withSteps({ currentStep: 2 })), ["done", "done", "current"]);
});

check("no current step → every step upcoming", () => {
  assert.deepEqual(timelineStepStates(withSteps({ currentStep: -1 })), ["upcoming", "upcoming", "upcoming"]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
