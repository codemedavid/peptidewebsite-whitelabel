// Pure extraction of the Dragon Peptides supplier sheet
// ("dragon peptides Product List.xlsx", sheet `Prod_List`, Aug 2026) and the
// grouping that turns its rows into the storefront products
// scripts/seed-dragon-products.ts writes. Extracted so the transcription can be
// verified without a database — see scripts/test-dragon-pricelist.ts.
//
// The sheet prints FOUR columns: PRODUCT NAME | PRODUCT CODE | GB PRICE |
// ONHAND PRICE. Two prices per row is the whole point of this catalog, and it
// maps exactly onto the storefront's two-ways model:
//
//   ONHAND PRICE -> product.price   (the list price, what a stocked item costs)
//   GB PRICE     -> product.gbPrice (what it costs inside a live buying window)
//
// Decisions (recorded so a re-transcription can be checked against them):
//
//   • ON-HAND IS ALWAYS GB + 200. Verified across all 175 printed rows, zero
//     exceptions — including the cheap ones, where the flat +₱200 is a large
//     multiple (Pharma bac 1pc is ₱60 GB / ₱260 on-hand). That is the owner's
//     pricing rule, not a transcription slip, so the test asserts it on every
//     row rather than "fixing" the outliers.
//
//   • Rows sharing a base compound become ONE product with per-size variations,
//     each variation carrying BOTH legs (price + gbPrice). Before variations
//     could hold their own gbPrice this grouping was impossible — every size
//     would have been billed the base size's group price.
//
//   • The family/size split is CURATED, not parsed. Peptide names contain
//     hyphens, so splitting on the last "-" merges distinct molecules: it puts
//     BPC-157 and BPC-157+TB-500 in one product, and GHRP-2 with GHRP-6. Each
//     family below is stated explicitly for that reason.
//
//   • The base price is the CHEAPEST option, and options are ordered cheapest
//     first, so the card leads with the entry price. A single-option family
//     carries no variations at all — it is just a product with two prices.
//
// Sheet quirks preserved deliberately:
//
//   • Three duplicate rows are dropped: BPC-157 5mg and 10mg are each printed
//     twice with rounding drift (263.04 vs 263, 387.2 vs 387 — the more precise
//     figure is kept), and BPC-157 + TB500 BB20mg is printed twice identically.
//   • Section headers ("AURORA", "HXTNT", "JITAI", "GTT & SERUMS") and blank
//     spacer rows carry no price and are not products.
//   • The seven rows after the sheet's blank spacer (LipoVela, Pharma bac,
//     SUPER SHRED) print under no header; they are filed under GTT & Serums
//     per the owner.
//   • Float noise in the sheet (582.79999999999995, 258.89999999999998) is
//     rounded to 2dp at transcription — prices are stored as integer centavos.

import type { ProductClass } from "../../src/lib/storefront/product-class";
import { slugify } from "../../src/lib/storefront/product-mapping";

/** The flat peso spread the sheet applies to every row: on-hand = GB + 200. */
export const ONHAND_MINUS_GB = 200;

/** One sellable option: the size as printed, and its two prices in pesos. */
export type DragonOption = {
  /** "" on a single-option family — the product has no size choice. */
  size: string;
  /** GB PRICE column — what the option costs inside a live round. */
  gb: number;
  /** ONHAND PRICE column — the list price. Always `gb + ONHAND_MINUS_GB`. */
  onhand: number;
};

/** One curated product family and every option printed under it. */
export type DragonRow = {
  /** The sheet's brand section, used as the storefront category. */
  section: string;
  /** The storefront product name. */
  family: string;
  /** Order Ratio Control classification. */
  productClass: ProductClass;
  /** Cheapest option first. */
  options: DragonOption[];
};

const row = (
  section: string,
  family: string,
  productClass: ProductClass,
  options: [string, number, number][],
): DragonRow => ({
  section,
  family,
  productClass,
  options: options.map(([size, gb, onhand]) => ({ size, gb, onhand })),
});

