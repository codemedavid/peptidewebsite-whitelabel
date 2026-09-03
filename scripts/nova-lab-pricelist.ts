/**
 * Nova Lab retail pricelist — transcribed from the owner's "WEBSITE w/BAC SRP"
 * sheet. Single source of truth shared by the seeder
 * (scripts/seed-nova-lab-pricelist.ts) and the gate
 * (scripts/test-nova-lab-catalog.ts), so the catalog can never drift from the
 * sheet without the gate going red.
 *
 * The SRP column is "website with BAC water", i.e. every price already includes
 * the bacteriostatic water — that is why each description says so.
 *
 * Not transcribed: the sheet's final row (bacteriostatic water sold on its own)
 * is cut off in the supplied screenshot and its price is unreadable, so it is
 * deliberately omitted rather than guessed.
 */

export interface PricelistRow {
  /** Stable per-tenant slug — also the upsert key. */
  slug: string;
  /** Storefront card title. */
  name: string;
  /** PHP retail price, whole pesos, exactly as printed on the sheet. */
  price: number;
  /** Benefit phrase from the sheet's product name, "" when it printed none. */
  benefit: string;
  /** Extra clause appended before the BAC note (blend totals, etc.). */
  note?: string;
}

/** SEED_CATEGORIES id (not label) — the catalog chips filter on the id. */
export const NOVA_LAB_CATEGORY = "peptides";
export const NOVA_LAB_CURRENCY_SYMBOL = "₱";
/** Generic on-hand count so every priced item is buyable. */
export const NOVA_LAB_STOCK = 999;

export const NOVA_LAB_PRICELIST: PricelistRow[] = [
  { slug: "tirzepatide-15mg", name: "Tirzepatide 15mg", price: 3000, benefit: "Craving Control Formula" },
  { slug: "tirzepatide-20mg", name: "Tirzepatide 20mg", price: 4000, benefit: "Craving Control Formula" },
  { slug: "tirzepatide-30mg", name: "Tirzepatide 30mg", price: 5000, benefit: "Craving Control Formula" },
  { slug: "retatrutide-20mg", name: "Retatrutide 20mg", price: 5000, benefit: "Appetite Control" },
  { slug: "tesamorelin-10mg", name: "Tesamorelin 10mg", price: 4500, benefit: "Fat Reduction" },
  { slug: "ghk-cu-100mg", name: "GHK-Cu 100mg", price: 3000, benefit: "Skin Repair and Rejuvenation" },
  { slug: "bpc-157-10mg", name: "BPC-157 10mg", price: 3500, benefit: "Injury Recovery" },
  { slug: "nad-500mg", name: "NAD+ 500mg", price: 4500, benefit: "Cellular Energy" },
  { slug: "ipamorelin-10mg", name: "Ipamorelin 10mg", price: 4000, benefit: "" },
  { slug: "glutathione", name: "Glutathione", price: 3500, benefit: "Cellular Antioxidant Support" },
  { slug: "kisspeptin-10-10mg", name: "Kisspeptin-10 10mg", price: 3500, benefit: "Peak Hormonal Performance" },
  {
    slug: "bpc-5mg-tb-5mg",
    name: "BPC 5mg + TB 5mg",
    price: 4000,
    benefit: "Recovery Optimization",
    note: "10 mg total blend",
  },
  {
    slug: "cjc-1295-no-dac-5mg-ipa-5mg",
    name: "CJC-1295 no DAC 5mg + IPA 5mg",
    price: 3500,
    benefit: "Muscle Building and Recovery",
    note: "10 mg total blend",
  },
  { slug: "mots-c-20mg", name: "MOTS-C 20mg", price: 4000, benefit: "Energy Metabolism" },
  { slug: "semax-10mg", name: "Semax 10mg", price: 3500, benefit: "Focus and Clarity" },
];

/**
 * Pre-pricelist stubs whose dose the sheet supersedes. They keep their uploaded
 * photos but drop out of the storefront, so the catalog matches the sheet
 * without deleting anything the owner can still restore.
 */
export const NOVA_LAB_SUPERSEDED: string[] = ["tesamorelin-5mg", "mots-c-10mg"];

/** Card/detail copy: benefit phrase, optional note, then the BAC inclusion. */
export function pricelistDescription(row: PricelistRow): string {
  return [row.benefit, row.note, "Price includes bacteriostatic water"]
    .filter(Boolean)
    .join(". ") + ".";
}
