/**
 * Theme presets — the single source of truth for the white-label theme registry.
 *
 * Every preset is a full shadcn token set (HSL channel triples "H S% L%" so they
 * drop straight into `hsl(var(--token))` in tailwind.config.ts) plus metadata
 * (category, light/dark mode, tagline) and an optional brand gradient. Tenants
 * layer role overrides on top via Branding.colors (see resolve-css-vars.ts).
 *
 * New themes are authored as compact SEEDS (the meaningful colors as hex) and
 * expanded by `buildTheme()` — it derives the readable foregrounds, the
 * secondary/muted surfaces, border/input, and focus ring, so adding a theme is a
 * dozen colors, not thirty. The three original presets keep their hand-tuned
 * triples verbatim for exact backward compatibility.
 */
import { hexToHslTriple, bestForeground } from "./color";

/** Light vs dark base — drives selector grouping and sensible status defaults. */
export type ThemeMode = "light" | "dark";

/** Selector groupings, in display order. "core" holds the original presets. */
export type ThemeCategory =
  | "core"
  | "professional"
  | "minimalist"
  | "dark"
  | "luxury"
  | "saas"
  | "fun";

export type ThemeTokens = {
  background: string;
  foreground: string;
  card: string;
  "card-foreground": string;
  primary: string;
  "primary-foreground": string;
  secondary: string;
  "secondary-foreground": string;
  accent: string;
  "accent-foreground": string;
  muted: string;
  "muted-foreground": string;
  // Status colors. `destructive` is the error role (kept as the shadcn name for
  // backwards compatibility); success / warning / info round out the set.
  destructive: string;
  "destructive-foreground": string;
  success: string;
  "success-foreground": string;
  warning: string;
  "warning-foreground": string;
  info: string;
  "info-foreground": string;
  border: string;
  input: string;
  ring: string;
};

export type ThemePreset = {
  id: string;
  name: string;
  category: ThemeCategory;
  mode: ThemeMode;
  /** One-line description for the theme-selector cards. */
  tagline: string;
  fonts: { heading: string; body: string };
  radius: string;
  colors: ThemeTokens;
  /** Optional 2-stop brand gradient (HSL triples) for hero/CTA flourishes. */
  gradient?: { from: string; to: string };
};

/** Ordered category metadata for the grouped theme selector. */
export const THEME_CATEGORIES: { id: ThemeCategory; label: string; description: string }[] = [
  { id: "core", label: "Signature", description: "The original house themes." },
  { id: "professional", label: "Professional", description: "Trustworthy, conversion-ready business looks." },
  { id: "minimalist", label: "Minimalist", description: "High-contrast, content-first restraint." },
  { id: "dark", label: "Dark", description: "Premium dark-mode surfaces." },
  { id: "luxury", label: "Luxury", description: "Gold-accented, high-end brand feel." },
  { id: "saas", label: "Modern SaaS", description: "Gradient-forward, Linear / Stripe energy." },
  { id: "fun", label: "Fun & Friendly", description: "Soft, playful, approachable palettes." },
];

// ── buildTheme factory ────────────────────────────────────────────────────────
//
// A ThemeSeed is the compact, hand-edited shape: the colors that actually carry
// brand intent, as hex. buildTheme() converts them to HSL triples and derives the
// rest of the shadcn token set so palettes stay DRY and consistent.

export type ThemeSeed = {
  id: string;
  name: string;
  category: ThemeCategory;
  mode: ThemeMode;
  tagline: string;
  headingFont: string;
  bodyFont: string;
  radius: string;
  /** Brand / CTA color + the text that sits on it. */
  primary: string;
  primaryForeground: string;
  /** Links, highlights, focus rings (reads as text on the background). */
  accent: string;
  accentForeground: string;
  /** Page background, card surface, and a faint secondary/muted surface. */
  background: string;
  surface: string;
  subtle: string;
  /** Body text + secondary copy + hairline border. */
  text: string;
  mutedText: string;
  border: string;
  /** Status fills (readable foregrounds are derived). `error` → `destructive`. */
  success: string;
  warning: string;
  info: string;
  error: string;
  /** Optional brand gradient stops. */
  gradientFrom?: string | null;
  gradientTo?: string | null;
};

