/**
 * Storefront Assessment — a short customer quiz that ends in a product
 * recommendation built from the store's own catalog (The Peppy Lab's "Peptide
 * Compatibility Assessment", carried over from its old site).
 *
 * Steps: consent → about you → medical history → goals → experience &
 * preferences. The owner-editable part lives in `branding.config.assessment`
 * (copy + the goal → product keyword map); submissions land in the
 * `assessment_responses` table for the owner to follow up.
 *
 * Submissions carry health data, so validation is strict and fail-closed: only
 * options this store actually offers survive, consent is mandatory.
 *
 * Matching improves on the original, which compared raw substrings and so
 * missed "GHKCU 100mg" for the keyword "GHK-Cu": product NAMES are compared with
 * punctuation removed, while DESCRIPTIONS need a whole-word hit, so a short
 * keyword like "NAD" can't match inside "Canada".
 *
 * Pure and client-safe. Covered by scripts/test-assessment.ts.
 */

export const NONE_OF_THE_ABOVE = "None of the above";
export const NO_PREFERENCE = "No Preference";
/** Products per recommendation section. */
export const RECOMMENDATION_SLOTS = 3;

export const EXPERIENCE_LEVELS = [
  { id: "beginner", label: "New to Peptides", hint: "I have never used peptides before." },
  { id: "intermediate", label: "Some Experience", hint: "I have used peptides a few times." },
  { id: "advanced", label: "Experienced User", hint: "I use peptides regularly." },
] as const;

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]["id"];

export type AssessmentGoal = { id: string; label: string; keywords: string[] };

export type AssessmentConfig = {
  /** Owner switch. The page also needs the operator's entitlement. */
  enabled: boolean;
  title: string;
  intro: string;
  consentText: string;
  disclaimer: string;
  goals: AssessmentGoal[];
  ageRanges: string[];
  conditions: string[];
  frequencies: string[];
};

export type AssessmentAnswers = {
  fullName: string;
  email: string;
  ageRange: string;
  location: string;
  conditions: string[];
  goals: string[];
  experience: ExperienceLevel;
  frequency: string;
};

const LIMITS = {
  title: 120,
  intro: 600,
  longText: 1000,
  goals: 12,
  keywords: 30,
  keyword: 60,
  options: 12,
  option: 60,
  name: 120,
  email: 160,
  location: 120,
} as const;

const goalId = (label: string): string =>
  label
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "goal";

const goal = (label: string, keywords: string[]): AssessmentGoal => ({ id: goalId(label), label, keywords });

export const DEFAULT_ASSESSMENT: AssessmentConfig = {
  enabled: true,
  title: "Peptide Compatibility Assessment",
  intro:
    "Discover the perfect peptide protocol tailored to your unique goals and physiology. Complete this 2-minute assessment to get a personalized recommendation.",
  consentText:
    "This assessment is for educational and informational purposes only. It does not constitute medical advice. Always consult with a qualified healthcare provider before starting any new health regimen.",
  disclaimer:
    "These recommendations are based on your self-reported goals and are not medical advice. Always consult a qualified healthcare provider before starting anything new.",
  // The original assessment's goal → compound map, verbatim.
  goals: [
    goal("Weight Loss", ["Semaglutide", "Tirzepatide", "Retatrutide", "Cagrilintide", "Mazdutide"]),
    goal("Muscle Gain", ["CJC-1295", "Ipamorelin", "Tesamorelin", "IGF-1", "MK-677"]),
    goal("Anti-Aging/Longevity", ["Epitalon", "GHK-Cu", "NAD+", "Thymalin", "Foxo4"]),
    goal("Energy & Focus", ["NAD+", "Semax", "Selank", "SS-31"]),
    goal("Better Sleep", ["DSIP", "Epitalon", "CJC-1295"]),
    goal("Injury Recovery", ["BPC-157", "TB-500", "GHK-Cu"]),
    goal("Skin Health", ["GHK-Cu", "Melanotan", "Epitalon"]),
  ],
  ageRanges: ["18-25", "26-35", "36-45", "46-55", "55+"],
  conditions: ["Cancer", "Diabetes", "Heart Condition", "Kidney Issues", "Liver Issues", "Pregnant / Nursing"],
  frequencies: ["Daily", "Weekly", "As needed"],
};

// ── Config ───────────────────────────────────────────────────────────────────

const text = (v: unknown, max: number, fallback: string): string => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s || fallback;
};

function stringList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const s = raw.trim().slice(0, maxLen);
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeGoals(v: unknown): AssessmentGoal[] {
  if (!Array.isArray(v)) return DEFAULT_ASSESSMENT.goals;
  const seen = new Set<string>();
  const goals: AssessmentGoal[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim().slice(0, LIMITS.option) : "";
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    goals.push(goal(label, stringList(o.keywords, LIMITS.keywords, LIMITS.keyword)));
    if (goals.length >= LIMITS.goals) break;
  }
  return goals.length ? goals : DEFAULT_ASSESSMENT.goals;
}

function optionList(v: unknown, fallback: string[]): string[] {
  const list = stringList(v, LIMITS.options, LIMITS.option);
  return list.length ? list : fallback;
}

