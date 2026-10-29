// Pure transcription of the MNM PEPSABUY supplier sheet
// ("MNM PRICE SHETT SITE.xlsx", sheet `Pricesheet`, Oct 2026) and the grouping
// that turns its rows into the storefront products
// scripts/seed-mnm-pricelist.ts writes.
//
// The sheet prints FOUR columns: Code | Product Name | Specification |
// Price / Vial. Specification is the supplier kit ("5mg*10vials"); the price is
// PER VIAL, which is how this group-buy-only store sells.
//
// Decisions (recorded so a re-transcription can be checked against them):
//
//   • ONE PRICE PER ROW. The sheet has no on-hand / group-buy split, and the
//     store hides on-hand (twoWaysMode.onHand "hidden"), so every option's
//     price and gbPrice are the same figure — a listing costs the sheet price
//     whether or not a round is live.
//
//   • Rows sharing a compound become ONE product with per-size variations,
//     cheapest first; the base price is the cheapest option. A single-option
//     family carries no variations and keeps its size in the product name, so
//     the card still says what is in the vial.
//
//   • The family split is CURATED, never parsed (see dragon-pricelist.ts for
//     why splitting on hyphens merges distinct molecules).
//
//   • Sheet spelling is cleaned for the shopper (Asetic → Acetic, Alcoh →
//     Alcohol, Whitout → Without, RelaxatlonPM → Relaxation PM …). The supplier
//     code of every option is kept below so a row can be traced back.
//
// Sheet quirks, interpreted (flagged to the owner):
//
//   • BB10 / BB20 print as "BPC5mg" / "BPC10mg" at 10mg / 20mg — read as the
//     BPC-157 + TB-500 blend (5mg + 5mg, 10mg + 10mg), the usual "BB" code.
//   • LC526 and LC600 are both "Lipo-C (FatBLaster)" 10ml at different prices;
//     they stay one product with the supplier code as the option label.
//   • XA30 prints "30mg*11vials" — every other kit is 10 vials, so 10 is used.
//   • HHB prints "10m*10vials" — read as 10ml.

import type { ProductClass } from "../../src/lib/storefront/product-class";
import { slugify } from "../../src/lib/storefront/product-mapping";

/** Vials per supplier kit, the same for every row on the sheet. */
export const VIALS_PER_KIT = 10;

export const MNM_CATEGORIES = [
  { id: "peptides", label: "Peptides" },
  { id: "blends", label: "Peptide Blends" },
  { id: "lipo", label: "Lipo & Wellness" },
  { id: "supplies", label: "Supplies" },
] as const;

export type MnmCategoryId = (typeof MNM_CATEGORIES)[number]["id"];

/** One printed row: supplier code, the option label, price per vial. */
export type MnmOption = { code: string; size: string; price: number };

export type MnmRow = {
  family: string;
  category: MnmCategoryId;
  productClass: ProductClass;
  featured?: boolean;
  /** What is in the vial, for blends. */
  note?: string;
  options: MnmOption[];
};

const opts = (list: [string, string, number][]): MnmOption[] =>
  list.map(([code, size, price]) => ({ code, size, price }));

const row = (
  family: string,
  category: MnmCategoryId,
  productClass: ProductClass,
  list: [string, string, number][],
  extra: Pick<MnmRow, "featured" | "note"> = {},
): MnmRow => ({ family, category, productClass, options: opts(list), ...extra });

