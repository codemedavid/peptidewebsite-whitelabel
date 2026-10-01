// Chat design tokens — the inspiration's "social" system (cool neutral canvas,
// dense rows, hairlines, bubbles on a soft wallpaper, Inter type scale), with
// its cerise brand swapped for the STORE's own primary colour from /me.theme.
import { useMemo } from "react";
import type { TextStyle } from "react-native";
import type { MobileBrandTheme } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { mix, withAlpha } from "./lib/color";

export const CHAT = {
  canvas: "#F2F3F6",
  surface: "#FFFFFF",
  surfaceAlt: "#F7F8FA",
  surfacePressed: "#EEF0F3",
  hairline: "#E7E8EC",
  hairlineStrong: "#D8DAE0",

  ink: "#0F1115",
  inkSoft: "#3A3E47",
  inkMuted: "#646A76", // darkened from the inspiration's #767C88 for 4.5:1 on white
  inkFaint: "#8A909B",

  heat: "#D63A24",
  heatSoft: "#FFEDE8",
  night: "#1B0F16",
  nightSoft: "#2B1722",
  nightEdge: "#43283A",

  success: "#1B7F46",
  successSoft: "#E3F6EA",
  warning: "#8A5208",
  warningSoft: "#FCF0DC",
  danger: "#C22536",
  dangerSoft: "#FDE6E8",
  info: "#1F63D1",

  bubbleTheirs: "#FFFFFF",
  searchHit: "#FFE27A",
  searchHitWash: "rgba(255,226,122,0.38)",
  scrim: "rgba(15,17,21,0.45)",
  pill: "rgba(15,17,21,0.42)",
} as const;

export const GRADIENTS = {
  wallpaper: ["#F7E9EE", "#F1E8F1", "#EAE7F4"] as const,
  night: ["#1B0F16", "#2B1722", "#43283A"] as const,
};

export const INTER = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

export const RADII = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;
export const GUTTER = 16;
/** Minimum touch target for chat controls. */
export const HIT = 44;

export const SHADOWS = {
  hairline: { shadowColor: "#0F1115", shadowOpacity: 0.04, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  card: { shadowColor: "#1A1420", shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  float: { shadowColor: "#1A1420", shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
} as const;

/** The inspiration's Inter type scale. */
export const CHAT_TYPE = {
  largeTitle: { fontFamily: INTER.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  title: { fontFamily: INTER.bold, fontSize: 20, lineHeight: 25, letterSpacing: -0.4 },
  headline: { fontFamily: INTER.semibold, fontSize: 16, lineHeight: 21, letterSpacing: -0.2 },
  body: { fontFamily: INTER.regular, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: INTER.semibold, fontSize: 15, lineHeight: 21 },
  callout: { fontFamily: INTER.regular, fontSize: 14, lineHeight: 19 },
  subhead: { fontFamily: INTER.medium, fontSize: 13.5, lineHeight: 18 },
  footnote: { fontFamily: INTER.regular, fontSize: 12.5, lineHeight: 17 },
  caption: { fontFamily: INTER.medium, fontSize: 11.5, lineHeight: 15 },
  overline: { fontFamily: INTER.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 0.9, textTransform: "uppercase" },
} as const satisfies Record<string, TextStyle>;

export type ChatTypeVariant = keyof typeof CHAT_TYPE;

/** The store's colour and its derived soft fills. */
export type ChatBrand = {
  brand: string;
  onBrand: string;
  /** Brand colour that reads as text on white (≥ 4.5:1, from the server). */
  brandText: string;
  brandDeep: string;
  brandSoft: string;
  brandTint: string;
  brandEdge: string;
  bubbleMine: string;
  onBubbleMine: string;
  /** Clock / ticks on my bubble. */
  metaMine: string;
  deletedMine: string;
};

export function brandFrom(theme: Pick<MobileBrandTheme, "primary" | "onPrimary" | "primaryText">): ChatBrand {
  const { primary, onPrimary, primaryText } = theme;
  return {
    brand: primary,
    onBrand: onPrimary,
    brandText: primaryText,
    brandDeep: mix(primary, "#000000", 0.18),
    brandSoft: mix(primary, "#FFFFFF", 0.86),
    brandTint: mix(primary, "#FFFFFF", 0.94),
    brandEdge: mix(primary, "#FFFFFF", 0.7),
    bubbleMine: primary,
    onBubbleMine: onPrimary,
    metaMine: withAlpha(onPrimary, 0.8),
    deletedMine: withAlpha(primary, 0.55),
  };
}

/** The signed-in store's chat brand. */
export function useChatBrand(): ChatBrand {
  const { me } = useSignedIn();
  const { primary, onPrimary, primaryText } = me.theme;
  return useMemo(() => brandFrom({ primary, onPrimary, primaryText }), [primary, onPrimary, primaryText]);
}
