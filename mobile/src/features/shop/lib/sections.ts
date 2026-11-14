import type { ShopCatalog, ShopProduct } from "@shop-contract";
import { filterProducts } from "./catalog";

/**
 * The category-sections catalog as list rows (the website's
 * CategorySectionsCatalog): a header per section, then its products in pairs.
 * Sections and their order are the server's (ShopCatalog.sections); search
 * narrows each section the way the app's grid search does, and a section
 * left empty drops out. Pure.
 */

export type SectionRow =
  | { key: string; kind: "header"; sectionId: string; label: string; count: number }
  | { key: string; kind: "products"; sectionId: string; products: ShopProduct[] };

export type SectionNavItem = { id: string; label: string };

export function hasSections(catalog: Pick<ShopCatalog, "sections">): boolean {
  return Array.isArray(catalog.sections) && catalog.sections.length > 0;
}

export function sectionRows(
  catalog: Pick<ShopCatalog, "products" | "sections">,
  query: string,
  columns = 2,
): SectionRow[] {
  const byId = new Map(catalog.products.map((p) => [p.id, p]));
  const rows: SectionRow[] = [];
  for (const s of catalog.sections ?? []) {
    const listed = s.productIds.map((id) => byId.get(id)).filter((p): p is ShopProduct => !!p);
    const products = filterProducts(listed, query, "all");
    if (products.length === 0) continue;
    rows.push({ key: `h:${s.id}`, kind: "header", sectionId: s.id, label: s.label, count: products.length });
    for (let i = 0; i < products.length; i += columns) {
      rows.push({ key: `p:${s.id}:${i}`, kind: "products", sectionId: s.id, products: products.slice(i, i + columns) });
    }
  }
  return rows;
}

/** The tab bar: one entry per section still showing. */
export function sectionNav(rows: readonly SectionRow[]): SectionNavItem[] {
  return rows.flatMap((r) => (r.kind === "header" ? [{ id: r.sectionId, label: r.label }] : []));
}

/** Index of a section's header row, or -1. */
export function headerIndex(rows: readonly SectionRow[], sectionId: string): number {
  return rows.findIndex((r) => r.kind === "header" && r.sectionId === sectionId);
}

/** How many distinct products are showing (Featured repeats some — count each once). */
export function shownProductCount(rows: readonly SectionRow[]): number {
  const ids = new Set<string>();
  for (const r of rows) if (r.kind === "products") for (const p of r.products) ids.add(p.id);
  return ids.size;
}
