/**
 * Tracker design tokens (docs/mobile-admin/TRACKER.md §4).
 *
 * Every colour is DERIVED — nothing here is a literal:
 *  - surfaces, text and fonts come from the store's website palette
 *    (useTheme: /me.theme.palette, light or dark, already contrast-checked
 *    server-side), so the tracker looks like the rest of the signed-in app;
 *  - the action colour is the store's primary (useChatBrand), with soft fills
 *    mixed toward the current surface, so they work on light AND dark palettes
 *    without `isDark ?` branches;
 *  - status colours come from the app's tone pairs (theme/tokens TONES, each
 *    ≥ 4.5:1), so "missed" or "recent site" read the same on every store.
 *
 * Colour meanings (one job each):
 *   brand      → the one important action, "due", the hero card
 *   done       → taken doses, kept days (success)
 *   missed     → missed doses only (danger)
 *   upcoming / skipped → neutral
 *   ready / recovering / recent → injection-site recency (success / warning / danger)
 *   low        → vial running low / expiring (warning)
 * Every status also carries an icon or a word — never colour alone.
 */
import { useMemo } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import { mix, withAlpha } from "@/features/community/lib/color";
import { useChatBrand } from "@/features/community/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";

// ── Scales ────────────────────────────────────────────────────────────────

/** Spacing (the app's 4-pt scale) plus the tracker's page gutter and section rhythm. */
export const TSPACE = { ...SPACE, gutter: 16, section: 24 } as const;

/** Softer corners than the admin's editorial 8/12: the tracker is a personal, touch-first space. */
export const TRADIUS = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

/** Minimum touch target (iOS HIG 44 pt). */
export const TOUCH_MIN = 44;

/** Motion timings — transform / opacity only. */
export const TMOTION = { press: 90, release: 160, sheet: 240, toast: 5_000 } as const;

export type StatusKey = "done" | "missed" | "due" | "upcoming" | "skipped" | "ready" | "recovering" | "recent" | "low";

/** `solid` = dots, icons and bars; `soft` = fills; `text` = words on `soft` or the surface (≥ 4.5:1). */
export type StatusColors = { solid: string; soft: string; text: string };

export type TrackerTypeVariant = "hero" | "display" | "title" | "headline" | "body" | "bodyStrong" | "meta" | "micro" | "number";

export type TrackerTheme = {
  scheme: "light" | "dark";
  // Surfaces and ink (store palette).
  bg: string;
  surface: string;
  surfaceAlt: string;
  line: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  scrim: string;
  // Brand (store primary).
  brand: string;
  onBrand: string;
  /** Brand colour readable as text on `surface`. */
  brandText: string;
  brandSoft: string;
  brandTint: string;
  /** Hero gradient (brand → a deeper brand). */
  heroFrom: string;
  heroTo: string;
  /** Secondary text / hairlines on the hero. */
  onBrandSoft: string;
  onBrandLine: string;
  status: Record<StatusKey, StatusColors>;
  type: Record<TrackerTypeVariant, TextStyle>;
  shadow: { card: ViewStyle; float: ViewStyle };
};

const TABULAR: TextStyle["fontVariant"] = ["tabular-nums"];

/** The tracker's resolved tokens for the signed-in store. */
export function useTrackerTheme(): TrackerTheme {
  const t = useTheme();
  const b = useChatBrand();
  return useMemo<TrackerTheme>(() => {
    const c = t.colors;
    const tone = t.tone;
    const f = t.font;
    const fromTone = (k: Parameters<typeof tone>[0]): StatusColors => ({ solid: tone(k).fg, soft: tone(k).bg, text: tone(k).fg });
    const brandSoft = mix(b.brand, c.surface, 0.84);
    return {
      scheme: t.scheme,
      bg: c.bg,
      surface: c.surface,
      surfaceAlt: c.surfaceAlt,
      line: c.border,
      ink: c.text,
      inkSoft: c.textMuted,
      inkFaint: c.textFaint,
      scrim: c.overlay,
      brand: b.brand,
      onBrand: b.onBrand,
      brandText: t.brand.link,
      brandSoft,
      brandTint: mix(b.brand, c.surface, 0.92),
      heroFrom: b.brand,
      heroTo: mix(b.brand, c.band, 0.35),
      onBrandSoft: withAlpha(b.onBrand, 0.82),
      onBrandLine: withAlpha(b.onBrand, 0.22),
      status: {
        done: fromTone("success"),
        missed: fromTone("danger"),
        due: { solid: b.brand, soft: brandSoft, text: t.brand.link },
        upcoming: fromTone("neutral"),
        skipped: fromTone("neutral"),
        ready: fromTone("success"),
        recovering: fromTone("warning"),
        recent: fromTone("danger"),
        low: fromTone("warning"),
      },
      type: {
        hero: { fontFamily: f.sansBold, fontSize: 44, lineHeight: 50, letterSpacing: -1.2, fontVariant: TABULAR },
        display: { fontFamily: f.serif, fontSize: 30, lineHeight: 35, letterSpacing: -0.4 },
        title: { fontFamily: f.sansBold, fontSize: 21, lineHeight: 27, letterSpacing: -0.3 },
        headline: { fontFamily: f.sansSemi, fontSize: 17, lineHeight: 23 },
        body: { fontFamily: f.sans, fontSize: 15, lineHeight: 21 },
        bodyStrong: { fontFamily: f.sansSemi, fontSize: 15, lineHeight: 21 },
        meta: { fontFamily: f.sansMedium, fontSize: 13, lineHeight: 18 },
        micro: { fontFamily: f.sansSemi, fontSize: 11, lineHeight: 14, letterSpacing: 1, textTransform: "uppercase" },
        number: { fontFamily: f.sansBold, fontSize: 17, lineHeight: 22, fontVariant: TABULAR },
      },
      shadow: {
        card: { shadowColor: c.text, shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
        float: { shadowColor: c.text, shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
      },
    };
  }, [t, b]);
}