/** The sheet, transcribed. 88 families over 172 unique rows. */
export const DRAGON_ROWS: DragonRow[] = [
  row("AURORA", "AU KLOW", "peptide", [["", 1190, 1390]]),
  row("AURORA", "AU GHK-Cu", "peptide", [["50mg", 334, 534], ["100mg", 434, 634]]),
  row("AURORA", "AU MOTS-C", "peptide", [["", 1264, 1464]]),
  row("AURORA", "AU RETA", "peptide", [["5mg", 430, 630], ["10mg", 638, 838], ["20mg", 1122, 1322], ["30mg", 1469, 1669], ["60mg", 2430, 2630]]),
  row("AURORA", "AU TR", "peptide", [["10mg", 365, 565], ["15mg", 460, 660], ["30mg", 640, 840], ["60mg", 1190, 1390]]),
  row("HXTNT", "HXTNT Bacteriostatic Water", "bacWater", [["3ml", 46.5, 246.5], ["5ml", 58.9, 258.9], ["10ml", 71.3, 271.3]]),
  row("HXTNT", "HXTNT BPC-157", "peptide", [["5mg", 263.04, 463.04], ["10mg", 387.2, 587.2]]),
  row("HXTNT", "HXTNT BPC-157 + TB-500", "peptide", [["5mg + 5mg", 489.6, 689.6], ["10mg + 10mg", 923.52, 1123.52], ["BB20", 930, 1130]]),
  row("HXTNT", "HXTNT Cardiogen", "peptide", [["20mg", 682, 882]]),
  row("HXTNT", "HXTNT Cartalax", "peptide", [["20mg", 682, 882]]),
  row("HXTNT", "HXTNT Cerebrolysin", "peptide", [["60mg", 310, 510]]),
  row("HXTNT", "HXTNT CJC-1295 w/o DAC + Ipamorelin", "peptide", [["5mg + 5mg", 496, 696]]),
  row("HXTNT", "HXTNT CJC-1295 with DAC", "peptide", [["5mg", 862, 1062]]),
  row("HXTNT", "HXTNT CJC-1295 Without DAC", "peptide", [["5mg", 446.08, 646.08], ["10mg", 818.56, 1018.56]]),
  row("HXTNT", "HXTNT Dsip", "peptide", [["5mg", 223, 423], ["10mg", 378, 578], ["15mg", 485, 685]]),
  row("HXTNT", "HXTNT Epithalon", "peptide", [["10mg", 325, 525], ["50mg", 765, 965]]),
  row("HXTNT", "HXTNT Fox04", "peptide", [["10mg", 1395, 1595]]),
  row("HXTNT", "HXTNT GHK-Cu", "peptide", [["50mg", 222, 422], ["100mg", 303, 503]]),
  row("HXTNT", "HXTNT GHRP-2 Acetate", "peptide", [["5mg", 211, 411], ["10mg", 310, 510]]),
  row("HXTNT", "HXTNT GHRP-6 Acetate", "peptide", [["5mg", 241, 441], ["10mg", 310, 510]]),
  row("HXTNT", "HXTNT Glow", "other", [["70mg", 1035, 1235]]),
  row("HXTNT", "HXTNT Hexarelin Acetate", "peptide", [["5mg", 427, 627]]),
  row("HXTNT", "HXTNT HGH 191-176", "peptide", [["5mg", 471, 671]]),
  row("HXTNT", "HXTNT HMG 75IU", "peptide", [["", 334, 534]]),
  row("HXTNT", "HXTNT Humanin", "peptide", [["10mg", 948, 1148]]),
  row("HXTNT", "HXTNT Ipamorelin", "peptide", [["5mg", 272, 472], ["10mg", 396, 596]]),
  row("HXTNT", "HXTNT Kisspeptin", "peptide", [["5mg", 273, 473], ["10mg", 458, 658]]),
  row("HXTNT", "HXTNT KPV", "peptide", [["5mg", 247, 447], ["10mg", 325, 525]]),
  row("HXTNT", "HXTNT L-Carnitine 600mg (LC600)*", "other", [["", 303, 503]]),
  row("HXTNT", "HXTNT Lemon Bottle China", "other", [["10ml", 366, 566], ["50ml", 850, 1050]]),
  row("HXTNT", "HXTNT Lemon Bottle KR OEM*", "other", [["", 3200, 3400]]),
  row("HXTNT", "HXTNT LIPO-C with B12 (LC216)*", "other", [["", 500, 700]]),
  row("HXTNT", "HXTNT Lipo-C*", "other", [["", 520, 720]]),
  row("HXTNT", "HXTNT Livagen", "peptide", [["20mg", 6820, 7020]]),
  row("HXTNT", "HXTNT LL37", "peptide", [["5mg", 427, 627]]),
  row("HXTNT", "HXTNT Mazdutide", "peptide", [["5mg", 806, 1006], ["10mg", 1426, 1626]]),
  row("HXTNT", "HXTNT Melanotan I", "peptide", [["10mg", 272.64, 472.64]]),
  row("HXTNT", "HXTNT Melanotan II", "peptide", [["10mg", 272.64, 472.64]]),
  row("HXTNT", "HXTNT Mots-C", "peptide", [["10mg", 334, 534], ["40mg", 954, 1154]]),
  row("HXTNT", "HXTNT NA Selank Amidate", "peptide", [["", 800, 1000]]),
  row("HXTNT", "HXTNT NAD+", "peptide", [["100mg", 334, 534], ["500mg", 458, 658], ["1000mg", 644, 844]]),
  row("HXTNT", "HXTNT Oxytocin", "peptide", [["5mg", 261, 461], ["10mg", 347, 547]]),
  row("HXTNT", "HXTNT PE 22-88", "peptide", [["10mg", 403, 603]]),
  row("HXTNT", "HXTNT Pinealon", "peptide", [["10mg", 291, 491], ["20mg", 427, 627]]),
  row("HXTNT", "HXTNT PNC 27", "peptide", [["5mg", 707, 907], ["10mg", 1264, 1464], ["20mg", 1884, 2084]]),
  row("HXTNT", "HXTNT PT-141", "peptide", [["10mg", 334, 534]]),
  row("HXTNT", "HXTNT Selank", "peptide", [["5mg", 255, 455], ["10mg", 365, 565]]),
  row("HXTNT", "HXTNT Semaglutide", "peptide", [["5mg", 241, 441], ["10mg", 365, 565], ["15mg", 396, 596], ["20mg", 458, 658], ["30mg", 583, 783]]),
  row("HXTNT", "HXTNT Semax", "peptide", [["5mg", 254, 454], ["10mg", 365, 565]]),
  row("HXTNT", "HXTNT Semax + Selank", "peptide", [["10mg", 400, 600], ["20mg", 550, 750]]),
  row("HXTNT", "HXTNT Sermorelin", "peptide", [["5mg", 427, 627], ["10mg", 768, 968]]),
  row("HXTNT", "HXTNT SHB", "other", [["10ml", 526, 726]]),
  row("HXTNT", "HXTNT SLU-PP-322", "peptide", [["5mg", 613, 813]]),
  row("HXTNT", "HXTNT Snap 8", "peptide", [["10mg", 272, 472]]),
  row("HXTNT", "HXTNT SS-31", "peptide", [["10mg", 427, 627], ["50mg", 1698, 1898]]),
  row("HXTNT", "HXTNT Surovodutine", "peptide", [["10mg", 1171, 1371]]),
  row("HXTNT", "HXTNT TB-500", "peptide", [["5mg", 446, 646], ["10mg", 768, 968]]),
  row("HXTNT", "HXTNT Tesamorelin", "peptide", [["5mg", 551, 751], ["10mg", 954, 1154]]),
  row("HXTNT", "HXTNT Thymalin", "peptide", [["10mg", 365, 565]]),
  row("HXTNT", "HXTNT Thymosin Alpha", "peptide", [["5mg", 489, 689], ["10mg", 892, 1092]]),
  row("HXTNT", "HXTNT VIP10", "peptide", [["", 768, 968]]),
  row("HXTNT", "HXTNT 5-Amino-1MQ", "peptide", [["5mg", 274.57, 474.57], ["50mg", 582.8, 782.8]]),
  row("HXTNT", "HXTNT Adamax", "peptide", [["5mg", 800, 1000], ["10mg", 1178, 1378]]),
  row("HXTNT", "HXTNT AHK-Cu", "peptide", [["100mg", 375, 575]]),
  row("HXTNT", "HXTNT AICAR", "peptide", [["50mg", 458, 658], ["100mg", 620, 820]]),
  row("HXTNT", "HXTNT AOD-9604", "peptide", [["5mg", 560, 760], ["10mg", 990, 1190]]),
  row("HXTNT", "HXTNT ARA-290", "peptide", [["10mg", 311, 511]]),
  row("HXTNT", "HXTNT BPC-157 + TB500 - BB10", "peptide", [["", 496, 696]]),
  row("HXTNT", "HXTNT FATBLASTER - (LC526)*", "other", [["", 645, 845]]),
  row("HXTNT", "HXTNT HHB", "other", [["10ml", 526, 726]]),
  row("HXTNT", "HXTNT IGF-1 LR3", "peptide", [["0.1mg", 241.92, 441.92], ["1mg", 1078.4, 1278.4]]),
  row("HXTNT", "HXTNT Reta", "peptide", [["5mg", 365, 565], ["10mg", 550, 750], ["15mg", 620, 820], ["20mg", 775, 975], ["30mg", 989, 1189], ["40mg", 1240, 1440], ["50mg", 1450, 1650], ["60mg", 1704, 1904]]),
  row("HXTNT", "HXTNT TR", "peptide", [["5mg", 280, 480], ["10mg", 324, 524], ["15mg", 385, 585], ["20mg", 458, 658], ["30mg", 550, 750], ["40mg", 699, 899], ["50mg", 850, 1050], ["60mg", 997, 1197]]),
  row("JITAI", "JITAI GHKCU+KPV10", "peptide", [["", 650, 850]]),
  row("JITAI", "JITAI ADAMAX", "peptide", [["10mg", 620, 820]]),
  row("JITAI", "JITAI Cagrilintide", "peptide", [["5mg", 563, 763], ["10mg", 917, 1117]]),
  row("JITAI", "JITAI KPV", "peptide", [["30mg", 713, 913]]),
  row("JITAI", "JITAI Reta", "peptide", [["10mg", 465, 665], ["20mg", 744, 944]]),
  row("JITAI", "JITAI TESAMORELIN", "peptide", [["20mg", 1395, 1595]]),
  row("JITAI", "JITAI TR", "peptide", [["5mg", 260, 460], ["10mg", 300, 500], ["15mg", 397, 597], ["20mg", 480, 680], ["30mg", 583, 783], ["60mg", 1178, 1378]]),
  row("GTT & Serums", "Ghk8", "other", [["15mg", 350, 550], ["30ml", 480, 680]]),
  row("GTT & Serums", "Glutathione 1500mg (Fuan)", "other", [["Half kit", 1600, 1800], ["1 kit", 3100, 3300]]),
  row("GTT & Serums", "GlutatOne Inj. 1200", "other", [["1 Vial", 300, 500], ["Half Kit", 1400, 1600], ["1 kit", 2700, 2900]]),
  row("GTT & Serums", "Rejuran Original Korea (MOQ 10 kits)", "other", [["Rejuran S", 5000, 5200], ["Rejuran i", 5000, 5200], ["Rejuran HB", 5000, 5200], ["Rejuran Healer", 6500, 6700]]),
  row("GTT & Serums", "Skin Boosters", "other", [["SG03 Collagen", 280, 480], ["SG04 Pink Hyaluronic Acid Essence", 280, 480], ["SG02 PDRN Skinbooster", 310, 510], ["SG01 Whitening & Spot Fading", 341, 541]]),
  row("GTT & Serums", "LipoVela", "other", [["1 Vial", 300, 500], ["Half Kit", 1400, 1600], ["1 Kit", 2500, 2700]]),
  row("GTT & Serums", "Pharma Bacteriostatic Water 10ml", "bacWater", [["1pc", 60, 260], ["50pcs", 2800, 3000], ["100pcs", 5500, 5700]]),
  row("GTT & Serums", "SUPER SHRED - (LC553)*", "other", [["", 645, 845]]),];

