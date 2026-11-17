// COPIED from src/lib/storefront/intl-local/normalize.ts and
// src/lib/storefront/section-background.ts (safeCssColor, normalizeBackground)
// — keep in sync; the server re-normalizes every save.
//
// Coerce the brand's intlLocal blob into a complete config. The web editor runs
// the draft through this before saving, so the app does the same: the saved
// baseline then matches what the server stores, and "Unsaved changes" is honest.
//
//   MISSING → default · PRESENT → kept, even when empty · built key by key.

import { heroMediaSrcIssue } from "../setup/rules";
import {
  BACKGROUND_POSITIONS,
  BACKGROUND_SIZES,
  BACKGROUND_TYPES,
  CUSTOM_SIZE_MAX,
  CUSTOM_SIZE_MIN,
  FONT_OPTIONS,
  IL_ART_BLENDS,
  IL_ART_SIZES,
  IL_BUTTON_STYLES,
  IL_FOCUSES,
  IL_ICONS,
  IL_LIMITS,
  IL_SECTION_KEYS,
  IL_SOCIAL_PLATFORMS,
  type IlBand,
  type IlButton,
  type IlCard,
  type IlIcon,
  type IlInfoPage,
  type IlMarketCard,
  type IlNavChild,
  type IlNavItem,
  type IlSocial,
  type IntlLocalConfig,
  type SectionBackground,
} from "./config";
import { DEFAULT_INTL_LOCAL, newCustomSection } from "./defaults";
import { normalizeLink, type IlLink } from "./links";

type Obj = Record<string, unknown>;

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\)|hsla?\(\s*[\d.\s,%deg]+\)|transparent)$/i;

/** A safe CSS colour value, or "" when the input is not one. */
export function safeCssColor(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s.length <= 64 && COLOR_RE.test(s) ? s : "";
}

/** hero-media safeImageSrc: an http(s) URL or a small data image, else "". */
export function safeImageSrc(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return s && !heroMediaSrcIssue(s) ? s : "";
}

const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const has = (o: Obj, k: string) => Object.prototype.hasOwnProperty.call(o, k);
function text(o: Obj, k: string, fallback: string, max: number = IL_LIMITS.short): string {
  if (!has(o, k)) return fallback;
  return typeof o[k] === "string" ? (o[k] as string).trim().slice(0, max) : fallback;
}
const bool = (o: Obj, k: string, fallback: boolean) => (typeof o[k] === "boolean" ? (o[k] as boolean) : fallback);
function oneOf<T extends string>(o: Obj, k: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(o[k] as string) ? (o[k] as T) : fallback;
}
const color = (o: Obj, k: string, fallback: string) => (has(o, k) ? safeCssColor(o[k]) : fallback);
const image = (o: Obj, k: string, fallback: string) => safeImageSrc(has(o, k) ? o[k] : fallback);
function num(o: Obj, k: string, fallback: number, min: number, max: number): number {
  const n = Number(o[k]);
  return o[k] === undefined || o[k] === null || !Number.isFinite(n) ? fallback : Math.round(Math.min(max, Math.max(min, n)));
}
const icon = (o: Obj, k: string, fallback: IlIcon) => oneOf(o, k, IL_ICONS, fallback);
const link = (o: Obj, k: string, fallback: IlLink) => (has(o, k) ? normalizeLink(o[k], fallback) : { ...fallback });

function pct(raw: unknown, fallback: number, min = 0, max = 100): number {
  const n = Number(raw);
  if (raw === null || raw === "" || raw === undefined || !Number.isFinite(n)) return fallback;
  return Math.round(Math.min(max, Math.max(min, n)));
}

