/**
 * Raw Glow Wellness pricelist — transcribed from the owner's "Raw Glow -
 * Pricelist" Google Sheet (rows 2–106, four screenshots, 2026-10-22).
 * Single source of truth for scripts/seed-raw-glow-pricelist.ts.
 *
 * The sheet's price column is "Vial & Bac only Price": the price covers the
 * vial plus bacteriostatic water, which is why vial products say so in their
 * description.
 *
 * Names are kept as the sheet prints them. Five were cut off by the phone's
 * column width and are completed here: rows 11 (CJC/IPA blend), 67 (Glutaone
 * box), 97 (basic set), 100 (pen needles) and 101 (vial opener colours) — the
 * last three match the names the owner had already entered as drafts.
 */

export interface RawGlowRow {
  name: string;
  /** PHP, whole pesos, exactly as printed. */
  price: number;
  /** Category id from RAW_GLOW_CATEGORIES. */
  category: RawGlowCategoryId;
}

export const RAW_GLOW_TENANT_SLUG = "raw-glow-wellness";
export const RAW_GLOW_CURRENCY_SYMBOL = "₱";
/** Generic on-hand count so every listed item is buyable (owner edits later). */
export const RAW_GLOW_STOCK = 999;

/** The owner's own throwaway sample products, removed by the seeder. */
export const RAW_GLOW_SAMPLE_SLUGS = [
  "dewdrop-hydrating-serum",
  "lilac-glow-vitamin-c-moisturizer",
  "cloud-soft-gentle-cleanser",
  "petal-kiss-lip-treatment",
  "silk-veil-daily-sunscreen",
];

export const RAW_GLOW_CATEGORIES = [
  { id: "weight", label: "Weight Management" },
  { id: "peptides", label: "Peptides & Wellness" },
  { id: "beauty", label: "Beauty Peptides" },
  { id: "aesthetics", label: "Aesthetics" },
  { id: "bac-water", label: "Bac Water" },
  { id: "pens", label: "Pens & Accessories" },
  { id: "skincare", label: "Skincare" },
] as const;

export type RawGlowCategoryId = (typeof RAW_GLOW_CATEGORIES)[number]["id"];

/** Categories whose items are sold as a vial with bac water. */
export const VIAL_CATEGORIES: ReadonlySet<RawGlowCategoryId> = new Set([
  "weight",
  "peptides",
  "beauty",
]);

const W = "weight";
const P = "peptides";
const B = "beauty";
const A = "aesthetics";

