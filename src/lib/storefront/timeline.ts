// Pure core for the storefront Timeline — an owner-written list of steps (a
// group-buy schedule, "how ordering works", delivery stages…) with the current
// step highlighted. Shown on the Track Order page, in the hero, or both.
//
// Two gates stack:
//   - FEATURES.STORE_TIMELINE : the operator grant (Super Admin → Features),
//                               default OFF. Off hides the store-admin editor and
//                               forces the public timeline off (storefront-brand.ts).
//   - enabled                 : the owner's on/off in the Timeline editor.
// The timeline is visible only when both are on AND it has at least one step
// (isTimelineVisible), and only in the place(s) the owner picked.
//
// Shared by the save action (server) and the storefront + editor preview
// (client), so it stays free of any DB / Next / browser dependency — exercised
// directly by test:timeline. All copy renders as React text nodes, so
// sanitizing here means trimming and length/count clamping.

export type TimelinePlacement = "track" | "hero" | "both";
export type TimelineSurface = "track" | "hero";
export type TimelineStepState = "done" | "current" | "upcoming";

export type TimelineStep = {
  title: string;
  /** Free text ("Oct 25", "~Nov 12", "Week 2") — never parsed as a date. */
  date: string;
  note: string;
};

export type TimelineConfig = {
  enabled: boolean;
  /** Heading above the steps, e.g. "Group buy schedule". Blank hides it. */
  title: string;
  placement: TimelinePlacement;
  steps: TimelineStep[];
  /** Index of the highlighted step; -1 = not started (every step upcoming). */
  currentStep: number;
};

export const TIMELINE_LIMITS = Object.freeze({
  title: 80,
  stepTitle: 60,
  date: 40,
  note: 160,
  steps: 8,
});

export const TIMELINE_PLACEMENTS: readonly { value: TimelinePlacement; label: string }[] = [
  { value: "track", label: "Track Order page" },
  { value: "hero", label: "Hero section" },
  { value: "both", label: "Both" },
];

/** Every store starts here: off, no steps, so nothing shows until the owner writes one. */
export const DEFAULT_TIMELINE: TimelineConfig = {
  enabled: false,
  title: "",
  placement: "track",
  steps: [],
  currentStep: -1,
};

/** One-click starter content in the editor — a group-buy round schedule. */
export const TIMELINE_EXAMPLE: TimelineConfig = {
  enabled: true,
  title: "Group buy schedule",
  placement: "both",
  currentStep: 0,
  steps: [
    { title: "Orders open", date: "Oct 25", note: "Place your order and send proof of payment." },
    { title: "Orders close", date: "Nov 1", note: "Last day to join this round." },
    { title: "Ordered from supplier", date: "Nov 2", note: "" },
    { title: "Arrives in PH", date: "~Nov 12", note: "" },
    { title: "Shipping out", date: "~Nov 14", note: "Tracking numbers go out the same day." },
  ],
};

function asObject(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function str(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

function normalizeSteps(raw: unknown): TimelineStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const o = asObject(entry);
      return {
        title: str(o.title, TIMELINE_LIMITS.stepTitle),
        date: str(o.date, TIMELINE_LIMITS.date),
        note: str(o.note, TIMELINE_LIMITS.note),
      };
    })
    .filter((s) => s.title.length > 0)
    .slice(0, TIMELINE_LIMITS.steps);
}

/** Integer index into the steps, clamped; anything else = not started. */
function clampCurrent(raw: unknown, stepCount: number): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || stepCount === 0) return -1;
  return Math.min(raw, stepCount - 1);
}

/**
 * Coerce untrusted timeline config into a closed, safe shape before it is
 * written to branding.config (and again at render). Never throws.
 */
export function normalizeTimeline(input: unknown): TimelineConfig {
  if (!input || typeof input !== "object") return DEFAULT_TIMELINE;
  const o = asObject(input);
  const steps = normalizeSteps(o.steps);
  const placement = TIMELINE_PLACEMENTS.some((p) => p.value === o.placement)
    ? (o.placement as TimelinePlacement)
    : DEFAULT_TIMELINE.placement;

  return {
    enabled: o.enabled === true,
    title: str(o.title, TIMELINE_LIMITS.title),
    placement,
    steps,
    currentStep: clampCurrent(o.currentStep, steps.length),
  };
}

/** Shown on `surface` only when on, non-empty, and placed there (or "both"). */
export function isTimelineVisible(
  cfg: TimelineConfig | null | undefined,
  surface: TimelineSurface,
): boolean {
  if (!cfg || cfg.enabled !== true || cfg.steps.length === 0) return false;
  return cfg.placement === "both" || cfg.placement === surface;
}

/** Each step's state relative to the highlighted one. */
export function timelineStepStates(cfg: TimelineConfig): TimelineStepState[] {
  return cfg.steps.map((_, i) => {
    if (cfg.currentStep < 0 || i > cfg.currentStep) return "upcoming";
    return i === cfg.currentStep ? "current" : "done";
  });
}
