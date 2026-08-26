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

// ── The edit's column count ──────────────────────────────────────────────────
// How many featured cards sit on a row. The band used to fit as many as the
// viewport allowed (auto-fit), which meant the same store looked like a
// two-product editorial pairing on one screen and a four-across shelf on
// another. Two-up suits big photography and few SKUs; three-up reads as a
// shelf. Only the operator knows which the store is, so the count is theirs to
// set and the template no longer guesses.
//
// Deliberately just those two: one card fills the band's full width at any
// sensible page measure, and four crushes the 4:5 photography this band exists
// to show. Below the rail's breakpoint the sheet overrides the choice anyway —
// the count is a wide-screen decision.

/** The counts an operator may choose. */
export const EDIT_COLUMNS = [2, 3] as const;

export type EditColumns = (typeof EDIT_COLUMNS)[number];

/** What every store that has never opened the control renders — the count the
 *  band already produced at a typical desktop width, so nothing shifts. */
export const EDIT_COLUMNS_DEFAULT: EditColumns = 3;

/** The editorial layout's own slice of branding.config. */
export type EditorialConfig = {
  editColumns?: EditColumns;
};

/**
 * Untrusted config → a count that is safe to write into CSS.
 *
 * This value lands in `repeat(N, …)`, so a junk one does not degrade — it drops
 * the entire band. Anything that is not exactly an offered count falls back to
 * the default rather than being clamped: a stored 12 is config drift, and
 * silently rendering 3 is honest where silently rendering 2 would be a guess.
 */
export function normalizeEditColumns(value: unknown): EditColumns {
  return (EDIT_COLUMNS as readonly number[]).includes(value as number)
    ? (value as EditColumns)
    : EDIT_COLUMNS_DEFAULT;
}

/** Untrusted config → a COMPLETE editorial slice, so every render path can read
 *  `.editColumns` without repeating the fallback. Never mutates the input. */
export function normalizeEditorialConfig(value: unknown): EditorialConfig {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return { editColumns: normalizeEditColumns(raw.editColumns) };
}

// ── The operator's picker ────────────────────────────────────────────────────
// The option LABELS live here rather than in the tweak panel so the strings the
// operator picks and the values the storefront stores can never drift apart.

/** The picker's own row label. */
export const EDIT_COLUMNS_LABEL = "Featured per row";

/** One option label per offered count, in offered order. */
export function editColumnsOption(columns: EditColumns): string {
  return `${columns} per row`;
}

export const EDIT_COLUMNS_OPTIONS: string[] = EDIT_COLUMNS.map(editColumnsOption);

/**
 * A picked option → the next editorial config. Returns a NEW object; an option
 * string it does not recognise leaves the stored count alone, because this
 * config is also written by the MCP connector and by hand, and a typo there
 * must not blank a band the operator deliberately set.
 */
export function setEditColumns(config: EditorialConfig | null | undefined, option: string): EditorialConfig {
  const picked = EDIT_COLUMNS.find((c) => editColumnsOption(c) === option);
  return picked === undefined
    ? { ...(config ?? {}) }
    : { ...(config ?? {}), editColumns: picked };
}

/** Which layouts have a featured band to lay out. Only the editorial home draws
 *  one, so offering the control anywhere else is a setting that does nothing. */
export function offersEditColumns(layout: string | null | undefined): boolean {
  return layout === "editorial";
}
