// The Intl & Local layout's CONFIG — its shape and its defaults.
//
// Stored per tenant at branding.config.intlLocal. Everything the layout draws
// comes from here: every heading, label, button, menu item, card, image,
// colour and section switch. Nothing in the components is hardcoded copy.
//
// The defaults are the pastel reference design (cream + lavender, purple
// accents, pink/yellow highlights) and its sample copy. They are STARTING
// values only — the owner edits all of them — and they carry no business name,
// no products and no prices: the brand name falls back to the tenant's own
// store name at render, and anything the store hasn't set up (a contact
// channel, an international store link, an info page) renders nothing until it
// is (see ./links).

import { colorBackground, type SectionBackground } from "../section-background";
import {
  CONTACT_LINK,
  NO_LINK,
  catalogLink,
  infoLink,
  marketLink,
  pageLink,
  sectionLink,
  urlLink,
  type IlLink,
} from "./links";

export const IL_ICONS = [
  "none", "truck", "globe", "plane", "book", "file", "tools", "flask", "users", "chat", "mail",
  "phone", "heart", "star", "shield", "sparkle", "cart", "pin", "leaf", "gift",
] as const;
export type IlIcon = (typeof IL_ICONS)[number];

export const IL_BUTTON_STYLES = ["solid", "outline", "soft"] as const;
export type IlButtonStyle = (typeof IL_BUTTON_STYLES)[number];

export const IL_SECTION_KEYS = ["hero", "markets", "learn", "community", "newsletter"] as const;
export type IlSectionKey = (typeof IL_SECTION_KEYS)[number];

export const IL_SOCIAL_PLATFORMS = ["facebook", "instagram", "youtube", "tiktok", "twitter", "telegram", "whatsapp", "viber"] as const;
export type IlSocialPlatform = (typeof IL_SOCIAL_PLATFORMS)[number];

export type IlButton = {
  show: boolean;
  label: string;
  link: IlLink;
  style: IlButtonStyle;
  /** Optional overrides; "" = the theme's accent / accent text. */
  color: string;
  textColor: string;
};

export type IlNavChild = { id: string; show: boolean; label: string; link: IlLink };

export type IlNavItem = {
  id: string;
  show: boolean;
  label: string;
  /** Where the top-level label goes when it has no dropdown. */
  link: IlLink;
  children: IlNavChild[];
};

export type IlTheme = {
  /** true = take colours from the store's own brand palette instead. */
  useBrandColors: boolean;
  pageBg: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  accentText: string;
  /** Card / button corner radius, px. */
  radius: number;
  /** A registered font name, or "" to keep the store's fonts. */
  headingFont: string;
  bodyFont: string;
  headingWeight: number;
  /** Overall type scale. */
  scale: "sm" | "md" | "lg";
  /** Vertical rhythm between sections. */
  spacing: "compact" | "cozy" | "roomy";
};

export type IlTopBar = {
  show: boolean;
  text: string;
  subscribeLabel: string;
  showSocials: boolean;
  background: SectionBackground;
  textColor: string;
};

export type IlHeader = {
  /** "" = the store's own name. */
  brandName: string;
  showLogo: boolean;
  /** "" = the store's own logo. */
  logoUrl: string;
  /** Logo height in px; the width follows the image's own shape. */
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
  /** Where the hero photo sits beside the copy; "none" = copy only. */
  imageSide: "right" | "left" | "none";
  buttons: IlButton[];
  background: SectionBackground;
  textColor: string;
};

/** How a card's decorative image (flag, map, logo, photo) meets the card:
 *  "blend" multiplies it into the card's own colours, so a white or light
 *  background vanishes; "cover" fills the WHOLE card underneath the text,
 *  mixed into the card colour; "watermark" is large, faint and behind the
 *  text; "normal" shows the picture exactly as uploaded. */
export const IL_ART_BLENDS = ["blend", "cover", "watermark", "normal"] as const;
export type IlArtBlend = (typeof IL_ART_BLENDS)[number];
export const IL_ART_SIZES = ["sm", "md", "lg"] as const;
export type IlArtSize = (typeof IL_ART_SIZES)[number];

export type IlMarketCard = {
  id: string;
  show: boolean;
  eyebrow: string;
  title: string;
  /** Display label only (e.g. "PHP"). Prices always come from the store. */
  currency: string;
  description: string;
  icon: IlIcon;
  /** Optional decorative image (flag, map) on the card's far side. */
  imageUrl: string;
  imageBlend: IlArtBlend;
  imageSize: IlArtSize;
  /** Which part of the photo stays in view when it fills the card. */
  imageFocus: "center" | "top" | "bottom" | "left" | "right";
  /** 0..100 — the decorative image only, never the card's text. */
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
  /** Replaces the icon when set. */
  imageUrl: string;
  ctaLabel: string;
  link: IlLink;
  iconBg: string;
  background: SectionBackground;
  textColor: string;
};