export const RAW_GLOW_PRICELIST: RawGlowRow[] = [
  { name: "Tirzepatide 15mg", price: 1100, category: W },
  { name: "Tirzepatide 30mg", price: 1800, category: W },
  { name: "Tirzepatide 60mg", price: 2500, category: W },
  { name: "Retatrutide 10mg", price: 1300, category: W },
  { name: "Retatrutide 15mg", price: 1600, category: W },
  { name: "Retatrutide 20mg", price: 1900, category: W },
  { name: "Retatrutide 30mg", price: 2200, category: W },
  { name: "Epithalon 50mg", price: 1800, category: P },
  { name: "BPC 157 10mg", price: 1100, category: P },
  { name: "CJC 1295 without DAC 5mg + IPA 5mg", price: 1800, category: P },
  { name: "Tesamorelin 10mg", price: 1800, category: P },
  { name: "Tesamorelin 20mg - AM", price: 3000, category: P },
  { name: "5-amino-1mq-50mg", price: 1800, category: W },
  { name: "GHK-Cu 50mg", price: 800, category: B },
  { name: "GHK-Cu 100mg", price: 1000, category: B },
  { name: "GTT Fuan", price: 1100, category: P },
  { name: "Mots-C 10mg", price: 1200, category: P },
  { name: "Mots-C 40mg", price: 2300, category: P },
  { name: "Cagrilinitide 5mg", price: 1500, category: W },
  { name: "Cagrilinitide 10mg", price: 1800, category: W },
  { name: "Nad+ 500mg", price: 1100, category: P },
  { name: "Nad+ 1000mg", price: 1600, category: P },
  { name: "KLOW", price: 2200, category: P },
  { name: "FOXO4", price: 2800, category: P },
  { name: "TB500 10mg", price: 1500, category: P },
  { name: "PT-141", price: 1000, category: P },
  { name: "SS-31 10mg", price: 1200, category: P },
  { name: "SS-31 50mg", price: 2800, category: P },
  { name: "KPV 10mg", price: 1100, category: P },
  { name: "ARA-290 10mg", price: 1100, category: P },
  { name: "Thymosin Alpha-1 5mg", price: 1500, category: P },
  { name: "Fat Blaster (LC525)", price: 1100, category: W },
  { name: "Super Shred (LC553)", price: 1200, category: W },
  { name: "Healthy Hair, Skin, Nails Blend", price: 1100, category: B },
  { name: "Super Human Blend", price: 1200, category: P },
  { name: "Relaxation PM Blend", price: 1100, category: P },
  { name: "L-Carnitine 600MG", price: 750, category: W },
  { name: "GHK+KPV 60MG", price: 1500, category: B },
  { name: "GHK+KPV 110MG", price: 1800, category: B },
  { name: "BPC 5mg + TB500 5mg", price: 1600, category: P },
  { name: "NJ100 + 10AM + MS10 120mg", price: 1850, category: P },
  { name: "Kisspeptin 10mg", price: 1200, category: P },
  { name: "HGH 191AA (Somatropin) 36iu", price: 2500, category: P },
  { name: "Periocular", price: 550, category: B },
  { name: "Recombinant Collagen", price: 500, category: B },
  { name: "Composite Peptide Pink", price: 500, category: B },
  { name: "Salmon PDRN", price: 500, category: B },
  { name: "Whitening Peptide", price: 500, category: B },
  { name: "Acne Peptide", price: 550, category: B },
  { name: "AOD9604 5mg", price: 1500, category: W },
  { name: "AOD9604 10mg", price: 1800, category: W },
  { name: "AICAR 50mg", price: 1500, category: W },
  { name: "AICAR 100mg", price: 2700, category: W },
  { name: "Selank 10mg", price: 850, category: P },
  { name: "Semax 10mg", price: 850, category: P },
  { name: "Lipo C with B12", price: 900, category: W },
  { name: "Eloralintide 10mg", price: 2200, category: W },
  { name: "VRX-0075 10mg", price: 1500, category: W },
  { name: "Brenipatide 10MG", price: 1700, category: W },
  { name: "Maritide 10MG", price: 1700, category: W },
  { name: "ATX304 10MG", price: 1500, category: W },
  { name: "Tirzepatide 15MG - SALTFORM", price: 1300, category: W },
  { name: "Tirzepatide 30MG - SALTFORM", price: 2000, category: W },
  { name: "Retatrutide 10MG - SALTFORM", price: 1500, category: W },
  { name: "Glutaone", price: 750, category: A },
  { name: "Glutaone - PER BOX with Pharma Bac", price: 5500, category: A },
  { name: "Aqualyx", price: 2500, category: A },
  { name: "Lipo Lab", price: 2500, category: A },
  { name: "Lipo Vela", price: 3500, category: A },
  { name: "Lipo Vela V-Line - PER BOX", price: 3500, category: A },
  { name: "Lipo Vela V-Line - PER VIAL", price: 450, category: A },
  { name: "Lemon Bottle China 10ML", price: 650, category: A },
  { name: "Lemon Bottle China 50ML", price: 1500, category: A },
  { name: "Lemon Bottle VN", price: 3800, category: A },
  { name: "AMI Eyes", price: 2000, category: A },
  { name: "HYARON - PER SYRINGE", price: 500, category: A },
  { name: "Laennec (Per tray, 10 amps)", price: 3000, category: A },
  { name: "Rejuran Healer", price: 6500, category: A },
  { name: "Luhilo Snow", price: 6500, category: A },
  { name: "Botulax 100", price: 1800, category: A },
  { name: "Botulax 200", price: 2500, category: A },
  { name: "Botulax 300", price: 3200, category: A },
  { name: "Wondertox 100", price: 1600, category: A },
  { name: "Wondertox 200", price: 2000, category: A },
  { name: "Regular Bac Water 3ML", price: 80, category: "bac-water" },
  { name: "Regular Bac Water 5ML", price: 90, category: "bac-water" },
  { name: "Regular Bac Water 10ML", price: 100, category: "bac-water" },
  { name: "Pharma Bac Ampoule 10ML", price: 110, category: "bac-water" },
  { name: "Pharma Bac Vial 3ML", price: 90, category: "bac-water" },
  { name: "Pharma Bac Vial 5ML", price: 100, category: "bac-water" },
  { name: "Pharma Bac Vial 10ML", price: 115, category: "bac-water" },
  { name: "Candy Pen 60u - PEN ONLY", price: 750, category: "pens" },
  { name: "Candy Pen 60u - SET", price: 950, category: "pens" },
  { name: "V1 Matte Pen - PEN ONLY", price: 800, category: "pens" },
  { name: "V1 Matte Pen - SET", price: 950, category: "pens" },
  { name: "Additional Basic Set (10 pcs insulin syringes)", price: 150, category: "pens" },
  { name: "Additional Complete Set", price: 300, category: "pens" },
  { name: "Additional Pen Cartridge", price: 35, category: "pens" },
  { name: "Additional Insulin Pen Needles - 4MM", price: 150, category: "pens" },
  { name: "Vial Opener (Pink, Purple, Blue, Yellow)", price: 55, category: "pens" },
  { name: "GHK-CU PDRN with Snap 8 SERUM 30ML", price: 550, category: "skincare" },
  { name: "Retinol + Bakuchiol Serum 30ML", price: 450, category: "skincare" },
  { name: "Acne Defense Serum 30ML", price: 450, category: "skincare" },
  { name: "PDRN Skin Reboot Lotion 100ML", price: 395, category: "skincare" },
  { name: "AHK-CU Hair Tonic Spray 50ML", price: 550, category: "skincare" },
];
