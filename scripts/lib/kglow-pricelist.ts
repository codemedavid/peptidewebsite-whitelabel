// Pure extraction of the K Glow "PasaBuy" pricelist sheet (Jul 2026 image) and
// the grouping that turns its 53 catalog rows into the 25 storefront products
// scripts/seed-kglow-products.ts writes. Extracted so the transcription can be
// verified without a database — see scripts/test-kglow-pricelist.ts.
//
// Decisions (confirmed with the owner):
//   • The PESO column is authoritative (the sheet's own FX wobbles around ₱62/$).
//   • Rows sharing a product name become ONE product with per-size variations.
//   • Everything is a group-buy ("gb") listing — this is the PasaBuy catalog.
//   • No gbPrice: the printed peso price IS the group-buy price, so a separate
//     "discount" leg would only invent a phantom saving.
//
// Sheet quirks preserved deliberately:
//   • IP5/IP10 print a blank product cell — inferred as Ipamorelin from the
//     catalog prefix.
//   • BT2's printed spec duplicates BT5 ("5mg*10vials") — transcribed as 2mg per
//     its catalog number, keeping the printed ₱4,216.
//   • Tirzepatide rows carry no FX and special peso pricing (TR15/TR30 are the
//     sheet's pink-highlighted promos).

import { slugify } from "../../src/lib/storefront/product-mapping";

/** The printed FX on every non-Tirzepatide row ("₱62.00"). */
export const FX_PESO_PER_USD = 62;

export type PricelistRow = {
  catNo: string;
  name: string;
  /** Vial strength as printed, e.g. "5mg" / "0.1mg". */
  size: string;
  /** Vials per kit — every row on the sheet is a 10-vial kit. */
  vials: number;
  /** PasaBuy USD price column. */
  usd: number;
  /** PESO column — authoritative for seeding. */
  peso: number;
  /** Whether the row prints the ₱62.00 FX (Tirzepatide rows do not). */
  hasFx: boolean;
};

const row = (
  catNo: string,
  name: string,
  size: string,
  usd: number,
  peso: number,
  hasFx = true,
): PricelistRow => ({ catNo, name, size, vials: 10, usd, peso, hasFx });