/** Expand a compact seed into a full ThemePreset (deriving on-color foregrounds). */
export function buildTheme(s: ThemeSeed): ThemePreset {
  const t = (hex: string) => hexToHslTriple(hex);
  const colors: ThemeTokens = {
    background: t(s.background),
    foreground: t(s.text),
    card: t(s.surface),
    "card-foreground": t(s.text),
    primary: t(s.primary),
    "primary-foreground": t(s.primaryForeground),
    secondary: t(s.subtle),
    "secondary-foreground": t(s.text),
    accent: t(s.accent),
    "accent-foreground": t(s.accentForeground),
    muted: t(s.subtle),
    "muted-foreground": t(s.mutedText),
    destructive: t(s.error),
    "destructive-foreground": bestForeground(t(s.error)),
    success: t(s.success),
    "success-foreground": bestForeground(t(s.success)),
    warning: t(s.warning),
    "warning-foreground": bestForeground(t(s.warning)),
    info: t(s.info),
    "info-foreground": bestForeground(t(s.info)),
    border: t(s.border),
    input: t(s.border),
    ring: t(s.accent),
  };
  const preset: ThemePreset = {
    id: s.id,
    name: s.name,
    category: s.category,
    mode: s.mode,
    tagline: s.tagline,
    fonts: { heading: s.headingFont, body: s.bodyFont },
    radius: s.radius,
    colors,
  };
  if (s.gradientFrom && s.gradientTo) {
    preset.gradient = { from: t(s.gradientFrom), to: t(s.gradientTo) };
  }
  return preset;
}

/**
 * Mode-appropriate success / warning / info triples (+ derived foregrounds) for
 * the original presets, which predate status colors. Tuned to read as a
 * consistent family with the seed-built themes' status set.
 */
function statusTriples(mode: ThemeMode) {
  const fill = mode === "dark"
    ? { success: "#22c55e", warning: "#fbbf24", info: "#38bdf8" }
    : { success: "#16a34a", warning: "#d97706", info: "#2563eb" };
  const s = hexToHslTriple(fill.success);
  const w = hexToHslTriple(fill.warning);
  const i = hexToHslTriple(fill.info);
  return {
    success: s,
    "success-foreground": bestForeground(s),
    warning: w,
    "warning-foreground": bestForeground(w),
    info: i,
    "info-foreground": bestForeground(i),
  } satisfies Pick<
    ThemeTokens,
    "success" | "success-foreground" | "warning" | "warning-foreground" | "info" | "info-foreground"
  >;
}