/** A full-width band: the Community section and any custom section. */
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
  /** true = reuse the socials the store already configured. */
  useStoreSocials: boolean;
  socials: IlSocial[];
  /** "{year}" and "{brand}" are filled in at render. */
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
  /** Home section order: IL_SECTION_KEYS plus "custom:<id>" entries. */
  order: string[];
  footer: IlFooter;
  fab: IlFab;
  infoPages: IlInfoPage[];
};

// ── Limits (also the editor's maxLength) ──────────────────────────────────
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

// ── Default palette (the reference design) ────────────────────────────────
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

function child(id: string, label: string, link: IlLink): IlNavChild {
  return { id, show: true, label, link };
}

export const DEFAULT_INFO_PAGES: IlInfoPage[] = [
  { id: "about", title: "About us", body: "" },
  { id: "privacy", title: "Privacy policy", body: "" },
  { id: "terms", title: "Terms of service", body: "" },
  { id: "shipping", title: "Shipping", body: "" },
  { id: "returns", title: "Returns", body: "" },
];

export const DEFAULT_NAV: IlNavItem[] = [
  {
    id: "learn",
    show: true,
    label: "Learn",
    link: pageLink("articles"),
    children: [
      child("articles", "Articles / Blog", pageLink("articles")),
      child("guides", "Beginner Guides", pageLink("protocols")),
      child("library", "Reference Library", pageLink("articles")),
      child("protocols", "Protocols", pageLink("protocols")),
      child("calculator", "Calculator", pageLink("calculator")),
      child("coas", "COAs", pageLink("coa")),
    ],
  },
  {
    id: "shop",
    show: true,
    label: "Shop",
    link: catalogLink(),
    children: [
      child("local", "Philippines · PHP", marketLink("local")),
      child("international", "International · USD", marketLink("international")),
    ],
  },
  {
    id: "community",
    show: true,
    label: "Community",
    link: sectionLink("community"),
    children: [
      child("join", "Join Community", sectionLink("community")),
      child("reviews", "Customer Reviews", pageLink("reviews")),
    ],
  },
  {
    id: "help",
    show: true,
    label: "Help",
    link: pageLink("faq"),
    children: [
      child("faqs", "FAQs", pageLink("faq")),
      child("contact", "Contact Us", CONTACT_LINK),
      child("ordering", "Ordering & Payments", pageLink("faq")),
      child("shipping", "Shipping", infoLink("shipping")),
    ],
  },
  {
    id: "account",
    show: true,
    label: "Account",
    link: pageLink("account"),
    children: [
      child("login", "Login / Sign Up", pageLink("account")),
      child("profile", "Profile & Addresses", pageLink("account")),
      child("orders", "Orders / Track Order", pageLink("track")),
      child("payments", "Payments & Tracking", pageLink("track")),
      child("gb-access", "Group Buy Access", pageLink("groupbuy")),
      child("email", "Email Preferences", sectionLink("newsletter")),
    ],
  },
];

