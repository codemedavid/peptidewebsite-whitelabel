// Pure core for homepage hero copy. Shared by store-admin saves and operator
// provisioning so both paths cap and trim the same fields before writing
// branding.config.

export const HERO_COPY_FIELDS = [
  "heroChipLabel",
  "heroLine1",
  "heroLine2",
  "heroSub",
  "heroCta1",
  "heroCta2",
] as const;

export type HeroCopyField = (typeof HERO_COPY_FIELDS)[number];

/** Coerce untrusted input into clean hero copy strings. */
export function normalizeHeroContent(input: unknown): Record<HeroCopyField, string> {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = {} as Record<HeroCopyField, string>;
  for (const key of HERO_COPY_FIELDS) {
    const cap = key === "heroSub" ? 400 : 120;
    out[key] = String(o[key] ?? "").slice(0, cap).trim();
  }
  return out;
}
