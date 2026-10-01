import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { MobileBrandTheme, Tone } from "@contract";
import { useBrandFonts } from "./brandFonts";
import {
  makeType,
  NEUTRALS,
  PEPWEB_BRAND,
  TONES,
  type FontSet,
  type Neutrals,
  type Scheme,
  type ToneColors,
  type TypeScale,
} from "./tokens";

/**
 * The resolved theme every component reads.
 *
 * Signed in, the app wears the STORE'S WEBSITE: its page background, card
 * surface, text, header bar, button colour and fonts (/me.theme, translated
 * server-side so every text pair stays readable). Signed out — or with a
 * cached /me from before store palettes — it is the Pepweb editorial look.
 *
 * `brand` is null before sign-in (and after sign-out), so there is never a
 * frame showing another store's name, colours or logo.
 */
export type Theme = {
  scheme: Scheme;
  colors: Neutrals;
  tone: (t: Tone) => ToneColors;
  /** Font family per role (the website's faces once downloaded). */
  font: FontSet;
  /** The type scale set in `font`. */
  type: TypeScale;
  brand: {
    name: string;
    logoUrl: string | null;
    primary: string;
    onPrimary: string;
    /** Brand colour that reads as text/links on the current surface. */
    link: string;
    accent: string;
    headerBackground: string;
    headerText: string;
  };
  isTenantBranded: boolean;
  /** Status-bar content that reads on the header bar ("light" = white icons). */
  statusBar: "light" | "dark";
};

/** Perceived brightness below this (0–255) → white status-bar icons. */
const DARK_BRIGHTNESS = 140;

function isDarkHex(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < DARK_BRIGHTNESS;
}

const OVERLAY: Record<Scheme, string> = {
  light: "rgba(15,15,15,0.45)",
  dark: "rgba(0,0,0,0.6)",
};

function storeColors(brand: MobileBrandTheme | null): { scheme: Scheme; colors: Neutrals } | null {
  const p = brand?.palette;
  if (!p) return null;
  const { scheme, ...colors } = p;
  return { scheme, colors: { ...colors, overlay: OVERLAY[scheme] } };
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({
  brand,
  children,
}: {
  brand: MobileBrandTheme | null;
  children: ReactNode;
}) {
  const font = useBrandFonts(brand?.fonts);

  const theme = useMemo<Theme>(() => {
    const store = storeColors(brand);
    const scheme: Scheme = store?.scheme ?? "light";
    // Store colours only with a store palette — an old cached /me stays Pepweb
    // rather than mixing a store's button colour into Pepweb's paper.
    const b = store && brand ? brand : null;
    const headerBackground = b?.headerBackground ?? NEUTRALS.light.bg;
    return {
      scheme,
      colors: store?.colors ?? NEUTRALS.light,
      tone: (t) => TONES[scheme][t],
      font,
      type: makeType(font),
      brand: {
        name: brand?.name ?? PEPWEB_BRAND.name,
        logoUrl: brand?.logoUrl ?? null,
        primary: b?.primary ?? PEPWEB_BRAND.primary,
        onPrimary: b?.onPrimary ?? PEPWEB_BRAND.onPrimary,
        link: b?.primaryText ?? PEPWEB_BRAND.primaryText,
        accent: b?.accent ?? PEPWEB_BRAND.accent,
        headerBackground,
        headerText: b?.headerText ?? NEUTRALS.light.text,
      },
      isTenantBranded: !!b,
      statusBar: isDarkHex(headerBackground) ? "light" : "dark",
    };
  }, [brand, font]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error("useTheme must be used inside <ThemeProvider>");
  return t;
}