export const DEFAULT_INTL_LOCAL: IntlLocalConfig = {
  theme: {
    useBrandColors: false,
    pageBg: IL_PALETTE.cream,
    surface: "#FFFFFF",
    ink: IL_PALETTE.ink,
    muted: IL_PALETTE.muted,
    accent: IL_PALETTE.accent,
    accentText: "#FFFFFF",
    radius: 18,
    headingFont: "Outfit",
    bodyFont: "DM Sans",
    headingWeight: 800,
    scale: "md",
    spacing: "cozy",
  },
  topBar: {
    show: true,
    text: "Welcome — shop locally or internationally.",
    subscribeLabel: "Subscribe",
    showSocials: true,
    background: colorBackground(IL_PALETTE.lavenderDeep),
    textColor: "",
  },
  header: {
    brandName: "",
    showLogo: true,
    logoUrl: "",
    logoHeight: 40,
    bgColor: "#FFFFFF",
    textColor: "",
    showSearch: true,
    showCart: true,
    sticky: true,
  },
  nav: DEFAULT_NAV,
  hero: {
    show: true,
    eyebrow: "Beauty · Body · Wellness",
    title: "Discover. Understand. Choose.",
    description: "Explore educational resources and shop our products.",
    align: "left",
    imageUrl: "",
    mobileImageUrl: "",
    imageAlt: "",
    imageSide: "right",
    // "Shop Products" leads to the market choice, not straight into one
    // catalog: the shopper picks local or international first.
    buttons: [button("Explore Learn", pageLink("articles")), button("Shop Products", sectionLink("markets"), "outline")],
    background: colorBackground(IL_PALETTE.pink),
    textColor: "",
  },
  markets: {
    show: true,
    title: "Shop your market",
    description: "One store. Two ways to shop. Choose the option that fits your location and needs.",
    cards: [
      {
        id: "local",
        show: true,
        eyebrow: "Local shopping",
        title: "Philippines",
        currency: "PHP",
        description: "On-hand & Group Buy · Vial / Box",
        icon: "truck",
        imageUrl: "",
        imageBlend: "blend",
        imageSize: "md",
        imageFocus: "center",
        imageOpacity: 90,
        button: button("Shop Philippines", marketLink("local")),
        background: colorBackground(IL_PALETTE.yellow),
        textColor: "",
      },
      {
        id: "international",
        show: true,
        eyebrow: "International shopping",
        title: "International",
        currency: "USD",
        description: "Wholesale · Direct Delivery · Full boxes only",
        icon: "globe",
        imageUrl: "",
        imageBlend: "blend",
        imageSize: "md",
        imageFocus: "center",
        imageOpacity: 90,
        // The International shop page: USD prices the owner set per product
        // (lib/storefront/markets). With dual-currency off the link resolves to
        // nothing, so the card never sends shoppers to a peso catalog.
        button: button("Shop International", marketLink("international")),
        background: colorBackground(IL_PALETTE.lavenderDeep),
        textColor: "",
      },
    ],
  },
  learn: {
    show: true,
    title: "Learn & explore",
    description: "Build your knowledge with our curated resources.",
    cards: [
      {
        id: "guides",
        show: true,
        title: "Beginner Guides",
        description: "Start with the essentials and learn at your own pace.",
        icon: "book",
        imageUrl: "",
        ctaLabel: "Explore Guides",
        link: pageLink("protocols"),
        iconBg: IL_PALETTE.lavenderDeep,
        background: colorBackground(IL_PALETTE.lavender),
        textColor: "",
      },
      {
        id: "articles",
        show: true,
        title: "Articles & Research",
        description: "Explore topics, studies, and evidence.",
        icon: "file",
        imageUrl: "",
        ctaLabel: "Explore Articles",
        link: pageLink("articles"),
        iconBg: "#F6BFD0",
        background: colorBackground(IL_PALETTE.pink),
        textColor: "",
      },
      {
        id: "tools",
        show: true,
        title: "Protocols & Tools",
        description: "Guides, tools and calculator for smarter choices.",
        icon: "tools",
        imageUrl: "",
        ctaLabel: "Explore Tools",
        link: pageLink("calculator"),
        iconBg: IL_PALETTE.yellow,
        background: colorBackground(IL_PALETTE.butter),
        textColor: "",
      },
    ],
  },
  community: {
    id: "community",
    show: true,
    title: "Community & Reviews",
    description: "Join the conversation, ask questions and read real customer experiences.",
    icon: "users",
    imageUrl: "",
    button: button("Visit Community", pageLink("reviews")),
    background: colorBackground(IL_PALETTE.lavenderDeep),
    textColor: "",
  },
  newsletter: {
    show: true,
    title: "Stay in the Loop",
    description: "Articles, announcements, and Group Buy updates.",
    icon: "mail",
    placeholder: "Your email address",
    buttonLabel: "Subscribe",
    successMessage: "You're subscribed — thank you!",
    background: colorBackground(IL_PALETTE.yellow),
    textColor: "",
  },
  customSections: [],
  order: [...IL_SECTION_KEYS],
  footer: {
    show: true,
    brandName: "",
    tagline: "Beauty · Body · Wellness",
    links: [
      child("about", "About", infoLink("about")),
      child("contact", "Contact", CONTACT_LINK),
      child("privacy", "Privacy", infoLink("privacy")),
      child("terms", "Terms", infoLink("terms")),
      child("shipping", "Shipping", infoLink("shipping")),
      child("returns", "Returns", infoLink("returns")),
    ],
    useStoreSocials: true,
    socials: [],
    copyright: "© {year} {brand}. All rights reserved.",
    background: colorBackground(""),
    textColor: "",
  },
  fab: {
    show: true,
    label: "Contact Us",
    icon: "chat",
    color: "",
    textColor: "",
    position: "right",
    showDesktop: true,
    showMobile: true,
    link: CONTACT_LINK,
  },
  infoPages: DEFAULT_INFO_PAGES,
};

/** A fresh custom band for the "Add section" button. */
export function newCustomSection(id: string): IlBand {
  return {
    id,
    show: true,
    title: "New section",
    description: "Describe what this section is about.",
    icon: "sparkle",
    imageUrl: "",
    button: { ...button("Learn more", NO_LINK), show: false },
    background: colorBackground(IL_PALETTE.lavender),
    textColor: "",
  };
}
