/**
 * Pepweb Admin design tokens — the same editorial system as pepweb.store
 * (src/app/(marketing)/marketing/marketing.css): warm paper, ink text, one
 * forest-green accent, hairline dividers, Instrument Serif headlines over
 * Instrument Sans body, 8/12px corners, no gradients.
 *
 * These are the SIGNED-OUT look (sign-in screen) and the fallback. Once signed
 * in, the app wears the store's website: colours from /me.theme.palette and
 * the website's own fonts (ThemeProvider + brandFonts.ts). Spacing, radius
 * and status tones stay app-owned so "Cancelled" or "Proof submitted" look
 * the same everywhere — and every status also carries an icon and a word,
 * never colour alone.
 */
import type { TextStyle } from "react-native";
import type { Tone } from "@contract";

export type Scheme = "light" | "dark";

export type Neutrals = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  overlay: string;
  /** The site's dark band (hero cards, final CTA): ink in light, deep green in dark. */
  band: string;
  bandText: string;
  bandMuted: string;
  bandLine: string;
  /** Chart ink: the one data colour, its on-band variant, and its quiet track. */
  chart: string;
  chartOnBand: string;
  chartTrack: string;
};

/** marketing.css palette, verbatim. */
export const PEPWEB = {
  paper: "#FAF8F3",
  paperDeep: "#F3F0E8",
  ink: "#1D1B16",
  body: "#55524A",
  soft: "#6B675C",
  muted: "#8A8578",
  line: "#E4E0D5",
  green: "#2E5C46",
  greenDark: "#234736",
  greenLight: "#9FC3AE",
  greenTint: "#EAF0EA",
  darkMuted: "#A8A498",
  darkBody: "#C9C4B6",
  darkLine: "#3B382F",
  danger: "#B5442D",
} as const;

export const NEUTRALS: Record<Scheme, Neutrals> = {
  light: {
    bg: PEPWEB.paper,
    surface: "#FFFFFF",
    surfaceAlt: PEPWEB.paperDeep,
    border: PEPWEB.line,
    text: PEPWEB.ink,
    textMuted: PEPWEB.body,
    textFaint: PEPWEB.soft,
    overlay: "rgba(29,27,22,0.45)",
    band: PEPWEB.ink,
    bandText: PEPWEB.paper,
    bandMuted: PEPWEB.darkBody,
    bandLine: PEPWEB.darkLine,
    chart: PEPWEB.green,
    chartOnBand: PEPWEB.greenLight,
    chartTrack: PEPWEB.line,
  },
  dark: {
    bg: "#15140F",
    // Keep in sync with DARK_SURFACE in src/lib/mobile/theme.ts (server).
    surface: PEPWEB.ink,
    surfaceAlt: "#26241E",
    border: PEPWEB.darkLine,
    text: PEPWEB.paperDeep,
    textMuted: PEPWEB.darkBody,
    textFaint: PEPWEB.darkMuted,
    overlay: "rgba(0,0,0,0.6)",
    band: "#1F3A2D",
    bandText: PEPWEB.paper,
    bandMuted: "#C4D6CB",
    bandLine: "#2F4F3F",
    chart: PEPWEB.greenLight,
    chartOnBand: PEPWEB.greenLight,
    chartTrack: PEPWEB.darkLine,
  },
};

export type ToneColors = { bg: string; fg: string };

/** Every fg/bg pair below is ≥ 4.5:1. */
export const TONES: Record<Scheme, Record<Tone, ToneColors>> = {
  light: {
    neutral: { bg: PEPWEB.paperDeep, fg: "#4A463E" },
    info: { bg: "#E6EDF2", fg: "#284B66" },
    success: { bg: PEPWEB.greenTint, fg: PEPWEB.greenDark },
    warning: { bg: "#F6ECD6", fg: "#6F4600" },
    danger: { bg: "#F7E4DE", fg: "#932F1C" },
  },
  dark: {
    neutral: { bg: "#2A2822", fg: "#D8D3C6" },
    info: { bg: "#1B2A36", fg: "#A9C6DD" },
    success: { bg: "#18291F", fg: PEPWEB.greenLight },
    warning: { bg: "#33280F", fg: "#EDC878" },
    danger: { bg: "#3A1C15", fg: "#F2A897" },
  },
};

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

/** The site's --radius (8) and --radius-lg (12). */
export const RADIUS = { sm: 6, md: 8, lg: 12, pill: 999 } as const;

/** Minimum touch target (iOS HIG 44pt / Material 48dp → use 48). */
export const TOUCH = 48;

/** Bundled font families (loaded in app/_layout.tsx). */
export const FONT = {
  serif: "InstrumentSerif_400Regular",
  serifItalic: "InstrumentSerif_400Regular_Italic",
  sans: "InstrumentSans_400Regular",
  sansMedium: "InstrumentSans_500Medium",
  sansSemi: "InstrumentSans_600SemiBold",
  sansBold: "InstrumentSans_700Bold",
} as const;

/** One family per role: `serif*` = the headline face, `sans*` = the body face. */
export type FontSet = { [K in keyof typeof FONT]: string };

/**
 * Headline face for titles and hero numbers, body face for everything
 * operational. Custom fonts carry their weight in the family name, so no
 * fontWeight is set.
 */
export function makeType(font: FontSet) {
  return {
    display: { fontFamily: font.serif, fontSize: 40, lineHeight: 44, letterSpacing: -0.6 },
    title: { fontFamily: font.serif, fontSize: 30, lineHeight: 34, letterSpacing: -0.3 },
    heading: { fontFamily: font.sansSemi, fontSize: 17, lineHeight: 23 },
    body: { fontFamily: font.sans, fontSize: 16, lineHeight: 23 },
    bodyStrong: { fontFamily: font.sansSemi, fontSize: 16, lineHeight: 23 },
    label: { fontFamily: font.sansMedium, fontSize: 14, lineHeight: 19 },
    caption: { fontFamily: font.sans, fontSize: 13, lineHeight: 18 },
    overline: { fontFamily: font.sansSemi, fontSize: 11, lineHeight: 14, letterSpacing: 1.8 },
    number: { fontFamily: font.serif, fontSize: 44, lineHeight: 48, letterSpacing: -0.8 },
    stat: { fontFamily: font.sansSemi, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  } as const satisfies Record<string, TextStyle>;
}

/** The Pepweb type scale (signed-out screens). Signed in, read `useTheme().type`. */
export const TYPE = makeType(FONT);

export type TypeScale = ReturnType<typeof makeType>;
export type TypeVariant = keyof typeof TYPE;

/** The Pepweb brand — signed out, or a cached /me from before store palettes. */
export const PEPWEB_BRAND = {
  name: "PepWorld",
  logoUrl: null as string | null,
  primary: PEPWEB.green,
  onPrimary: "#FFFFFF",
  primaryText: PEPWEB.green,
  primaryTextDark: PEPWEB.greenLight,
  accent: PEPWEB.greenLight,
  headerBackground: PEPWEB.ink,
  headerText: PEPWEB.paper,
};
