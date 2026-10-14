/**
 * Classic-home trust strip — the "why shop with us" row under the catalog
 * (The Peppy Lab's old site closed its home with Lab Verified · Premium
 * Quality · Real-World Tested). Reuses the owner's promises from
 * branding.config.boutique.assurances, so there is one place to edit them.
 *
 * Off unless Brand.showTrustStrip is true, so no existing classic store
 * changes. Icons are picked from the owner's own wording.
 *
 * Pure and client-safe. Covered by scripts/test-trust-strip.ts.
 */

import type { Brand } from "@/storefront/types";
import { normalizeAssurances } from "./boutique-home";

export type TrustIcon = "shield" | "sparkle" | "flask" | "truck" | "heart" | "check";

export type TrustStrip = {
  title: string;
  quote: string;
  items: { id: string; label: string; note?: string; icon: TrustIcon }[];
};

const DEFAULT_TITLE = "Why shop with us";
const TITLE_MAX = 80;
const QUOTE_MAX = 300;

const ICON_RULES: { icon: TrustIcon; re: RegExp }[] = [
  { icon: "shield", re: /lab|verif|purity|pure|certif|authentic|safe|coa/i },
  { icon: "flask", re: /test|research|science|clinic/i },
  { icon: "truck", re: /ship|deliver|courier|lalamove|nationwide|same.?day/i },
  { icon: "sparkle", re: /premium|quality|excellen|glow|best/i },
  { icon: "heart", re: /love|care|support|community|friendly/i },
];

export function trustIcon(label: string): TrustIcon {
  return ICON_RULES.find((r) => r.re.test(label))?.icon ?? "check";
}

type TrustSource = Pick<Brand, "showTrustStrip" | "trustStripTitle" | "trustStripQuote"> & {
  boutique?: { assurances?: unknown } | null;
};

/** The strip to render, or null when the store hasn't opted in or has nothing to say. */
export function buildTrustStrip(brand: TrustSource): TrustStrip | null {
  if (brand.showTrustStrip !== true) return null;
  // The label names the promise; its note only helps when the label is vague
  // ("Real-World Tested · Verified by our team" is a flask, not a shield).
  const items = normalizeAssurances(brand.boutique?.assurances).map((a) => {
    const fromLabel = trustIcon(a.label);
    return { ...a, icon: fromLabel === "check" && a.note ? trustIcon(a.note) : fromLabel };
  });
  if (!items.length) return null;
  return {
    title: (brand.trustStripTitle ?? "").trim().slice(0, TITLE_MAX) || DEFAULT_TITLE,
    quote: (brand.trustStripQuote ?? "").trim().slice(0, QUOTE_MAX),
    items,
  };
}