/** The sheet, transcribed in sheet order. */
export const MNM_ROWS: MnmRow[] = [
  row("Pharma Grade Bac Water", "supplies", "bacWater", [["PH10", "10ml", 95]]),
  row("Acetic Acid Water 0.6%", "supplies", "bacWater", [["AA3", "3ml", 79]]),
  row("Benzyl Alcohol 0.9%", "supplies", "bacWater", [["BA3", "3ml", 79], ["BA5", "5ml", 92], ["BA10", "10ml", 94]]),

  row("Tirzepatide", "peptides", "peptide", [
    ["TR5", "5mg", 416], ["TR10", "10mg", 448], ["TR15", "15mg", 496], ["TR20", "20mg", 563.2],
    ["TR30", "30mg", 595], ["TR40", "40mg", 800], ["TR50", "50mg", 960], ["TR60", "60mg", 1078],
  ], { featured: true }),
  row("Retatrutide", "peptides", "peptide", [
    ["RT5", "5mg", 416], ["RT10", "10mg", 640], ["RT15", "15mg", 736], ["RT20", "20mg", 800],
    ["RT30", "30mg", 1100], ["RT40", "40mg", 1360], ["RT50", "50mg", 1476], ["RT60", "60mg", 1750],
  ], { featured: true }),
  row("Semaglutide", "peptides", "peptide", [["SM10", "10mg", 480], ["SM15", "15mg", 544], ["SM20", "20mg", 640], ["SM30", "30mg", 736]]),
  row("BPC-157", "peptides", "peptide", [["BC10", "10mg", 512], ["BC20", "20mg", 672]]),
  row("TB-500", "peptides", "peptide", [["TB5", "5mg", 646.4], ["TB10", "10mg", 953.6]]),
  row("BPC-157 + TB-500", "blends", "peptide", [["BB10", "10mg (5mg + 5mg)", 710.4], ["BB20", "20mg (10mg + 10mg)", 1132.8]], {
    note: "BPC-157 and TB-500 in equal parts, one vial.",
  }),
  row("GHK-Cu", "peptides", "peptide", [["CU50", "50mg", 352], ["CU100", "100mg", 480]], { featured: true }),
  row("NAD+", "peptides", "peptide", [["NJ100", "100mg", 480], ["NJ500", "500mg", 576], ["NJ1000", "1000mg", 864]]),
  row("Glutathione", "peptides", "peptide", [["GTT600", "600mg", 480], ["GT1500", "1500mg", 576]]),
  row("Tesamorelin", "peptides", "peptide", [["TSM5", "5mg", 736], ["TSM10", "10mg", 1120], ["TSM20", "20mg", 1980]]),
  row("GLOW Blend 70mg", "blends", "peptide", [["GLOW70", "70mg", 1184]], {
    note: "BPC-157 10mg + TB-500 10mg + GHK-Cu 50mg, one vial.",
  }),
  row("KLOW Blend 80mg", "blends", "peptide", [["KLOW80", "80mg", 1376]], {
    note: "KPV 10mg + BPC-157 10mg + TB-500 10mg + GHK-Cu 50mg, one vial.",
  }),
  row("KPV", "peptides", "peptide", [["KPV5", "5mg", 448], ["KPV10", "10mg", 512]]),
  row("PT-141 10mg", "peptides", "peptide", [["P41", "10mg", 524.8]]),
  row("DSIP", "peptides", "peptide", [["DS15", "15mg", 704], ["DS5", "5mg", 428.8]]),
  row("Oxytocin Acetate", "peptides", "peptide", [["OT2", "2mg", 428.8], ["OT5", "5mg", 518.4], ["OT10", "10mg", 550.4]]),
  row("Epithalon", "peptides", "peptide", [["ET10", "10mg", 544], ["ET50", "50mg", 992]]),
  row("SS-31", "peptides", "peptide", [["2S10", "10mg", 608], ["2S50", "50mg", 1804]]),
  row("CJC-1295 without DAC", "peptides", "peptide", [["CND5", "5mg", 640], ["CND10", "10mg", 1184]]),
  row("CJC-1295 without DAC + Ipamorelin 10mg", "blends", "peptide", [["CP10", "10mg", 768]], {
    note: "CJC-1295 without DAC 5mg + Ipamorelin 5mg, one vial.",
  }),
  row("CJC-1295 with DAC", "peptides", "peptide", [["CD5", "5mg", 928], ["CD10", "10mg", 1504]]),
  row("GHK-Cu + KPV", "blends", "peptide", [["CUV60", "60mg", 672], ["CUV110", "110mg", 736]], {
    note: "GHK-Cu and KPV in one vial.",
  }),
  row("AOD-9604", "peptides", "peptide", [["5AD", "5mg", 672], ["10AD", "10mg", 1056]]),
  row("Ipamorelin", "peptides", "peptide", [["IP5", "5mg", 416], ["IP10", "10mg", 672]]),
  row("Kisspeptin-10", "peptides", "peptide", [["KS5", "5mg", 537.6], ["KS10", "10mg", 736]]),
  row("Thymosin Alpha-1", "peptides", "peptide", [["TA5", "5mg", 704], ["TA10", "10mg", 1028]]),
  row("MOTS-c", "peptides", "peptide", [["MS10", "10mg", 550.4], ["MS40", "40mg", 1171.2]]),
  row("Melatonin 10mg", "peptides", "peptide", [["MT10", "10mg", 486.4]]),
  row("5-Amino-1MQ", "peptides", "peptide", [["5AM", "5mg", 499.2], ["50AM", "50mg", 736]]),
  row("SNAP-8 10mg", "peptides", "peptide", [["NP810", "10mg", 384]]),
  row("Cagrilintide + Semaglutide", "blends", "peptide", [["CS5", "5mg (2.5mg + 2.5mg)", 768], ["CS10", "10mg (5mg + 5mg)", 960]], {
    note: "Cagrilintide and Semaglutide in equal parts, one vial.",
  }),
  row("Selank", "peptides", "peptide", [["SK5", "5mg", 448], ["SK10", "10mg", 576]]),
  row("Semax", "peptides", "peptide", [["XA5", "5mg", 448], ["XA10", "10mg", 480], ["XA30", "30mg", 576]]),
  row("Cagrilintide", "peptides", "peptide", [["CGL5", "5mg", 736], ["CGL10", "10mg", 1120]]),
  row("VIP", "peptides", "peptide", [["VP5", "5mg", 640], ["VP10", "10mg", 800]]),
  row("Adamax 10mg", "peptides", "peptide", [["ADA10", "10mg", 1312]]),
  row("Lipo-C 10ml", "lipo", "other", [["LC120", "10ml", 480]]),
  row("Lipo-C with B12 10ml", "lipo", "other", [["LC216", "10ml", 480]]),
  row("Lipo-C FatBlaster 10ml", "lipo", "other", [["LC600", "LC600", 608], ["LC526", "LC526", 736]]),
  row("Lemon Bottle", "lipo", "other", [["LB10ML", "10ml", 550], ["LB50ML", "50ml", 997]]),
  row("HHB 10ml", "lipo", "other", [["HHB", "10ml", 736]]),
  row("SuperHuman Blend 10ml", "lipo", "other", [["SHB", "10ml", 736]]),
  row("Relaxation PM 10ml", "lipo", "other", [["RP226", "10ml", 736]]),
  row("Super Shred 10ml", "lipo", "other", [["Super Shred", "10ml", 736]]),
  row("Semax + Selank 20mg", "blends", "peptide", [["Semax + Selank", "20mg", 608]]),
];