/** Absent or junk config → the defaults; owner edits are cleaned and capped. */
export function normalizeAssessmentConfig(input: unknown): AssessmentConfig {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const d = DEFAULT_ASSESSMENT;
  return {
    enabled: o.enabled !== false,
    title: text(o.title, LIMITS.title, d.title),
    intro: text(o.intro, LIMITS.intro, d.intro),
    consentText: text(o.consentText, LIMITS.longText, d.consentText),
    disclaimer: text(o.disclaimer, LIMITS.longText, d.disclaimer),
    goals: normalizeGoals(o.goals),
    ageRanges: optionList(o.ageRanges, d.ageRanges),
    conditions: optionList(o.conditions, d.conditions),
    frequencies: optionList(o.frequencies, d.frequencies),
  };
}

// ── Submission ───────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Keep only entries matching an allowed option (case-insensitive), in the
 *  store's own spelling, de-duplicated. */
function pick(values: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(values)) return [];
  const byKey = new Map(allowed.map((a) => [a.toLowerCase(), a]));
  const out: string[] = [];
  for (const v of values) {
    const hit = typeof v === "string" ? byKey.get(v.trim().toLowerCase()) : undefined;
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

export function validateAssessmentSubmission(
  input: unknown,
  config: AssessmentConfig,
): { ok: true; value: AssessmentAnswers } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Please complete the assessment." };
  const o = input as Record<string, unknown>;
  if (o.consent !== true) return { ok: false, error: "You must accept the terms to proceed." };

  const fullName = typeof o.fullName === "string" ? o.fullName.trim().slice(0, LIMITS.name) : "";
  const email = typeof o.email === "string" ? o.email.trim().toLowerCase().slice(0, LIMITS.email) : "";
  const ageRange = pick([o.ageRange], config.ageRanges)[0] ?? "";
  if (!fullName || !EMAIL_RE.test(email) || !ageRange) {
    return { ok: false, error: "Please fill in your name, a valid email and your age range." };
  }

  const picked = pick(o.conditions, [...config.conditions, NONE_OF_THE_ABOVE]);
  const real = picked.filter((c) => c !== NONE_OF_THE_ABOVE);
  const conditions = real.length ? real : picked;
  if (!conditions.length) return { ok: false, error: "Please answer the medical history question." };

  const goals = pick(
    o.goals,
    config.goals.map((g) => g.label),
  );
  if (!goals.length) return { ok: false, error: "Please choose at least one goal." };

  const experience = EXPERIENCE_LEVELS.find((l) => l.id === o.experience)?.id;
  if (!experience) return { ok: false, error: "Please choose your experience level." };

  return {
    ok: true,
    value: {
      fullName,
      email,
      ageRange,
      location: typeof o.location === "string" ? o.location.trim().slice(0, LIMITS.location) : "",
      conditions,
      goals,
      experience,
      frequency: pick([o.frequency], config.frequencies)[0] ?? NO_PREFERENCE,
    },
  };
}

// ── Recommendations ──────────────────────────────────────────────────────────

export type RecommendableProduct = {
  id: string;
  name: string;
  description?: string;
  available?: boolean;
};

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Whole-word, punctuation-tolerant matcher for a keyword inside free text. */
function wordMatcher(keyword: string): RegExp | null {
  const core = keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join("[^a-z0-9]*");
  return core ? new RegExp(`(^|[^a-z0-9])${core}($|[^a-z0-9])`) : null;
}

function matchGoal<P extends RecommendableProduct>(
  products: readonly P[],
  g: AssessmentGoal,
  taken: Set<string>,
): P[] {
  const byName: P[] = [];
  const byDescription: P[] = [];
  const claim = (p: P, into: P[]) => {
    if (taken.has(p.id)) return;
    taken.add(p.id);
    into.push(p);
  };
  for (const kw of g.keywords) {
    const k = squash(kw);
    if (k) for (const p of products) if (squash(p.name).includes(k)) claim(p, byName);
  }
  for (const kw of g.keywords) {
    const re = wordMatcher(kw);
    if (re) for (const p of products) if (re.test((p.description ?? "").toLowerCase())) claim(p, byDescription);
  }
  return [...byName, ...byDescription];
}

/**
 * The first chosen goal fills "Core" (the main objective), every other goal
 * fills "Supportive". Sold-out/hidden products never appear, and nothing is
 * listed twice.
 */
export function recommendProducts<P extends RecommendableProduct>(
  products: readonly P[],
  goalLabels: readonly string[],
  config: AssessmentConfig,
): { primary: P[]; secondary: P[] } {
  const live = products.filter((p) => p.available !== false);
  const goals = goalLabels
    .map((label) => config.goals.find((g) => g.label.toLowerCase() === label.toLowerCase() || g.id === label))
    .filter((g): g is AssessmentGoal => !!g);
  if (!goals.length) return { primary: [], secondary: [] };

  const taken = new Set<string>();
  const primary = matchGoal(live, goals[0], taken).slice(0, RECOMMENDATION_SLOTS);
  // Only what was actually SHOWN is reserved; overflow stays eligible below.
  taken.clear();
  primary.forEach((p) => taken.add(p.id));
  const secondary = goals
    .slice(1)
    .flatMap((g) => matchGoal(live, g, taken))
    .slice(0, RECOMMENDATION_SLOTS);
  return { primary, secondary };
}
