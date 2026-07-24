// Pure extraction of the K Glow handwritten "on-hand" price note (Jul 2026
// notebook image) and the grouping that turns its 11 lines into the 6 on-hand
// storefront products scripts/seed-kglow-onhand.ts writes. Extracted so the
// transcription can be verified without a database — see
// scripts/test-kglow-onhand.ts.
//
// On-hand vs. group-buy (confirmed with the owner):
//   • This note is READY STOCK ("on-hand"), the other half of K Glow's
//     two-ways-to-order split. On-hand products carry NO productType — only the
//     PasaBuy sheet products are tagged "gb" (see product-mapping.ts).
//   • On-hand prices are their own numbers, NOT edits to the group-buy sheet:
//     e.g. Tirzepatide 15mg is ₱3,200 on-hand vs ₱3,600 on the PasaBuy sheet,
//     60mg is ₱9,300 on-hand vs ₱8,800 on the sheet. Because they differ, these
//     are separate on-hand listings with their own SKUs/slugs (an "-OH" / "-on-
//     hand" suffix) so the seed can never overwrite the group-buy rows.
//
// Transcription of the note (owner-confirmed identities):
//   TR15 3200 · TR30 4900 · GH100 2880 · GHK50 2000    (Tirzepatide, GHK-CU)
//   BAC5 510 · BAC3 488 · BAC10 732                     (bacteriostatic water, ml)
//   TR60 9300 · KP10 1595 · 5AM 2800 · 5AD AOD 5100     (Tirzepatide, KPV,
//                                                        5-Amino-1MQ, AOD-9604)
//
// Packaging: the peptide codes mirror the PasaBuy sheet's 10-vial kits (the
// prices are per-kit, not per-vial), so their variations read "{size} × 10
// vials". Bacteriostatic water is sold per bottle, priced by volume (ml).

import { slugify } from "../../src/lib/storefront/product-mapping";
import type { ProductClass } from "../../src/lib/storefront/product-class";

/** Vials per peptide kit — every peptide code on the note is a 10-vial kit. */
export const VIALS_PER_KIT = 10;

/**
 * Starting stock for every seeded on-hand product. On-hand items are stock-gated
 * in the storefront (store.tsx: stock ≤ 0 → "out of stock", unpurchasable), so
 * they must seed with a positive quantity. This is a PLACEHOLDER the owner
 * adjusts per product in the store admin — the note carried prices, not counts.
 */
export const ONHAND_STOCK_DEFAULT = 10;

/** How a row is packaged/priced — a 10-vial peptide kit, or a bottle by volume. */
export type OnHandUnit = "kit" | "bottle";

export type OnHandRow = {
  /** The handwritten code, e.g. "TR15" / "GH100" / "5AD". */
  code: string;
  /** Resolved product name (owner-confirmed). */
  name: string;
  /** Vial strength ("15mg") or bottle volume ("5ml") as it should display. */
  size: string;
  /** Peso price for this line (authoritative). */
  peso: number;
  unit: OnHandUnit;
  productClass: ProductClass;
};

const kit = (code: string, name: string, size: string, peso: number, productClass: ProductClass = "peptide"): OnHandRow =>
  ({ code, name, size, peso, unit: "kit", productClass });

const bottle = (code: string, size: string, peso: number): OnHandRow =>
  ({ code, name: "Bacteriostatic Water", size, peso, unit: "bottle", productClass: "bacWater" });

export const ONHAND_ROWS: OnHandRow[] = [
  kit("TR15", "Tirzepatide", "15mg", 3200),
  kit("TR30", "Tirzepatide", "30mg", 4900),
  kit("TR60", "Tirzepatide", "60mg", 9300),
  kit("GH100", "GHK-CU", "100mg", 2880),
  kit("GHK50", "GHK-CU", "50mg", 2000),
  bottle("BAC3", "3ml", 488),
  bottle("BAC5", "5ml", 510),
  bottle("BAC10", "10ml", 732),
  kit("KP10", "KPV", "10mg", 1595),
  kit("5AM", "5-Amino-1MQ", "5mg", 2800, "other"), // small molecule, not a peptide
  kit("5AD", "AOD-9604", "5mg", 5100),
];

/** Variation label: peptides show the 10-vial kit; bac water shows the volume. */
function variationName(row: OnHandRow): string {
  return row.unit === "kit" ? `${row.size} × ${VIALS_PER_KIT} vials` : row.size;
}

/** One grouped on-hand storefront product, ready for the seed script's DB write. */
export type OnHandProduct = {
  name: string;
  sku: string;
  slug: string;
  /** Base price in pesos (major units) — the cheapest size. */
  price: number;
  /** Integer centavos of `price` (the DB column). */
  priceCents: number;
  currency: "PHP";
  currencySymbol: "₱";
  /** On-hand products are never group-buy — always undefined (absent). */
  productType?: undefined;
  productClass: ProductClass;
  /** Seed stock so the item is purchasable — owner-adjustable. */
  stock: number;
  /** One option per note line, in note order. */
  variations: { name: string; price: number }[];
  /** Comma list of sizes, e.g. "15mg, 30mg, 60mg" (metadata.sizes). */
  sizes: string;
  /** Handwritten codes covered, e.g. "TR15, TR30, TR60". */
  codes: string[];
  description: string;
};

/** Group the note's rows by product name into seedable on-hand product payloads. */
export function buildKglowOnHandProducts(): OnHandProduct[] {
  const groups = new Map<string, OnHandRow[]>();
  for (const r of ONHAND_ROWS) {
    groups.set(r.name, [...(groups.get(r.name) ?? []), r]);
  }

  return Array.from(groups.entries()).map(([name, rows]) => {
    const variations = rows.map((r) => ({ name: variationName(r), price: r.peso }));
    const price = Math.min(...variations.map((v) => v.price));
    const codes = rows.map((r) => r.code);
    const base = slugify(name);
    const isKit = rows[0].unit === "kit";
    return {
      name,
      // "-OH" / "-on-hand" suffix keeps these distinct from the group-buy
      // Tirzepatide / GHK-CU rows (unique on tenantId+sku and tenantId+slug).
      sku: `${base.toUpperCase().replace(/-/g, "")}-OH`,
      slug: `${base}-on-hand`,
      price,
      priceCents: Math.round(price * 100),
      currency: "PHP" as const,
      currencySymbol: "₱" as const,
      productType: undefined,
      productClass: rows[0].productClass,
      stock: ONHAND_STOCK_DEFAULT,
      variations,
      sizes: rows.map((r) => r.size).join(", "),
      codes,
      description:
        `Ready on-hand stock. ${isKit ? "Sold per kit of 10 vials." : "Sold per bottle."} ` +
        `Cat. ${codes.join(" / ")}.` +
        (rows.length > 1 ? ` Available in ${rows.length} sizes.` : ""),
    };
  });
}