export function normalizeBackground(input: unknown, fallback: SectionBackground): SectionBackground {
  const o = obj(input);
  return {
    type: oneOf(o, "type", BACKGROUND_TYPES, fallback.type),
    color: has(o, "color") ? safeCssColor(o.color) : fallback.color,
    imageUrl: safeImageSrc(has(o, "imageUrl") ? o.imageUrl : fallback.imageUrl),
    imageOpacity: pct(o.imageOpacity, fallback.imageOpacity),
    position: oneOf(o, "position", BACKGROUND_POSITIONS, fallback.position),
    size: oneOf(o, "size", BACKGROUND_SIZES, fallback.size),
    customSize: pct(o.customSize, fallback.customSize, CUSTOM_SIZE_MIN, CUSTOM_SIZE_MAX),
    overlayColor: has(o, "overlayColor") ? safeCssColor(o.overlayColor) : fallback.overlayColor,
    overlayOpacity: pct(o.overlayOpacity, fallback.overlayOpacity),
  };
}
const bg = (o: Obj, k: string, fallback: SectionBackground) => normalizeBackground(o[k], fallback);

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function rows<T extends { id: string }>(input: unknown, defaults: T[], max: number, one: (o: Obj, f: T) => T, blank: (id: string) => T): T[] {
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

function normalizeButton(input: unknown, f: IlButton): IlButton {
  const o = obj(input);
  return {
    show: bool(o, "show", f.show),
    label: text(o, "label", f.label, IL_LIMITS.label),
    link: link(o, "link", f.link),
    style: oneOf(o, "style", IL_BUTTON_STYLES, f.style),
    color: color(o, "color", f.color),
    textColor: color(o, "textColor", f.textColor),
  };
}

const navChild = (o: Obj, f: IlNavChild): IlNavChild => ({
  id: f.id,
  show: bool(o, "show", f.show),
  label: text(o, "label", f.label, IL_LIMITS.label),
  link: link(o, "link", f.link),
});
const blankChild = (id: string): IlNavChild => ({ id, show: true, label: "New link", link: normalizeLink(null) });

const navItem = (o: Obj, f: IlNavItem): IlNavItem => ({
  id: f.id,
  show: bool(o, "show", f.show),
  label: text(o, "label", f.label, IL_LIMITS.label),
  link: link(o, "link", f.link),
  children: rows(o.children, f.children, IL_LIMITS.navChildren, navChild, blankChild),
});
const blankNav = (id: string): IlNavItem => ({ id, show: true, label: "New menu", link: normalizeLink(null), children: [] });

function theme(input: unknown): IntlLocalConfig["theme"] {
  const o = obj(input);
  const d = DEFAULT_INTL_LOCAL.theme;
  const font = (k: "headingFont" | "bodyFont") => (has(o, k) && (o[k] === "" || FONT_OPTIONS.includes(o[k] as string)) ? (o[k] as string) : d[k]);
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

function hero(input: unknown): IntlLocalConfig["hero"] {
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

const marketCard = (o: Obj, f: IlMarketCard): IlMarketCard => ({
  id: f.id,
  show: bool(o, "show", f.show),
  eyebrow: text(o, "eyebrow", f.eyebrow),
  title: text(o, "title", f.title),
  currency: text(o, "currency", f.currency, 12),
  description: text(o, "description", f.description, IL_LIMITS.long),
  icon: icon(o, "icon", f.icon),
  imageUrl: image(o, "imageUrl", f.imageUrl),
  imageBlend: oneOf(o, "imageBlend", IL_ART_BLENDS, f.imageBlend ?? "blend"),
  imageSize: oneOf(o, "imageSize", IL_ART_SIZES, f.imageSize ?? "md"),
  imageFocus: oneOf(o, "imageFocus", IL_FOCUSES, f.imageFocus ?? "center"),
  imageOpacity: num(o, "imageOpacity", f.imageOpacity ?? 90, 0, 100),
  button: normalizeButton(o.button, f.button),
  background: bg(o, "background", f.background),
  textColor: color(o, "textColor", f.textColor),
});

const learnCard = (o: Obj, f: IlCard): IlCard => ({
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
});

const band = (o: Obj, f: IlBand): IlBand => ({
  id: f.id,
  show: bool(o, "show", f.show),
  title: text(o, "title", f.title),
  description: text(o, "description", f.description, IL_LIMITS.long),
  icon: icon(o, "icon", f.icon),
  imageUrl: image(o, "imageUrl", f.imageUrl),
  button: normalizeButton(o.button, f.button),
  background: bg(o, "background", f.background),
  textColor: color(o, "textColor", f.textColor),
});

function newsletter(input: unknown): IntlLocalConfig["newsletter"] {
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

const social = (o: Obj, f: IlSocial): IlSocial => ({ id: f.id, platform: oneOf(o, "platform", IL_SOCIAL_PLATFORMS, f.platform), url: text(o, "url", f.url, 500) });

function footer(input: unknown): IntlLocalConfig["footer"] {
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

function fab(input: unknown): IntlLocalConfig["fab"] {
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

const infoPage = (o: Obj, f: IlInfoPage): IlInfoPage => ({ id: f.id, title: text(o, "title", f.title), body: text(o, "body", f.body, IL_LIMITS.body) });

/** Every built-in section once (missing ones appended) plus each custom section once. */
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
  const topBar = obj(o.topBar);
  const header = obj(o.header);
  const customSections = rows(o.customSections, d.customSections, IL_LIMITS.customSections, band, newCustomSection);
  return {
    theme: theme(o.theme),
    topBar: {
      show: bool(topBar, "show", d.topBar.show),
      text: text(topBar, "text", d.topBar.text, IL_LIMITS.long),
      subscribeLabel: text(topBar, "subscribeLabel", d.topBar.subscribeLabel, IL_LIMITS.label),
      showSocials: bool(topBar, "showSocials", d.topBar.showSocials),
      background: bg(topBar, "background", d.topBar.background),
      textColor: color(topBar, "textColor", d.topBar.textColor),
    },
    header: {
      brandName: text(header, "brandName", d.header.brandName),
      showLogo: bool(header, "showLogo", d.header.showLogo),
      logoUrl: image(header, "logoUrl", d.header.logoUrl),
      logoHeight: num(header, "logoHeight", d.header.logoHeight, 24, 96),
      bgColor: color(header, "bgColor", d.header.bgColor),
      textColor: color(header, "textColor", d.header.textColor),
      showSearch: bool(header, "showSearch", d.header.showSearch),
      showCart: bool(header, "showCart", d.header.showCart),
      sticky: bool(header, "sticky", d.header.sticky),
    },
    nav: rows(o.nav, d.nav, IL_LIMITS.nav, navItem, blankNav),
    hero: hero(o.hero),
    markets: {
      show: bool(markets, "show", d.markets.show),
      title: text(markets, "title", d.markets.title),
      description: text(markets, "description", d.markets.description, IL_LIMITS.long),
      cards: rows(markets.cards, d.markets.cards, IL_LIMITS.markets, marketCard, (id) => ({ ...d.markets.cards[0], id, title: "New market" })),
    },
    learn: {
      show: bool(learn, "show", d.learn.show),
      title: text(learn, "title", d.learn.title),
      description: text(learn, "description", d.learn.description, IL_LIMITS.long),
      cards: rows(learn.cards, d.learn.cards, IL_LIMITS.cards, learnCard, (id) => ({ ...d.learn.cards[0], id, title: "New card" })),
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

// ── list helpers (site-builder/fields.tsx) ─────────────────────────────────
export function moveItem<T>(arr: readonly T[], from: number, dir: -1 | 1): T[] {
  const to = from + dir;
  if (to < 0 || to >= arr.length) return [...arr];
  const next = [...arr];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
export const replaceAt = <T,>(arr: readonly T[], i: number, item: T): T[] => arr.map((x, j) => (j === i ? item : x));
export const removeAt = <T,>(arr: readonly T[], i: number): T[] => arr.filter((_, j) => j !== i);

/** A fresh id not already used in `existing`. */
export function newId(prefix: string, existing: readonly { id: string }[]): string {
  const used = new Set(existing.map((e) => e.id));
  let n = existing.length + 1;
  while (used.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}