export const PRICELIST_ROWS: PricelistRow[] = [
  row("MT1", "MT-1", "10mg", 40, 2480),
  row("ML10", "MT-2 (Melanotan 2 Acetate)", "10mg", 61, 3782),
  row("P41", "PT-141", "10mg", 78, 4854.6),
  row("D5S", "DSIP", "5mg", 58, 3589.8),
  row("SK5", "Selank", "5mg", 58, 3589.8),
  row("SK10", "Selank", "10mg", 80, 4960),
  row("ET10", "Epithalon", "10mg", 77, 4774),
  row("ET50", "Epithalon", "50mg", 145, 8990),
  row("PIN10", "Pinealon", "10mg", 88, 5456),
  row("PIN20", "Pinealon", "20mg", 117, 7254),
  row("BC5", "BPC157", "5mg", 60, 3720),
  row("BC10", "BPC157", "10mg", 80, 4960),
  row("BB10", "BPC 5mg + TB 5mg", "10mg", 129, 7998),
  row("BB20", "BPC 10mg + TB 10mg", "20mg", 223, 13826),
  row("XA5", "Semax", "5mg", 49, 3038),
  row("XA10", "Semax", "10mg", 78, 4836),
  row("SM5", "Semaglutide", "5mg", 70, 4340),
  row("SM10", "Semaglutide", "10mg", 101, 6262),
  row("SM15", "Semaglutide", "15mg", 75, 4650),
  row("SM20", "Semaglutide", "20mg", 113, 7006),
  row("SM30", "Semaglutide", "30mg", 128, 7936),
  row("2S10", "SS-31", "10mg", 65, 4042.4),
  row("2S50", "SS-31", "50mg", 314, 19468),
  row("TR5", "Tirzepatide", "5mg", 43, 3000, false),
  row("TR10", "Tirzepatide", "10mg", 60, 3300, false),
  row("TR15", "Tirzepatide", "15mg", 73, 3600, false),
  row("TR20", "Tirzepatide", "20mg", 91, 4000, false),
  row("TR30", "Tirzepatide", "30mg", 117, 4900, false),
  row("TR40", "Tirzepatide", "40mg", 135, 6000, false),
  row("TR45", "Tirzepatide", "45mg", 150, 7000, false),
  row("TR50", "Tirzepatide", "50mg", 180, 7500, false),
  row("TR60", "Tirzepatide", "60mg", 195, 8800, false),
  row("CP10", "CJC-1295 without DAC 5mg + IPA 5mg", "10mg", 75, 4650),
  row("CND2", "CJC-1295 Without DAC", "2mg", 69, 4278),
  row("CND5", "CJC-1295 Without DAC", "5mg", 87, 5394),
  row("CND10", "CJC-1295 Without DAC", "10mg", 147, 9114),
  // BT2 prints "5mg*10vials" (duplicate of BT5) — 2mg per its catalog number.
  row("BT2", "TB500 (Thymosin B4 Acetate)", "2mg", 68, 4216),
  row("BT5", "TB500 (Thymosin B4 Acetate)", "5mg", 68, 4216),
  row("BT10", "TB500 (Thymosin B4 Acetate)", "10mg", 145, 8990),
  row("SMO5", "Sermorelin", "5mg", 75, 4650),
  row("SMO10", "Sermorelin", "10mg", 147, 9114),
  row("IG01", "IGF-1LR3", "0.1mg", 40, 2480),
  row("IG1", "IGF-1LR3", "1mg", 210, 13020),
  row("TSM5", "Tesamorelin", "5mg", 84, 5208),
  row("TSM10", "Tesamorelin", "10mg", 177, 10974),
  // Product cell blank on the sheet — Ipamorelin per the IP catalog prefix.
  row("IP5", "Ipamorelin", "5mg", 58, 3596),
  row("IP10", "Ipamorelin", "10mg", 98, 6076),
  row("CU50", "GHK-CU", "50mg", 40, 2480),
  row("CU100", "GHK-CU", "100mg", 55, 3410),
  row("AU100", "AHK-CU", "100mg", 80, 4960),
  row("KS5", "KissPeptin-10", "5mg", 52, 3224),
  row("KS10", "KissPeptin-10", "10mg", 78, 4836),
  row("TY10", "Thymalin", "10mg", 72, 4464),
];

/** One grouped storefront product, ready for the seed script's DB write. */
export type PricelistProduct = {
  name: string;
  sku: string;
  slug: string;
  /** Base price in pesos (major units) — the cheapest size. */
  price: number;
  /** Integer centavos of `price` (the DB column). */
  priceCents: number;
  currency: "PHP";
  currencySymbol: "₱";
  productType: "gb";
  /** Never set — the printed peso price is already the PasaBuy price. */
  gbPrice?: undefined;
  /** "size × 10 vials" option per sheet row, in sheet order. */
  variations: { name: string; price: number }[];
  /** Comma list of sizes, e.g. "5mg, 10mg" (metadata.sizes). */
  sizes: string;
  /** Catalog numbers covered, e.g. "SK5, SK10". */
  catNos: string[];
  description: string;
};

/** Group the sheet's rows by product name into seedable product payloads. */
export function buildKglowPricelistProducts(): PricelistProduct[] {
  const groups = new Map<string, PricelistRow[]>();
  for (const r of PRICELIST_ROWS) {
    groups.set(r.name, [...(groups.get(r.name) ?? []), r]);
  }

  return Array.from(groups.entries()).map(([name, rows]) => {
    const variations = rows.map((r) => ({
      name: `${r.size} × ${r.vials} vials`,
      price: r.peso,
    }));
    const price = Math.min(...variations.map((v) => v.price));
    const catNos = rows.map((r) => r.catNo);
    return {
      name,
      sku: slugify(name).toUpperCase().replace(/-/g, ""),
      slug: slugify(name),
      price,
      priceCents: Math.round(price * 100),
      currency: "PHP" as const,
      currencySymbol: "₱" as const,
      productType: "gb" as const,
      variations,
      sizes: rows.map((r) => r.size).join(", "),
      catNos,
      description:
        `Sold per kit of 10 vials (PasaBuy). Cat. ${catNos.join(" / ")}.` +
        (rows.length > 1 ? ` Available in ${rows.length} sizes.` : ""),
    };
  });
}
