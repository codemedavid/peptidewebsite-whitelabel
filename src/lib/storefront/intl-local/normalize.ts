// Coerce an untrusted branding.config.intlLocal blob into a complete, safe
// IntlLocalConfig. Run on every READ (storefront-brand.ts) and on every SAVE
// (actions/intl-local.ts), so the renderer only ever sees the closed shape.
//
// Three rules:
//   • MISSING → default. A tenant on an older (or no) config gets the reference
//     defaults key by key, so adding a field later never blanks a live store.
//   • PRESENT → kept, even when empty. An owner who cleared a heading meant it;
//     an empty string hides that element rather than resurrecting sample copy.
//   • Built key by key, never spread from the input: unknown keys, unsafe
//     colours, unsafe image sources and unsafe links can't ride along.

import { safeImageSrc } from "../hero-media";
import { normalizeBackground, safeCssColor, type SectionBackground } from "../section-background";
import { normalizeLink, type IlLink } from "./links";
import {
  DEFAULT_INTL_LOCAL,
  IL_ART_BLENDS,
  IL_ART_SIZES,
  IL_BUTTON_STYLES,
  IL_ICONS,
  IL_LIMITS,
  IL_SECTION_KEYS,
  IL_SOCIAL_PLATFORMS,
  newCustomSection,
  type IlBand,
  type IlButton,
  type IlCard,
  type IlFab,
  type IlFooter,
  type IlHeader,
  type IlHero,
  type IlIcon,
  type IlInfoPage,
  type IlMarketCard,
  type IlNavChild,
  type IlNavItem,
  type IlNewsletter,
  type IlSocial,
  type IlTheme,
  type IlTopBar,
  type IntlLocalConfig,
} from "./config";
import { FONT_OPTIONS } from "@/lib/theme/tokens";

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}
function has(o: Obj, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}
function text(o: Obj, k: string, fallback: string, max: number = IL_LIMITS.short): string {
  if (!has(o, k)) return fallback;
  return typeof o[k] === "string" ? (o[k] as string).trim().slice(0, max) : fallback;
}
function bool(o: Obj, k: string, fallback: boolean): boolean {
  return typeof o[k] === "boolean" ? (o[k] as boolean) : fallback;
}
function oneOf<T extends string>(o: Obj, k: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(o[k] as string) ? (o[k] as T) : fallback;
}
function color(o: Obj, k: string, fallback: string): string {
  return has(o, k) ? safeCssColor(o[k]) : fallback;
}
function image(o: Obj, k: string, fallback: string): string {
  return safeImageSrc(has(o, k) ? o[k] : fallback);
}
function num(o: Obj, k: string, fallback: number, min: number, max: number): number {
  const n = Number(o[k]);
  return o[k] === undefined || o[k] === null || !Number.isFinite(n) ? fallback : Math.round(Math.min(max, Math.max(min, n)));
}
function icon(o: Obj, k: string, fallback: IlIcon): IlIcon {
  return oneOf(o, k, IL_ICONS, fallback);
}
function bg(o: Obj, k: string, fallback: SectionBackground): SectionBackground {
  return normalizeBackground(o[k], fallback);
}
function link(o: Obj, k: string, fallback: IlLink): IlLink {
  return has(o, k) ? normalizeLink(o[k], fallback) : { ...fallback };
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Normalize a list of id-carrying rows. Missing list → the defaults; a real
 * list is kept in the owner's order, capped, with each row's id made safe and
 * unique (a duplicate id would make two cards share one editor state). A row
 * whose id matches a default inherits that default as its fallback.
 */
function rows<T extends { id: string }>(
  input: unknown,
  defaults: T[],
  max: number,
  one: (o: Obj, fallback: T) => T,
  blank: (id: string) => T,
): T[] {
  if (!Array.isArray(input)) return defaults.map((d) => one({}, d));
  const seen = new Set<string>();
  const out: T[] = [];
  input.slice(0, max).forEach((raw, i) => {
    const o = obj(raw);
    let id = typeof o.id === "string" && ID_RE.test(o.id) ? o.id : `item-${i + 1}`;
    while (seen.has(id)) id = `${id}-${i + 1}`.slice(0, 40);
    seen.add(id);
    const fallback = defaults.find((d) => d.id === id) ?? blank(id);
    out.push({ ...one(o, fallback), id });
  });
  return out;
}

function normalizeButton(input: unknown, fallback: IlButton): IlButton {
  const o = obj(input);
  return {
    show: bool(o, "show", fallback.show),
    label: text(o, "label", fallback.label, IL_LIMITS.label),
    link: link(o, "link", fallback.link),
    style: oneOf(o, "style", IL_BUTTON_STYLES, fallback.style),
    color: color(o, "color", fallback.color),
    textColor: color(o, "textColor", fallback.textColor),
  };
}

function navChild(o: Obj, f: IlNavChild): IlNavChild {
  return { id: f.id, show: bool(o, "show", f.show), label: text(o, "label", f.label, IL_LIMITS.label), link: link(o, "link", f.link) };
}
const blankChild = (id: string): IlNavChild => ({ id, show: true, label: "New link", link: normalizeLink(null) });

function navItem(o: Obj, f: IlNavItem): IlNavItem {
  return {
    id: f.id,
    show: bool(o, "show", f.show),
    label: text(o, "label", f.label, IL_LIMITS.label),
    link: link(o, "link", f.link),
    children: rows(o.children, f.children, IL_LIMITS.navChildren, navChild, blankChild),
  };
}
const blankNav = (id: string): IlNavItem => ({ id, show: true, label: "New menu", link: normalizeLink(null), children: [] });

function theme(input: unknown): IlTheme {
  const o = obj(input);
  const d = DEFAULT_INTL_LOCAL.theme;
  const font = (k: "headingFont" | "bodyFont") =>
    has(o, k) && (o[k] === "" || FONT_OPTIONS.includes(o[k] as string)) ? (o[k] as string) : d[k];
  return {
    useBrandColors: bool(o, "useBrandColors", d.useBrandColors),
    pageBg: color(o, "pageBg", d.pageBg) || d.pageBg,
    surface: color(o, "surface", d.surface) || d.surface,
    ink: color(o, "ink", d.ink) || d.ink,
    muted: color(o, "muted", d.muted) || d.muted,
    accent: color(o, "accent", d.accent) || d.accent,
    accentText: color(o, "accentText", d.accentText) || d.accentText,
    radius: num(o, "radius", d.radius, 0, 40),
    headingFont: font("headingFont"),
    bodyFont: font("bodyFont"),
    headingWeight: Math.round(num(o, "headingWeight", d.headingWeight, 400, 900) / 100) * 100,
    scale: oneOf(o, "scale", ["sm", "md", "lg"] as const, d.scale),
    spacing: oneOf(o, "spacing", ["compact", "cozy", "roomy"] as const, d.spacing),
  };
}

function topBar(input: unknown): IlTopBar {
  const o = obj(input);
  const d = DEFAULT_INTL_LOCAL.topBar;
  return {
    show: bool(o, "show", d.show),
    text: text(o, "text", d.text, IL_LIMITS.long),
    subscribeLabel: text(o, "subscribeLabel", d.subscribeLabel, IL_LIMITS.label),
    showSocials: bool(o, "showSocials", d.showSocials),
    background: bg(o, "background", d.background),
    textColor: color(o, "textColor", d.textColor),
  };
}

function header(input: unknown): IlHeader {
  const o = obj(input);
  const d = DEFAULT_INTL_LOCAL.header;
  return {
    brandName: text(o, "brandName", d.brandName),
    showLogo: bool(o, "showLogo", d.showLogo),
    logoUrl: image(o, "logoUrl", d.logoUrl),
    logoHeight: num(o, "logoHeight", d.logoHeight, 24, 96),
    bgColor: color(o, "bgColor", d.bgColor),
    textColor: color(o, "textColor", d.textColor),
    showSearch: bool(o, "showSearch", d.showSearch),
    showCart: bool(o, "showCart", d.showCart),
    sticky: bool(o, "sticky", d.sticky),
  };
}

function hero(input: unknown): IlHero {
  const o = obj(input);
  const d = DEFAULT_INTL_LOCAL.hero;
  const btns = Array.isArray(o.buttons) ? o.buttons : d.buttons;
  return {
    show: bool(o, "show", d.show),
    eyebrow: text(o, "eyebrow", d.eyebrow),
    title: text(o, "title", d.title, IL_LIMITS.short * 2),
    description: text(o, "description", d.description, IL_LIMITS.long),
    align: oneOf(o, "align", ["left", "center"] as const, d.align),
    imageUrl: image(o, "imageUrl", d.imageUrl),
    mobileImageUrl: image(o, "mobileImageUrl", d.mobileImageUrl),
    imageAlt: text(o, "imageAlt", d.imageAlt, IL_LIMITS.long),
    imageSide: oneOf(o, "imageSide", ["right", "left", "none"] as const, d.imageSide),
    buttons: d.buttons.map((fb, i) => normalizeButton(btns[i], fb)).slice(0, IL_LIMITS.buttons),
    background: bg(o, "background", d.background),
    textColor: color(o, "textColor", d.textColor),
  };
}

function marketCard(o: Obj, f: IlMarketCard): IlMarketCard {
  return {
    id: f.id,
    show: bool(o, "show", f.show),
    eyebrow: text(o, "eyebrow", f.eyebrow),
    title: text(o, "title", f.title),
    currency: text(o, "currency", f.currency, 12),
    description: text(o, "description", f.description, IL_LIMITS.long),
    icon: icon(o, "icon", f.icon),
    imageUrl: image(o, "imageUrl", f.imageUrl),
    // Older saved cards have none of these → the defaults (blend, medium, 90%).
    imageBlend: oneOf(o, "imageBlend", IL_ART_BLENDS, f.imageBlend ?? "blend"),
    imageSize: oneOf(o, "imageSize", IL_ART_SIZES, f.imageSize ?? "md"),
    imageFocus: oneOf(o, "imageFocus", ["center", "top", "bottom", "left", "right"] as const, f.imageFocus ?? "center"),
    imageOpacity: num(o, "imageOpacity", f.imageOpacity ?? 90, 0, 100),
    button: normalizeButton(o.button, f.button),
    background: bg(o, "background", f.background),
    textColor: color(o, "textColor", f.textColor),
  };
}

function learnCard(o: Obj, f: IlCard): IlCard {
  return {
    id: f.id,
    show: bool(o, "show", f.show),
    title: text(o, "title", f.title),
    description: text(o, "description", f.description, IL_LIMITS.long),
    icon: icon(o, "icon", f.icon),
    imageUrl: image(o, "imageUrl", f.imageUrl),
    ctaLabel: text(o, "ctaLabel", f.ctaLabel, IL_LIMITS.label),
    link: link(o, "link", f.link),
    iconBg: color(o, "iconBg", f.iconBg),
    background: bg(o, "background", f.background),
    textColor: color(o, "textColor", f.textColor),
  };
}

function band(o: Obj, f: IlBand): IlBand {
  return {
    id: f.id,
    show: bool(o, "show", f.show),
    title: text(o, "title", f.title),
    description: text(o, "description", f.description, IL_LIMITS.long),
    icon: icon(o, "icon", f.icon),
    imageUrl: image(o, "imageUrl", f.imageUrl),
    button: normalizeButton(o.button, f.button),
    background: bg(o, "background", f.background),
    textColor: color(o, "textColor", f.textColor),
  };
}

function newsletter(input: unknown): IlNewsletter {
  const o = obj(input);
  const d = DEFAULT_INTL_LOCAL.newsletter;
  return {
    show: bool(o, "show", d.show),
    title: text(o, "title", d.title),
    description: text(o, "description", d.description, IL_LIMITS.long),
    icon: icon(o, "icon", d.icon),
    placeholder: text(o, "placeholder", d.placeholder, IL_LIMITS.label),
    buttonLabel: text(o, "buttonLabel", d.buttonLabel, IL_LIMITS.label) || d.buttonLabel,
    successMessage: text(o, "successMessage", d.successMessage, IL_LIMITS.long) || d.successMessage,
    background: bg(o, "background", d.background),
    textColor: color(o, "textColor", d.textColor),
  };
}

function social(o: Obj, f: IlSocial): IlSocial {
  return { id: f.id, platform: oneOf(o, "platform", IL_SOCIAL_PLATFORMS, f.platform), url: text(o, "url", f.url, 500) };
}

function footer(input: unknown): IlFooter {
  const o = obj(input);
  const d = DEFAULT_INTL_LOCAL.footer;
  return {
    show: bool(o, "show", d.show),
    brandName: text(o, "brandName", d.brandName),
    tagline: text(o, "tagline", d.tagline, IL_LIMITS.long),
    links: rows(o.links, d.links, IL_LIMITS.footerLinks, navChild, blankChild),
    useStoreSocials: bool(o, "useStoreSocials", d.useStoreSocials),
    socials: rows(o.socials, d.socials, IL_LIMITS.socials, social, (id) => ({ id, platform: "facebook", url: "" })),
    copyright: text(o, "copyright", d.copyright, IL_LIMITS.long),
    background: bg(o, "background", d.background),
    textColor: color(o, "textColor", d.textColor),
  };
}

function fab(input: unknown): IlFab {
  const o = obj(input);
  const d = DEFAULT_INTL_LOCAL.fab;
  return {
    show: bool(o, "show", d.show),
    label: text(o, "label", d.label, IL_LIMITS.label),
    icon: icon(o, "icon", d.icon),
    color: color(o, "color", d.color),
    textColor: color(o, "textColor", d.textColor),
    position: oneOf(o, "position", ["right", "left"] as const, d.position),
    showDesktop: bool(o, "showDesktop", d.showDesktop),
    showMobile: bool(o, "showMobile", d.showMobile),
    link: link(o, "link", d.link),
  };
}

function infoPage(o: Obj, f: IlInfoPage): IlInfoPage {
  return { id: f.id, title: text(o, "title", f.title), body: text(o, "body", f.body, IL_LIMITS.body) };
}

/**
 * The home section order: every built-in section exactly once (missing ones
 * appended, so a section added in a later release still shows up), plus each
 * existing custom section once. Unknown and dangling entries are dropped.
 */
export function normalizeOrder(input: unknown, customIds: string[]): string[] {
  const valid = new Set<string>([...IL_SECTION_KEYS, ...customIds.map((id) => `custom:${id}`)]);
  const out: string[] = [];
  for (const key of Array.isArray(input) ? input : []) {
    if (typeof key === "string" && valid.has(key) && !out.includes(key)) out.push(key);
  }
  for (const key of valid) if (!out.includes(key)) out.push(key);
  return out;
}

export function normalizeIntlLocalConfig(input: unknown): IntlLocalConfig {
  const o = obj(input);
  const d = DEFAULT_INTL_LOCAL;
  const markets = obj(o.markets);
  const learn = obj(o.learn);
  const customSections = rows(o.customSections, d.customSections, IL_LIMITS.customSections, band, newCustomSection);
  return {
    theme: theme(o.theme),
    topBar: topBar(o.topBar),
    header: header(o.header),
    nav: rows(o.nav, d.nav, IL_LIMITS.nav, navItem, blankNav),
    hero: hero(o.hero),
    markets: {
      show: bool(markets, "show", d.markets.show),
      title: text(markets, "title", d.markets.title),
      description: text(markets, "description", d.markets.description, IL_LIMITS.long),
      cards: rows(markets.cards, d.markets.cards, IL_LIMITS.markets, marketCard, (id) => ({
        ...d.markets.cards[0],
        id,
        title: "New market",
      })),
    },
    learn: {
      show: bool(learn, "show", d.learn.show),
      title: text(learn, "title", d.learn.title),
      description: text(learn, "description", d.learn.description, IL_LIMITS.long),
      cards: rows(learn.cards, d.learn.cards, IL_LIMITS.cards, learnCard, (id) => ({
        ...d.learn.cards[0],
        id,
        title: "New card",
      })),
    },
    community: band(obj(o.community), d.community),
    newsletter: newsletter(o.newsletter),
    customSections,
    order: normalizeOrder(o.order, customSections.map((s) => s.id)),
    footer: footer(o.footer),
    fab: fab(o.fab),
    infoPages: rows(o.infoPages, d.infoPages, IL_LIMITS.infoPages, infoPage, (id) => ({ id, title: "New page", body: "" })),
  };
}
