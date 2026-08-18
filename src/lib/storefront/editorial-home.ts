// EDITORIAL layout — the left-rail, type-led storefront shape (reference
// design: "SKN Storefront"). A REUSABLE TEMPLATE, not a tenant's design: it owns
// no business name, no palette, no copy, no products and no categories. Every
// section is composed from data the tenant already has, and any section whose
// data is empty simply isn't rendered.
//
// What distinguishes it from the boutique layout is the DISCOVERY MODEL. Where
// boutique shows a grid of photographic tiles, editorial sets the tenant's
// categories as a typographic index — one full-width line each, the name in
// display type with its live count opposite, hairline-ruled. It reads as a
// contents page rather than a shop window, which is what carries a catalog with
// many shelves (and a store whose products aren't all photographed) without
// looking sparse.
//
// The two things it needs that no other surface computes:
//
//   • buildCategoryIndex — the index rows. Labels and counts DERIVED from the
//     tenant's own catalog, so a store that has never opened a settings screen
//     still gets a real index and no row can advertise an empty shelf.
//   • buildEditRow — the inverted "edit" band under the index. It is the
//     owner's own `featured` flag, capped; a store with nothing featured gets
//     no band at all rather than a filler selection this template chose.
//
// The trust/notices strip and the contact strip are deliberately NOT new: they
// read the same owner-typed assurances and contact channels the boutique layout
// uses, so an owner who set them up once keeps them when they switch layout.
//
// Pure + JSON-safe (no React, no DB, no Next runtime), so the server page, the
// client render and the operator live preview all resolve the same answer.
// Covered by npm run test:editorial-home.

import type { Category, Product } from "@/storefront/types";
import { ALL_CATEGORY_ID } from "./categories";

// ── Page composition ─────────────────────────────────────────────────────────

/** The two screens the editorial layout owns. */
export type EditorialView = "home" | "catalog";

export type EditorialSection =
  | "hero"
  | "index"
  | "edit"
  | "assurances"
  | "contact"
  | "chips"
  | "catalog";

/** The home ends at DISCOVERY — hero, the category index, the owner's featured
 *  edit, their assurances, contact. Deliberately no product grid: on this layout
 *  the shopper picks a shelf from the index (or searches from the rail) and the
 *  grid is the next screen. Putting the grid back here would collapse that
 *  two-step flow and leave the classic layout wearing a nicer sidebar. */
const HOME_SECTIONS: readonly EditorialSection[] = [
  "hero",
  "index",
  "edit",
  "assurances",
  "contact",
];

/** The catalog screen is the grid, and none of the home's discovery furniture —
 *  arriving here means the shopper has already chosen. It does lead with the
 *  category CHIPS, because arriving from an index row means a filter is already
 *  applied: without them the shopper faces a narrowed grid with no sign of which
 *  shelf they are on and no route back to the rest of the catalog. */
const CATALOG_SECTIONS: readonly EditorialSection[] = ["chips", "catalog", "contact"];

/** Which sections an editorial view renders, in order. Sections still self-hide
 *  when their data is empty; this only fixes the composition. */
export function editorialSections(view: EditorialView): EditorialSection[] {
  return [...(view === "catalog" ? CATALOG_SECTIONS : HOME_SECTIONS)];
}

// ── The category index ───────────────────────────────────────────────────────

/** One line of the index: the owner's category and what's actually in it. */
export type IndexRow = {
  id: string;
  label: string;
  /** How many of the passed products sit in this category. Always ≥ 1 — a
   *  category with nothing in it never becomes a row. */
  count: number;
};

/**
 * Build the index from the tenant's own catalog.
 *
 * Rules, all chosen so the index can never lie or dead-end:
 *   • the synthetic "all" filter tab is not a shelf, so it is never a row;
 *   • a category with zero products is dropped — a line advertising an empty
 *     shelf is a dead end;
 *   • the owner's category ORDER is preserved: this index is their merchandising.
 *
 * `products` should already be filtered to what the shopper may see (the caller
 * does this); counts then match the grid the row opens. Inputs are never
 * mutated, and malformed rows in the untrusted config are skipped, not thrown on.
 */
export function buildCategoryIndex(
  products: readonly Product[] | null | undefined,
  categories: readonly Category[] | null | undefined,
): IndexRow[] {
  const list = products ?? [];
  const rows: IndexRow[] = [];

  for (const category of categories ?? []) {
    if (!category || typeof category.id !== "string") continue;
    const id = category.id.trim();
    if (!id || id === ALL_CATEGORY_ID) continue;

    const count = list.filter((p) => p?.category === id).length;
    if (count === 0) continue;

    // A category may be saved without a label; its id is the only honest
    // fallback, and it is what the catalog filter chip would show too.
    rows.push({ id, label: (category.label ?? "").trim() || id, count });
  }

  return rows;
}

// ── The edit ─────────────────────────────────────────────────────────────────

/** How many products the inverted band shows. It is a BAND — an editor's pick,
 *  not a shelf — so it is capped rather than allowed to grow into a second
 *  catalog. */
export const EDIT_MAX = 4;

/**
 * The owner's featured products, capped.
 *
 * Uses the SAME `featured` flag that already pins a product to the top of the
 * catalog, so the owner curates the band from the product editor they know and
 * there is no second list to keep in sync. A store that has featured nothing
 * gets an EMPTY array — the band then isn't rendered at all, which is right: a
 * template that quietly promoted "the first four products" would be choosing
 * merchandising on the tenant's behalf.
 *
 * A non-positive or non-finite `max` is config drift, not an instruction to
 * empty the band, so it falls back to EDIT_MAX. The input list is never mutated.
 */
export function buildEditRow(
  products: readonly Product[] | null | undefined,
  max: number = EDIT_MAX,
): Product[] {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : EDIT_MAX;
  return (products ?? []).filter((p) => p?.featured === true).slice(0, limit);
}