// ── Original presets (hand-tuned; colors kept verbatim for back-compat) ─────────
const CORE_PRESETS: Record<string, ThemePreset> = {
  "clinical-white": {
    id: "clinical-white",
    name: "Clinical White",
    category: "core",
    mode: "light",
    tagline: "Crisp, medical-grade light UI",
    fonts: { heading: "Inter", body: "Inter" },
    radius: "0.5rem",
    colors: {
      background: "0 0% 100%",
      foreground: "222 47% 11%",
      card: "0 0% 100%",
      "card-foreground": "222 47% 11%",
      primary: "201 96% 32%",
      "primary-foreground": "0 0% 100%",
      secondary: "210 40% 96%",
      "secondary-foreground": "222 47% 11%",
      // `accent` is used as link / highlight *text* on the background, so it must
      // hold AA contrast there — not the pale shadcn hover-surface tint.
      accent: "201 90% 38%",
      "accent-foreground": "0 0% 100%",
      muted: "210 40% 96%",
      "muted-foreground": "215 16% 47%",
      destructive: "0 72% 45%",
      "destructive-foreground": "0 0% 100%",
      ...statusTriples("light"),
      border: "214 32% 91%",
      input: "214 32% 91%",
      ring: "201 96% 32%",
    },
  },
  "midnight-lab": {
    id: "midnight-lab",
    name: "Midnight Lab",
    category: "core",
    mode: "dark",
    tagline: "Deep lab dark with a mint signal",
    fonts: { heading: "Space Grotesk", body: "Inter" },
    radius: "0.75rem",
    colors: {
      background: "222 47% 7%",
      foreground: "210 40% 98%",
      card: "222 47% 10%",
      "card-foreground": "210 40% 98%",
      primary: "156 72% 45%",
      "primary-foreground": "222 47% 7%",
      secondary: "217 33% 17%",
      "secondary-foreground": "210 40% 98%",
      // Light enough to read as link text on the near-black background.
      accent: "156 64% 60%",
      "accent-foreground": "222 47% 7%",
      muted: "217 33% 17%",
      "muted-foreground": "215 20% 70%",
      destructive: "0 75% 60%",
      "destructive-foreground": "0 0% 100%",
      ...statusTriples("dark"),
      border: "217 33% 20%",
      input: "217 33% 20%",
      ring: "156 72% 45%",
    },
  },
  "apex-performance": {
    id: "apex-performance",
    name: "Apex Performance",
    category: "core",
    mode: "dark",
    tagline: "High-octane race-day black & orange",
    fonts: { heading: "Oswald", body: "Inter" },
    radius: "0.25rem",
    colors: {
      background: "0 0% 4%",
      foreground: "0 0% 98%",
      card: "0 0% 8%",
      "card-foreground": "0 0% 98%",
      // 42% L keeps the signature orange while passing AA (4.7:1) with white text.
      primary: "16 100% 42%",
      "primary-foreground": "0 0% 100%",
      secondary: "0 0% 14%",
      "secondary-foreground": "0 0% 98%",
      // Light enough to read as link text on the near-black background.
      accent: "16 100% 60%",
      "accent-foreground": "0 0% 4%",
      muted: "0 0% 14%",
      "muted-foreground": "0 0% 67%",
      destructive: "0 84% 60%",
      "destructive-foreground": "0 0% 100%",
      ...statusTriples("dark"),
      border: "0 0% 18%",
      input: "0 0% 18%",
      ring: "16 100% 50%",
    },
  },
};

