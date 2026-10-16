// Member tags (Admin, Verified reseller): the store's chosen look turned into
// colours that stay readable — on white rows and on the coloured profile band.
// Pure — npx tsx mobile/scripts/test-tag-look.ts

import type { CommunityTagDesign, CommunityTagIcon, CommunityTagRole, CommunityTagShape, CommunityTagStyle, CommunityTags } from "@contract";
import { mix, parseHex } from "./color";

/** Mirrors the server's DEFAULT_COMMUNITY_TAGS (contract.ts) for servers that don't send tags yet. */
export const DEFAULT_TAGS: CommunityTags = {
  admin: { label: "Admin", icon: "star", color: null, style: "soft", shape: "pill" },
  reseller: { label: "Verified reseller", icon: "shield-checkmark", color: null, style: "soft", shape: "pill" },
};

export const TAG_ROLES: readonly CommunityTagRole[] = ["admin", "reseller"];
export const TAG_LABEL_MAX = 20;
export const TAG_ICONS: readonly CommunityTagIcon[] = [
  "star", "shield-checkmark", "checkmark-circle", "ribbon", "medal", "trophy", "diamond",
  "sparkles", "flash", "flame", "heart", "leaf", "rocket", "pricetag",
];
export const TAG_STYLES: readonly { value: CommunityTagStyle; label: string }[] = [
  { value: "soft", label: "Soft" },
  { value: "solid", label: "Solid" },
  { value: "outline", label: "Outline" },
];
export const TAG_SHAPES: readonly { value: CommunityTagShape; label: string }[] = [
  { value: "pill", label: "Pill" },
  { value: "rounded", label: "Rounded" },
  { value: "square", label: "Square" },
];
/** Hand-picked swatches; null = the store's own colour. Each holds 4.5:1 with white text when solid. */
export const TAG_SWATCHES: readonly { value: string | null; name: string }[] = [
  { value: null, name: "Store colour" },
  { value: "#7C3AED", name: "Violet" },
  { value: "#48307A", name: "Plum" },
  { value: "#BE185D", name: "Raspberry" },
  { value: "#C2410C", name: "Ember" },
  { value: "#A16207", name: "Gold" },
  { value: "#047857", name: "Emerald" },
  { value: "#0F766E", name: "Teal" },
  { value: "#1D4ED8", name: "Cobalt" },
  { value: "#334155", name: "Slate" },
  { value: "#111827", name: "Onyx" },
];

/** Roles this person carries, in display order. */
export function rolesOf(flags: { isAdmin?: boolean; isVerifiedReseller?: boolean }): CommunityTagRole[] {
  return TAG_ROLES.filter((r) => (r === "admin" ? flags.isAdmin === true : flags.isVerifiedReseller === true));
}

const INK = "#0F1115";
const WHITE = "#FFFFFF";

function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0;
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/** WCAG contrast ratio between two opaque colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White or ink — whichever reads better on `bg`. */
export function readableInk(bg: string): string {
  return contrast(WHITE, bg) >= contrast(INK, bg) ? WHITE : INK;
}

/** `color`, darkened just enough to hold `min`:1 on `bg` (text on a tint or on white). */
export function inkOn(color: string, bg: string, min = 4.5): string {
  for (let t = 0; t <= 1.0001; t += 0.1) {
    const c = mix(color, INK, t);
    if (contrast(c, bg) >= min) return c;
  }
  return INK;
}

const RADIUS: Record<CommunityTagShape, number> = { pill: 999, rounded: 7, square: 3 };

export type TagSurface = "light" | "brand";
export type TagLook = { bg: string; fg: string; border: string; borderWidth: number; radius: number };

/**
 * Colours for one tag. `brand` is the store colour (used when the tag has none,
 * and as the band behind `surface: "brand"`).
 */
export function tagLook(design: CommunityTagDesign, brand: string, surface: TagSurface = "light"): TagLook {
  const color = design.color ?? brand;
  const radius = RADIUS[design.shape];
  if (surface === "brand") {
    // A solid tag in the band's own colour would vanish — only that one flips to a white chip;
    // any other colour keeps its fill, edged in white so it lifts off the band.
    const sameAsBand = design.color === null || design.color.toUpperCase() === brand.toUpperCase();
    if (design.style === "solid" && !sameAsBand) return { bg: color, fg: readableInk(color), border: "rgba(255,255,255,0.9)", borderWidth: 1.5, radius };
    if (design.style === "outline") return { bg: "rgba(255,255,255,0.14)", fg: WHITE, border: "rgba(255,255,255,0.8)", borderWidth: 1.5, radius };
    return { bg: WHITE, fg: inkOn(color, WHITE), border: WHITE, borderWidth: 0, radius };
  }
  if (design.style === "solid") return { bg: color, fg: readableInk(color), border: color, borderWidth: 0, radius };
  if (design.style === "outline") {
    const edge = inkOn(color, WHITE, 3);
    return { bg: "transparent", fg: inkOn(color, WHITE), border: edge, borderWidth: 1.25, radius };
  }
  const tint = mix(color, WHITE, 0.86);
  return { bg: tint, fg: inkOn(color, tint), border: tint, borderWidth: 0, radius };
}

// ── the editor's draft ───────────────────────────────────────────────────────

/** "7c3aed", "#7C3AED", " #7c3aed " → "#7C3AED"; null until it's a full colour. */
export function hexFromInput(text: string): string | null {
  const raw = text.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(raw) ? `#${raw.toUpperCase()}` : null;
}

/** What stops this tag from saving, in words; null when it's fine. */
export function tagProblem(design: CommunityTagDesign): string | null {
  const label = design.label.trim();
  if (!label) return "Give the tag a name.";
  if (label.length > TAG_LABEL_MAX) return `Keep the name to ${TAG_LABEL_MAX} characters.`;
  return null;
}

const sameDesign = (a: CommunityTagDesign, b: CommunityTagDesign) =>
  a.label.trim() === b.label && a.icon === b.icon && a.color === b.color && a.style === b.style && a.shape === b.shape;

/** Only the tags that differ from what's saved, labels trimmed — the PATCH body. */
export function changedTags(draft: CommunityTags, saved: CommunityTags): Partial<CommunityTags> {
  return Object.fromEntries(
    TAG_ROLES.filter((r) => !sameDesign(draft[r], saved[r])).map((r) => [r, { ...draft[r], label: draft[r].label.trim() }]),
  );
}

/** Whether `color` is one of the swatches (else the editor shows it as Custom). */
export function isSwatch(color: string | null): boolean {
  return TAG_SWATCHES.some((s) => s.value === color);
}
