// BOUTIQUE home layout — the imagery-led, category-first storefront shape
// (reference: cherieandco.ph). A REUSABLE TEMPLATE, not a tenant's design: it
// owns no business name, no palette, no copy, no products and no categories of
// its own. Every section is composed from data the tenant already has, and any
// section whose data is empty simply isn't rendered.
//
// The two things it needs that no other surface computes:
//
//   • buildCategoryTiles — the "shop by category" row. Counts and a
//     representative photo are DERIVED from the tenant's own catalog, so a
//     store that has never opened a settings screen still gets real tiles.
//   • normalizeAssurances — the trust strip under the grid ("Guaranteed
//     Authentic" on the reference site). Deliberately owner-typed and
//     empty-by-default: shipping a default line would put words in every
//     tenant's mouth, and a peptide store, a bakery and a boutique do not make
//     the same promises.
//
// Pure + JSON-safe (no React, no DB, no Next runtime), so the server page, the
// client render and the operator live preview all resolve the same answer.
// Covered by npm run test:boutique-home.

import type { Category, Product } from "@/storefront/types";
import { ALL_CATEGORY_ID } from "./categories";

/** Every selectable home layout, in display order. Single source of truth: the
 *  store-admin picker, the branding.config allow-list and resolveHomeLayout
 *  (./two-ways-home) all validate against this list. */
export const HOME_LAYOUTS = ["classic", "two-ways", "boutique"] as const;

export type HomeLayout = (typeof HOME_LAYOUTS)[number];

/** True only for the exact stored value — the picker writes it verbatim. */
export function isBoutiqueLayout(value: unknown): boolean {
  return value === "boutique";
}

// ── Category tiles ───────────────────────────────────────────────────────────

/** One "shop by category" tile: the owner's category, what's actually in it,
 *  and a photo to lead with. */
export type CategoryTile = {
  id: string;
  label: string;
  /** How many of the passed products sit in this category. Always ≥ 1 — a
   *  category with nothing in it never becomes a tile. */
  count: number;
  /** A representative photo, or null when there is genuinely none (the tile
   *  then renders its monogram). Never a stock/placeholder URL. */
  image: string | null;
  /** First letter of the label, for the imageless monogram tile. */
  initial: string;
};

/**
 * Build the discovery tiles from the tenant's own catalog.
 *
 * Rules, all of them chosen so the row can never lie or dead-end:
 *   • the synthetic "all" filter tab is not a shelf, so it is never a tile;
 *   • a category with zero products is dropped — a tile advertising an empty
 *     shelf is a dead end, and the reference site shows only stocked ones;
 *   • the photo is the first product in the category that has one, then the
 *     brand's default product image, then null (the caller draws a monogram);
 *   • the owner's category ORDER is preserved — this row is their merchandising.
 *
 * `products` should already be filtered to what the shopper may see (the
 * catalog does this); counts then match the grid below. Inputs are never
 * mutated. Malformed rows in the untrusted config are skipped, not thrown on.
 */
export function buildCategoryTiles(
  products: readonly Product[] | null | undefined,
  categories: readonly Category[] | null | undefined,
  defaultProductImage?: string | null,
): CategoryTile[] {
  const list = products ?? [];
  const tiles: CategoryTile[] = [];

  for (const category of categories ?? []) {
    if (!category || typeof category.id !== "string") continue;
    const id = category.id.trim();
    if (!id || id === ALL_CATEGORY_ID) continue;

    const members = list.filter((p) => p?.category === id);
    if (members.length === 0) continue;

    // A category may be saved without a label; its id is the only honest
    // fallback, and it is what the catalog filter chip would show too.
    const label = (category.label ?? "").trim() || id;

    tiles.push({
      id,
      label,
      count: members.length,
      image: members.find((p) => !!p.image)?.image || defaultProductImage || null,
      initial: label.charAt(0).toUpperCase(),
    });
  }

  return tiles;
}

// ── Assurance strip ──────────────────────────────────────────────────────────

/** Bounds on the strip. It is a STRIP — a short row of promises under the
 *  grid — so it is capped rather than allowed to grow into a second catalog,
 *  and each entry's copy is truncated so one long line can't break the row. */
export const ASSURANCE_MAX = 6;
export const ASSURANCE_LABEL_MAX = 60;
export const ASSURANCE_NOTE_MAX = 120;

/** One owner-typed promise, e.g. "Guaranteed authentic" + an optional note. */
export type BoutiqueAssurance = {
  /** Stable key for React lists and for the admin editor's row identity. */
  id: string;
  label: string;
  /** Optional supporting line. Absent (not "") when the owner left it blank. */
  note?: string;
};

/** The boutique layout's own slice of branding.config. Everything else the
 *  layout renders comes from config that already existed. */
export type BoutiqueConfig = {
  assurances?: BoutiqueAssurance[];
};

function trimTo(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Untrusted branding.config → the assurance strip. Fails closed to an EMPTY
 * list at every turn: a non-array, a row that isn't an object, a blank label.
 * Empty means the section is not rendered at all — which is the default for
 * every tenant, because this template ships no promises of its own.
 */
export function normalizeAssurances(value: unknown): BoutiqueAssurance[] {
  if (!Array.isArray(value)) return [];

  const out: BoutiqueAssurance[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const entry = row as Record<string, unknown>;

    const label = trimTo(entry.label, ASSURANCE_LABEL_MAX);
    if (!label) continue;

    const note = trimTo(entry.note, ASSURANCE_NOTE_MAX);
    const id = trimTo(entry.id, 64) || `assurance-${out.length + 1}`;

    out.push(note ? { id, label, note } : { id, label });
    if (out.length >= ASSURANCE_MAX) break;
  }
  return out;
}

/** Untrusted branding.config.boutique → a safe, fully-normalized config. */
export function normalizeBoutiqueConfig(value: unknown): BoutiqueConfig {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return { assurances: normalizeAssurances(raw.assurances) };
}