/** One grouped storefront product, ready for the seed script's DB write. */
export type DragonProduct = {
  name: string;
  sku: string;
  slug: string;
  category: string;
  productClass: ProductClass;
  /** Base (cheapest) on-hand price in pesos. */
  price: number;
  /** Integer centavos of `price` — the DB column. */
  priceCents: number;
  /** Base (cheapest) group-buy price in pesos. */
  gbPrice: number;
  currency: "PHP";
  currencySymbol: "₱";
  productType: "gb";
  /** Per-size options, cheapest first. EMPTY on a single-option family. */
  variations: { name: string; price: number; gbPrice: number }[];
  /** "5mg · 10mg · 60mg" — the printed sizes, for the product detail page. */
  sizes: string;
};

/** Uppercase alphanumeric SKU from a family name ("HXTNT GHK-Cu" -> "HXTNTGHKCU"). */
function skuOf(family: string): string {
  return family.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Group the transcribed sheet into storefront products.
 *
 * A family with ONE option becomes a plain two-price product (no variations to
 * pick between). A family with several becomes one product whose base price is
 * the cheapest option, with every option — including that cheapest one — listed
 * as a variation carrying both its price and its own gbPrice.
 *
 * The cheapest option is repeated as a variation on purpose: buildProductOptions
 * (lib/storefront/variations.ts) drops its synthetic "Standard" entry when a
 * named variation already carries the base price, so the picker shows real size
 * labels instead of a nameless "Standard" the shopper can't interpret.
 */
export function buildDragonPricelistProducts(): DragonProduct[] {
  const taken = new Set<string>();
  return DRAGON_ROWS.map((r) => {
    const options = [...r.options].sort((a, b) => a.onhand - b.onhand);
    const base = options[0];

    let sku = skuOf(r.family);
    for (let n = 2; taken.has(sku); n++) sku = `${skuOf(r.family)}${n}`;
    taken.add(sku);

    const multi = options.length > 1;
    return {
      name: r.family,
      sku,
      slug: slugify(r.family),
      category: r.section,
      productClass: r.productClass,
      price: base.onhand,
      priceCents: Math.round(base.onhand * 100),
      gbPrice: base.gb,
      currency: "PHP" as const,
      currencySymbol: "₱" as const,
      productType: "gb" as const,
      variations: multi
        ? options.map((o) => ({ name: o.size, price: o.onhand, gbPrice: o.gb }))
        : [],
      sizes: multi ? options.map((o) => o.size).join(" · ") : "",
    };
  });
}
