/**
 * Theme presets power the onboarding "Choose Theme" step.
 * Colors are HSL channel triples ("H S% L%") so they drop straight into
 * `hsl(var(--token))` in tailwind.config.ts. Tenants override via Branding.colors.
 */
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
  destructive: string;
  "destructive-foreground": string;
  border: string;
  input: string;
  ring: string;
};

export type ThemePreset = {
  id: string;
  name: string;
  fonts: { heading: string; body: string };
  radius: string;
  colors: ThemeTokens;
};

export const THEME_PRESETS: Record<string, ThemePreset> = {
  "clinical-white": {
    id: "clinical-white",
    name: "Clinical White",
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
      border: "214 32% 91%",
      input: "214 32% 91%",
      ring: "201 96% 32%",
    },
  },
  "midnight-lab": {
    id: "midnight-lab",
    name: "Midnight Lab",
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
      border: "217 33% 20%",
      input: "217 33% 20%",
      ring: "156 72% 45%",
    },
  },
  "apex-performance": {
    id: "apex-performance",
    name: "Apex Performance",
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
      border: "0 0% 18%",
      input: "0 0% 18%",
      ring: "16 100% 50%",
    },
  },
};

export const DEFAULT_THEME = THEME_PRESETS["clinical-white"];
