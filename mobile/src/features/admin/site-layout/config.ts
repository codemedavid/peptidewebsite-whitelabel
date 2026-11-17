// COPIED from src/lib/storefront/intl-local/config.ts and
// src/lib/storefront/section-background.ts (types + colorBackground) — keep in
// sync; the server re-normalizes.
//
// The Intl & Local layout's CONFIG (branding.config.intlLocal): its shape and
// the reference defaults ("Restore defaults" and any key a store never saved).

import type { IlLink } from "./links";

// ── section background ─────────────────────────────────────────────────────
export const BACKGROUND_TYPES = ["color", "image", "image-color"] as const;
export type BackgroundType = (typeof BACKGROUND_TYPES)[number];
export const BACKGROUND_POSITIONS = ["center", "top", "bottom", "left", "right"] as const;
export type BackgroundPosition = (typeof BACKGROUND_POSITIONS)[number];
export const BACKGROUND_SIZES = ["cover", "contain", "custom"] as const;
export type BackgroundSize = (typeof BACKGROUND_SIZES)[number];

export type SectionBackground = {
  type: BackgroundType;
  color: string;
  imageUrl: string;
  imageOpacity: number;
  position: BackgroundPosition;
  size: BackgroundSize;
  customSize: number;
  overlayColor: string;
  overlayOpacity: number;
};

export const DEFAULT_IMAGE_OPACITY = 18;
export const CUSTOM_SIZE_MIN = 10;
export const CUSTOM_SIZE_MAX = 300;

export function colorBackground(color: string): SectionBackground {
  return {
    type: "color",
    color,
    imageUrl: "",
    imageOpacity: DEFAULT_IMAGE_OPACITY,
    position: "center",
    size: "cover",
    customSize: 100,
    overlayColor: "",
    overlayOpacity: 0,
  };
}

// ── layout config ──────────────────────────────────────────────────────────
export const IL_ICONS = [
  "none", "truck", "globe", "plane", "book", "file", "tools", "flask", "users", "chat", "mail",
  "phone", "heart", "star", "shield", "sparkle", "cart", "pin", "leaf", "gift",
] as const;
export type IlIcon = (typeof IL_ICONS)[number];

export const IL_BUTTON_STYLES = ["solid", "outline", "soft"] as const;
export type IlButtonStyle = (typeof IL_BUTTON_STYLES)[number];

export const IL_SECTION_KEYS = ["hero", "markets", "learn", "community", "newsletter"] as const;

export const IL_SOCIAL_PLATFORMS = ["facebook", "instagram", "youtube", "tiktok", "twitter", "telegram", "whatsapp", "viber"] as const;
export type IlSocialPlatform = (typeof IL_SOCIAL_PLATFORMS)[number];

export const IL_ART_BLENDS = ["blend", "cover", "watermark", "normal"] as const;
export type IlArtBlend = (typeof IL_ART_BLENDS)[number];
export const IL_ART_SIZES = ["sm", "md", "lg"] as const;
export type IlArtSize = (typeof IL_ART_SIZES)[number];
export const IL_FOCUSES = ["center", "top", "bottom", "left", "right"] as const;

export type IlButton = { show: boolean; label: string; link: IlLink; style: IlButtonStyle; color: string; textColor: string };
export type IlNavChild = { id: string; show: boolean; label: string; link: IlLink };
export type IlNavItem = { id: string; show: boolean; label: string; link: IlLink; children: IlNavChild[] };

export type IlTheme = {
  useBrandColors: boolean;
  pageBg: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  accentText: string;
  radius: number;
  headingFont: string;
  bodyFont: string;
  headingWeight: number;
  scale: "sm" | "md" | "lg";
  spacing: "compact" | "cozy" | "roomy";
};

export type IlTopBar = { show: boolean; text: string; subscribeLabel: string; showSocials: boolean; background: SectionBackground; textColor: string };

export type IlHeader = {
  brandName: string;
  showLogo: boolean;
  logoUrl: string;
  logoHeight: number;
  bgColor: string;
  textColor: string;
  showSearch: boolean;
  showCart: boolean;
  sticky: boolean;
};