export type MnmProduct = {
  name: string;
  sku: string;
  slug: string;
  category: MnmCategoryId;
  productClass: ProductClass;
  featured: boolean;
  description: string | null;
  /** Base (cheapest) price per vial, pesos. Also the base gbPrice. */
  price: number;
  /** Per-size options, cheapest first. EMPTY on a single-option family. */
  variations: { name: string; price: number; gbPrice: number }[];
  /** "5mg · 10mg · 60mg" — the printed sizes, for the product detail page. */
  sizes: string;
  /** The sheet's supplier codes, cheapest first. */
  codes: string[];
};

/** "MNM-" + uppercase alphanumerics of the family ("GHK-Cu + KPV" → "MNM-GHKCUKPV"). */
function skuOf(family: string): string {
  return `MNM-${family.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
}

/**
 * Group the transcribed sheet into storefront products. Throws if the
 * transcription breaks an invariant (duplicate code/SKU, non-positive price).
 */
export function buildMnmPricelistProducts(): MnmProduct[] {
  const codes = new Set<string>();
  const skus = new Set<string>();
  return MNM_ROWS.map((r) => {
    const options = [...r.options].sort((a, b) => a.price - b.price);
    for (const o of options) {
      if (codes.has(o.code)) throw new Error(`duplicate supplier code ${o.code}`);
      if (!(o.price > 0)) throw new Error(`${o.code} has no price`);
      codes.add(o.code);
    }
    const sku = skuOf(r.family);
    if (skus.has(sku)) throw new Error(`duplicate SKU ${sku}`);
    skus.add(sku);

    const multi = options.length > 1;
    return {
      name: r.family,
      sku,
      slug: slugify(r.family),
      category: r.category,
      productClass: r.productClass,
      featured: r.featured === true,
      description: r.note ?? null,
      price: options[0].price,
      variations: multi
        ? options.map((o) => ({ name: o.size, price: o.price, gbPrice: o.price }))
        : [],
      sizes: multi ? options.map((o) => o.size).join(" · ") : "",
      codes: options.map((o) => o.code),
    };
  });
}