// ── New themes (seed specs; expanded by buildTheme) ─────────────────────────────
// Authored from the design workflow's AA-verified palettes. Order within a
// category sets selector order.
export const THEME_SEEDS: ThemeSeed[] = [
  // ── Professional ──
  {
    id: "emerald-growth", name: "Emerald Growth", category: "professional", mode: "light",
    tagline: "Fresh, trustworthy, built to scale.",
    headingFont: "Plus Jakarta Sans", bodyFont: "Inter", radius: "0.625rem",
    primary: "#03875B", primaryForeground: "#FFFFFF",
    accent: "#047857", accentForeground: "#FFFFFF",
    background: "#FBFDFC", surface: "#FFFFFF", subtle: "#EEF6F2",
    text: "#0F2A22", mutedText: "#4B635B", border: "#C8DAD2",
    success: "#03875B", warning: "#B45309", info: "#0E7490", error: "#DC2626",
  },
  {
    id: "royal-sapphire", name: "Royal Sapphire", category: "professional", mode: "light",
    tagline: "Enterprise blue, built on quiet trust.",
    headingFont: "Inter", bodyFont: "Inter", radius: "0.5rem",
    primary: "#1E40AF", primaryForeground: "#FFFFFF",
    accent: "#1D4ED8", accentForeground: "#FFFFFF",
    background: "#F8FAFC", surface: "#FFFFFF", subtle: "#F1F5F9",
    text: "#0F172A", mutedText: "#475569", border: "#CBD5E1",
    success: "#15803D", warning: "#B45309", info: "#1D4ED8", error: "#B91C1C",
  },
  {
    id: "ocean-breeze", name: "Ocean Breeze", category: "professional", mode: "light",
    tagline: "Calm, airy blues for trust and clarity",
    headingFont: "Plus Jakarta Sans", bodyFont: "Inter", radius: "0.625rem",
    primary: "#0E7C9B", primaryForeground: "#FFFFFF",
    accent: "#0B6E8A", accentForeground: "#FFFFFF",
    background: "#F4F9FC", surface: "#FFFFFF", subtle: "#E8F2F8",
    text: "#0F2E3E", mutedText: "#4A6B7A", border: "#B4D0E0",
    success: "#0E8064", warning: "#9A6206", info: "#1A6FA0", error: "#C43838",
  },
  {
    id: "forest-wellness", name: "Forest Wellness", category: "professional", mode: "light",
    tagline: "Calm, organic green wellness on warm paper",
    headingFont: "Fraunces", bodyFont: "Work Sans", radius: "0.5rem",
    primary: "#2F5D45", primaryForeground: "#FFFFFF",
    accent: "#3A6B4E", accentForeground: "#FFFFFF",
    background: "#F7F4EC", surface: "#FFFFFF", subtle: "#EFEBE0",
    text: "#1F2A23", mutedText: "#566158", border: "#D2CBB9",
    success: "#2E7D52", warning: "#92650F", info: "#2D6E8E", error: "#B23A33",
  },
  // ── Minimalist ──
  {
    id: "arctic-mono", name: "Arctic Mono", category: "minimalist", mode: "light",
    tagline: "High-contrast black-and-white, one quiet ink.",
    headingFont: "Inter", bodyFont: "Inter", radius: "0.25rem",
    primary: "#191919", primaryForeground: "#FAFAF9",
    accent: "#3A5BC7", accentForeground: "#FFFFFF",
    background: "#FFFFFF", surface: "#FFFFFF", subtle: "#F5F5F4",
    text: "#191919", mutedText: "#5B5B59", border: "#D8D7D3",
    success: "#2F7D4F", warning: "#946207", info: "#3A5BC7", error: "#C0362C",
  },
  {
    id: "carbon-graphite", name: "Carbon Graphite", category: "minimalist", mode: "dark",
    tagline: "Graphite calm for focused dashboards",
    headingFont: "Inter", bodyFont: "Inter", radius: "0.375rem",
    primary: "#5B8DEF", primaryForeground: "#0B0E13",
    accent: "#7FA7F0", accentForeground: "#0B0E13",
    background: "#16181D", surface: "#1C1F26", subtle: "#22262E",
    text: "#E6E9EF", mutedText: "#9CA3B0", border: "#343A45",
    success: "#4ADE80", warning: "#FBBF24", info: "#60A5FA", error: "#F87171",
  },
  // ── Dark ──
  {
    id: "obsidian", name: "Obsidian", category: "dark", mode: "dark",
    tagline: "Near-black elegance with a whisper of silver",
    headingFont: "Sora", bodyFont: "Inter", radius: "0.375rem",
    primary: "#E6E6EA", primaryForeground: "#0A0A0B",
    accent: "#C7CAD1", accentForeground: "#0A0A0B",
    background: "#0A0A0B", surface: "#141416", subtle: "#1C1C1F",
    text: "#ECECEE", mutedText: "#A0A0A8", border: "#2C2C30",
    success: "#34D399", warning: "#FBBF24", info: "#7DA9D8", error: "#F87171",
  },
  {
    id: "neon-pulse", name: "Neon Pulse", category: "dark", mode: "dark",
    tagline: "Cyberpunk neon energy, electric blue to pink",
    headingFont: "Space Grotesk", bodyFont: "Inter", radius: "0.75rem",
    primary: "#7B2FF7", primaryForeground: "#FFFFFF",
    accent: "#22D3EE", accentForeground: "#06121A",
    background: "#0A0A12", surface: "#14141F", subtle: "#1C1C2B",
    text: "#ECECF5", mutedText: "#A0A0C0", border: "#2E2E45",
    success: "#2EE6A6", warning: "#FFB020", info: "#38BDF8", error: "#FF4D6D", gradientFrom: "#22D3EE", gradientTo: "#FF2EC4",
  },
  // ── Luxury ──
  {
    id: "executive-black", name: "Executive Black", category: "luxury", mode: "dark",
    tagline: "Black and gold. Quietly, decisively expensive.",
    headingFont: "Cormorant Garamond", bodyFont: "Inter", radius: "0.125rem",
    primary: "#C8A24A", primaryForeground: "#0A0A0B",
    accent: "#D4AF37", accentForeground: "#0A0A0B",
    background: "#0A0A0B", surface: "#141416", subtle: "#1C1C1F",
    text: "#F2EFE9", mutedText: "#A39E92", border: "#33312C",
    success: "#5BAE6B", warning: "#D9A441", info: "#5B9BD5", error: "#D9534F",
  },
  {
    id: "champagne-gold", name: "Champagne Gold", category: "luxury", mode: "light",
    tagline: "Warm champagne, soft gold, quiet luxury.",
    headingFont: "Cormorant Garamond", bodyFont: "Outfit", radius: "0.25rem",
    primary: "#7A5A28", primaryForeground: "#FFFBF0",
    accent: "#8A6A1E", accentForeground: "#FFFBF0",
    background: "#FAF4E8", surface: "#FFFDF7", subtle: "#F3E9D5",
    text: "#2B2114", mutedText: "#6E5C40", border: "#D8C49E",
    success: "#3F6B43", warning: "#8A5E0E", info: "#3A5F86", error: "#A23A2E",
  },
  {
    id: "velvet-noir", name: "Velvet Noir", category: "luxury", mode: "dark",
    tagline: "Black velvet and warm gold, opulent and quiet.",
    headingFont: "Cormorant Garamond", bodyFont: "Spectral", radius: "0.25rem",
    primary: "#C9A24B", primaryForeground: "#1A1208",
    accent: "#D9B96A", accentForeground: "#1A1208",
    background: "#0B0708", surface: "#1A1214", subtle: "#241A1C",
    text: "#F3E9DC", mutedText: "#B9A892", border: "#3A2C2E",
    success: "#5BA877", warning: "#D9A441", info: "#6FA8C9", error: "#D9695F",
  },
  // ── Modern SaaS ──
  {
    id: "ai-horizon", name: "AI Horizon", category: "saas", mode: "dark",
    tagline: "Indigo depths, cyan light on the edge of tomorrow",
    headingFont: "Space Grotesk", bodyFont: "Inter", radius: "0.75rem",
    primary: "#7C8BFF", primaryForeground: "#0A0E20",
    accent: "#3DE3F0", accentForeground: "#04121A",
    background: "#0A0E20", surface: "#131A33", subtle: "#1B2342",
    text: "#E8ECFB", mutedText: "#9AA6CC", border: "#2A3358",
    success: "#36D9A0", warning: "#F5B544", info: "#52B6FF", error: "#FF6B81", gradientFrom: "#6366F1", gradientTo: "#22D3EE",
  },
  {
    id: "quantum-blue", name: "Quantum Blue", category: "saas", mode: "light",
    tagline: "Electric blue precision for enterprise teams",
    headingFont: "Space Grotesk", bodyFont: "Inter", radius: "0.625rem",
    primary: "#1A56DB", primaryForeground: "#FFFFFF",
    accent: "#0E7490", accentForeground: "#FFFFFF",
    background: "#F7F9FC", surface: "#FFFFFF", subtle: "#EDF1F8",
    text: "#0F1B2D", mutedText: "#52617A", border: "#C6D0E0",
    success: "#0E7D48", warning: "#B45309", info: "#1A56DB", error: "#D02538",
  },
  {
    id: "aurora-gradient", name: "Aurora Gradient", category: "saas", mode: "light",
    tagline: "Violet-to-cyan aurora for modern startups",
    headingFont: "Space Grotesk", bodyFont: "Inter", radius: "0.75rem",
    primary: "#6D28D9", primaryForeground: "#FFFFFF",
    accent: "#0E7490", accentForeground: "#FFFFFF",
    background: "#F5F6FC", surface: "#FFFFFF", subtle: "#ECEEF9",
    text: "#1A1B3A", mutedText: "#54577A", border: "#C5CBE6",
    success: "#0E7A54", warning: "#B45309", info: "#0E7490", error: "#DC2626", gradientFrom: "#7C3AED", gradientTo: "#22D3EE",
  },
  // ── Fun & Friendly ──
  {
    id: "bubblegum-cute", name: "Bubblegum Cute", category: "fun", mode: "light",
    tagline: "Sweet bubblegum pink, soft and playful.",
    headingFont: "Poppins", bodyFont: "Figtree", radius: "1rem",
    primary: "#D62D86", primaryForeground: "#FFFFFF",
    accent: "#C4267D", accentForeground: "#FFFFFF",
    background: "#FFF5F9", surface: "#FFFFFF", subtle: "#FFEAF2",
    text: "#3D1F2E", mutedText: "#8A5A6E", border: "#F2BAD3",
    success: "#0E7A4F", warning: "#A8650A", info: "#2563B0", error: "#C62F44",
  },
  {
    id: "peach-blossom", name: "Peach Blossom", category: "fun", mode: "light",
    tagline: "Warm peach and rosy blooms, soft and friendly",
    headingFont: "Poppins", bodyFont: "DM Sans", radius: "1rem",
    primary: "#D14249", primaryForeground: "#FFFFFF",
    accent: "#C43A6B", accentForeground: "#FFFFFF",
    background: "#FFF7F2", surface: "#FFFFFF", subtle: "#FCE9E0",
    text: "#4A2C2A", mutedText: "#8A5C57", border: "#F0C8B8",
    success: "#1E7D62", warning: "#9A6209", info: "#2E6FA8", error: "#C0303C",
  },
  {
    id: "lavender-dream", name: "Lavender Dream", category: "fun", mode: "light",
    tagline: "Soft violet dreams, airy and sweet",
    headingFont: "Poppins", bodyFont: "Plus Jakarta Sans", radius: "1rem",
    primary: "#7C4DDB", primaryForeground: "#FFFFFF",
    accent: "#7C3AED", accentForeground: "#FFFFFF",
    background: "#F7F3FC", surface: "#FFFFFF", subtle: "#F1E9FB",
    text: "#3B2F4A", mutedText: "#6B5E7A", border: "#D6C0EC",
    success: "#2C8254", warning: "#9A6217", info: "#4A66C8", error: "#C53A52",
  },
];

const SEEDED_PRESETS: Record<string, ThemePreset> = Object.fromEntries(
  THEME_SEEDS.map((s) => [s.id, buildTheme(s)]),
);

export const THEME_PRESETS: Record<string, ThemePreset> = {
  ...CORE_PRESETS,
  ...SEEDED_PRESETS,
};

export const DEFAULT_THEME = THEME_PRESETS["clinical-white"];

/** Presets grouped by category, in `THEME_CATEGORIES` order (empty groups dropped). */
export function presetsByCategory(): { category: ThemeCategory; label: string; presets: ThemePreset[] }[] {
  const all = Object.values(THEME_PRESETS);
  return THEME_CATEGORIES.map(({ id, label }) => ({
    category: id,
    label,
    presets: all.filter((p) => p.category === id),
  })).filter((g) => g.presets.length > 0);
}