export type IlHero = {
  show: boolean;
  eyebrow: string;
  title: string;
  description: string;
  align: "left" | "center";
  imageUrl: string;
  mobileImageUrl: string;
  imageAlt: string;
  imageSide: "right" | "left" | "none";
  buttons: IlButton[];
  background: SectionBackground;
  textColor: string;
};

export type IlMarketCard = {
  id: string;
  show: boolean;
  eyebrow: string;
  title: string;
  currency: string;
  description: string;
  icon: IlIcon;
  imageUrl: string;
  imageBlend: IlArtBlend;
  imageSize: IlArtSize;
  imageFocus: (typeof IL_FOCUSES)[number];
  imageOpacity: number;
  button: IlButton;
  background: SectionBackground;
  textColor: string;
};

export type IlCard = {
  id: string;
  show: boolean;
  title: string;
  description: string;
  icon: IlIcon;
  imageUrl: string;
  ctaLabel: string;
  link: IlLink;
  iconBg: string;
  background: SectionBackground;
  textColor: string;
};

export type IlBand = {
  id: string;
  show: boolean;
  title: string;
  description: string;
  icon: IlIcon;
  imageUrl: string;
  button: IlButton;
  background: SectionBackground;
  textColor: string;
};

export type IlNewsletter = {
  show: boolean;
  title: string;
  description: string;
  icon: IlIcon;
  placeholder: string;
  buttonLabel: string;
  successMessage: string;
  background: SectionBackground;
  textColor: string;
};

export type IlSocial = { id: string; platform: IlSocialPlatform; url: string };

export type IlFooter = {
  show: boolean;
  brandName: string;
  tagline: string;
  links: IlNavChild[];
  useStoreSocials: boolean;
  socials: IlSocial[];
  copyright: string;
  background: SectionBackground;
  textColor: string;
};

export type IlFab = {
  show: boolean;
  label: string;
  icon: IlIcon;
  color: string;
  textColor: string;
  position: "right" | "left";
  showDesktop: boolean;
  showMobile: boolean;
  link: IlLink;
};

export type IlInfoPage = { id: string; title: string; body: string };
export type IlSectionGroup<T> = { show: boolean; title: string; description: string; cards: T[] };

export type IntlLocalConfig = {
  theme: IlTheme;
  topBar: IlTopBar;
  header: IlHeader;
  nav: IlNavItem[];
  hero: IlHero;
  markets: IlSectionGroup<IlMarketCard>;
  learn: IlSectionGroup<IlCard>;
  community: IlBand;
  newsletter: IlNewsletter;
  customSections: IlBand[];
  order: string[];
  footer: IlFooter;
  fab: IlFab;
  infoPages: IlInfoPage[];
};

export const IL_LIMITS = {
  short: 80,
  label: 40,
  long: 400,
  body: 4000,
  nav: 8,
  navChildren: 12,
  cards: 8,
  markets: 4,
  customSections: 6,
  footerLinks: 12,
  socials: 8,
  infoPages: 10,
  buttons: 2,
} as const;

export const IL_PALETTE = {
  cream: "#FFFBF3",
  lavender: "#ECE6FB",
  lavenderDeep: "#D9CEF6",
  pink: "#FAD6E1",
  yellow: "#FBE39A",
  butter: "#FDF1C9",
  ink: "#24104F",
  muted: "#5A4C78",
  accent: "#2E1268",
} as const;

export function button(label: string, link: IlLink, style: IlButtonStyle = "solid"): IlButton {
  return { show: true, label, link, style, color: "", textColor: "" };
}

/** lib/theme/tokens FONT_OPTIONS (registry order), incl. the system "Times New Roman". */
export const FONT_OPTIONS: readonly string[] = [
  "Inter", "DM Sans", "Manrope", "Poppins", "Montserrat", "Work Sans", "Space Grotesk", "Sora", "Outfit", "Figtree",
  "Plus Jakarta Sans", "IBM Plex Sans", "Archivo", "Oswald", "Syne", "Bebas Neue", "Playfair Display", "DM Serif Display",
  "Cormorant Garamond", "Lora", "Libre Baskerville", "Fraunces", "Spectral", "Marcellus", "Bodoni Moda", "Roboto Slab",
  "Times New Roman",
];
