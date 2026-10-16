// The curated product families for Mama Mica Glow's shop, transcribed from
// "Mica - Pricelist 8_25_25 - Updated Pricelist" (scripts/data/mamamica-pricelist-2026-08-25.json).
//
// The family/size split is CURATED, never parsed: the sheet's codes and names do
// not group reliably (BPC-157 vs BPC-157 + TB-500, Semaglutide vs Cagrilintide +
// Semaglutide). Each entry lists the sheet codes that become one product, and the
// option label each code sells under. scripts/test-mamamica-pricelist.ts checks
// that every sheet row lands in exactly one family.

export type MamamicaCategoryId =
  | "blends"
  | "weight"
  | "recovery"
  | "growth"
  | "longevity"
  | "hormones"
  | "skin"
  | "vitamins"
  | "supplies"
  | "printers";

/** Shop shelf order. Ids are stored on each product (the catalog filters by id). */
export const MAMAMICA_CATEGORIES: ReadonlyArray<{ id: MamamicaCategoryId; label: string }> = [
  { id: "blends", label: "Mica Exclusive Blends" },
  { id: "weight", label: "Weight Management" },
  { id: "recovery", label: "Recovery & Healing" },
  { id: "growth", label: "Growth & Performance" },
  { id: "longevity", label: "Longevity & Brain" },
  { id: "hormones", label: "Hormones & Wellness" },
  { id: "skin", label: "Skin, Hair & Beauty" },
  { id: "vitamins", label: "Vitamin Blends & Supplements" },
  { id: "supplies", label: "Waters & Supplies" },
  { id: "printers", label: "Label Printers" },
];

export type MamamicaFamily = {
  category: MamamicaCategoryId;
  name: string;
  /** [sheet code, option label]. A single-option family shows no size picker. */
  options: ReadonlyArray<readonly [code: string, label: string]>;
  /** What one unit is when the box price is a multiple of it (default "vial"). */
  unit?: string;
  /** Extra copy for the description (e.g. a sheet section note). */
  note?: string;
  /** Head each option's copy with its label (options that differ, e.g. colours). */
  labelOptions?: boolean;
};

const f = (
  category: MamamicaCategoryId,
  name: string,
  options: MamamicaFamily["options"],
  extra: Pick<MamamicaFamily, "unit" | "note" | "labelOptions"> = {},
): MamamicaFamily => ({ category, name, options, ...extra });

/** Single-option family: the label is unused, so it is the code itself. */
const one = (category: MamamicaCategoryId, name: string, code: string, extra?: Pick<MamamicaFamily, "unit" | "note">) =>
  f(category, name, [[code, code]], extra);

const BIOREGULATOR_NOTE = "Khavinson peptide bioregulator.";
const PRINTER_NOTE = "To order basis — about 1 week wait time (Niimbot group buy).";

export const MAMAMICA_FAMILIES: ReadonlyArray<MamamicaFamily> = [
  // ── Mica Exclusive Blends ──
  one("blends", "Mica Blend — KPV + GHK-Cu 60mg", "MICABLEND"),
  one("blends", "Mica Blend 2.0 — Tirzepatide + Cagrilintide 35mg", "MICABLEND 2.0"),
  one("blends", "Mica Blend 3.0 — GHK-Cu + KPV 120mg", "MICABLEND 3.0"),
  one("blends", "Retalide — Retatrutide + Cagrilintide 35mg", "RETALIDE"),
  one("blends", "Mica Blend 70 — Tirzepatide + Cagrilintide 70mg", "MICABLEND70"),

  // ── Weight Management ──
  f("weight", "Semaglutide", [["SM2", "2mg"], ["SM55", "5mg"], ["SM10", "10mg"], ["SM15", "15mg"], ["SM20", "20mg"], ["SM30", "30mg"]]),
  f("weight", "Tirzepatide", [
    ["TR5", "5mg"], ["TR10", "10mg"], ["TR15", "15mg"], ["TR20", "20mg"], ["TR30", "30mg"],
    ["TR40", "40mg"], ["TR50", "50mg"], ["TR60", "60mg"], ["TR100", "100mg"],
  ]),
  f("weight", "Retatrutide", [["RT5", "5mg"], ["RT10", "10mg"], ["RT15", "15mg"], ["RT20", "20mg"], ["RT30", "30mg"], ["RT60", "60mg"]]),
  f("weight", "Cagrilintide", [["CGL5", "5mg"], ["CGL10", "10mg"]]),
  f("weight", "Cagrilintide + Semaglutide", [["CS5", "5mg"], ["CS10", "10mg"]]),
  one("weight", "Mazdutide 10mg", "MDT10"),
  one("weight", "Survodutide 10mg", "SUR10"),
  f("weight", "Liraglutide", [["LL5", "5mg"], ["LL10", "10mg"], ["LL30", "30mg"]]),
  one("weight", "GLP-1 5mg", "GP"),
  one("weight", "Eloralintide 10mg", "ELORA"),
  one("weight", "Brenipatide 10mg", "BRENI"),
  f("weight", "AOD-9604", [["2AD", "2mg"], ["5AD", "5mg"], ["10AD", "10mg"]]),
  f("weight", "Adipotide", [["AP2", "2mg"], ["AP5", "5mg"]]),
  f("weight", "5-Amino-1MQ", [["5AM.", "5mg"], ["10AM.", "10mg"], ["50AM.", "50mg"]]),
  one("weight", "Lipo-C 10ml", "LC120"),
  one("weight", "Lipo-C with Vitamin B12 10ml", "LC216"),
  one("weight", "L-Carnitine 600mg 10ml", "LC600"),
  one("weight", "Fat Blaster Lipo-C 10ml", "LC526"),
  f("weight", "Lemon Bottle", [["LB", "10ml"], ["LB50", "50ml"]], { unit: "bottle" }),

  // ── Recovery & Healing ──
  f("recovery", "BPC-157", [["BC5", "5mg"], ["BC10", "10mg"]]),
  f("recovery", "TB-500", [["BT5", "5mg"], ["BT10", "10mg"]]),
  f("recovery", "BPC-157 + TB-500", [["BB10", "10mg (5+5)"], ["BB20", "20mg (10+10)"]]),
  one("recovery", "GLOW (BPC-157 + GHK-Cu + TB-500) 70mg", "BBG70"),
  one("recovery", "KLOW (GHK-Cu + TB-500 + BPC-157 + KPV) 80mg", "KLOW80"),
  f("recovery", "KPV", [["KPV5", "5mg"], ["KPV10", "10mg"], ["KPV20", "20mg"]]),
  one("recovery", "LL-37 5mg", "3710"),
  one("recovery", "ARA-290 10mg", "RA10"),
  f("recovery", "Thymosin Alpha-1", [["TA5", "5mg"], ["TA10", "10mg"]]),
  one("recovery", "Thymalin 10mg", "TY10"),
  f("recovery", "VIP (Vasoactive Intestinal Peptide)", [["VIP5", "5mg"], ["VIP10", "10mg"]]),
  f("recovery", "PNC-27", [["PNC27", "5mg"], ["PNC27-10", "10mg"]]),
  one("recovery", "Teriparatide 10mg", "TER10"),
  one("recovery", "Dermorphin 5mg", "DR5"),

  // ── Growth & Performance ──
  f("growth", "Ipamorelin", [["IP5", "5mg"], ["IP10", "10mg"]]),
  f("growth", "CJC-1295 (No DAC)", [["CND5", "5mg"], ["CND10", "10mg"]]),
  one("growth", "CJC-1295 with DAC 5mg", "CD5"),
  one("growth", "CJC-1295 (No DAC) + Ipamorelin 10mg", "CP10"),
  f("growth", "Sermorelin Acetate", [["SMO5", "5mg"], ["SMO10", "10mg"]]),
  f("growth", "Tesamorelin", [["TSM5", "5mg"], ["TSM10", "10mg"], ["TSM20", "20mg"]]),
  one("growth", "Hexarelin Acetate 10mg", "HX5"),
  f("growth", "GHRP-6 Acetate", [["G65", "5mg"], ["G610", "10mg"]]),
  f("growth", "IGF-1 LR3", [["IG01", "0.1mg (100mcg)"], ["IG1", "1mg"]]),
  f("growth", "HGH 191AA (Somatropin)", [["H10", "10iu"], ["H15", "15iu"]]),
  one("growth", "HGH Fragment 176-191 5mg", "FR5"),
  one("growth", "EPO 3000iu", "E3K"),

  // ── Hormones & Wellness ──
  f("hormones", "HCG", [["G5K", "5000iu"], ["G10K", "10000iu"]]),
  one("hormones", "HMG 75iu", "G75"),
  one("hormones", "PT-141 10mg", "P41"),
  one("hormones", "Oxytocin 2mg", "OT2"),
  f("hormones", "Kisspeptin-10", [["KS5", "5mg"], ["KS10", "10mg"]]),
  one("hormones", "MT-2 (Melanotan 2 Acetate) 10mg", "ML10"),
  one("hormones", "Alprostadil 20mcg", "PRO20"),
  one("hormones", "Melatonin 5mg", "MT10"),

  // ── Longevity & Brain ──
  f("longevity", "NAD+", [["NJ100", "100mg"], ["NJ500", "500mg"]]),
  f("longevity", "Epitalon", [["ET10", "10mg"], ["ET50", "50mg"]]),
  f("longevity", "SS-31", [["2S10", "10mg"], ["2S50", "50mg"]]),
  f("longevity", "MOTS-c", [["MS10", "10mg"], ["MS40", "40mg"]]),
  f("longevity", "Semax", [["XA5", "5mg"], ["XA10", "10mg"]]),
  f("longevity", "Selank", [["SK5", "5mg"], ["SK10", "10mg"]]),
  one("longevity", "Semax + Selank 20mg", "XS20"),
  one("longevity", "NA Semax Amidate 30mg", "NXA30"),
  one("longevity", "NA Selank Amidate 30mg", "NSK30"),
  one("longevity", "DSIP 5mg", "DS5"),
  f("longevity", "Pinealon", [["PI10", "10mg"], ["P20", "20mg"]]),
  one("longevity", "Humanin 10mg", "HU10"),
  one("longevity", "Adamax 5mg", "AD5"),
  one("longevity", "PE-22-28 10mg", "PE10"),
  one("longevity", "Dihexa 20mg (25 tablets)", "DHA20", { unit: "bottle" }),
  one("longevity", "Klotho 10mg", "KLOTHO"),
  one("longevity", "VRX-0075 10mg", "VRX-0075"),
  one("longevity", "Cerebrolysin 60mg", "CBL60"),
  one("longevity", "Vilon 20mg", "VI120", { note: BIOREGULATOR_NOTE }),
  one("longevity", "Bronchogen 20mg", "BR20", { note: BIOREGULATOR_NOTE }),
  one("longevity", "Cardiogen 20mg", "CA20", { note: BIOREGULATOR_NOTE }),
  one("longevity", "Cortagen 20mg", "COR20", { note: BIOREGULATOR_NOTE }),
  one("longevity", "Livagen 20mg", "LI20", { note: BIOREGULATOR_NOTE }),
  one("longevity", "Pancragen 20mg", "PA20", { note: BIOREGULATOR_NOTE }),
  one("longevity", "Prostamax 20mg", "MAX20", { note: BIOREGULATOR_NOTE }),
  one("longevity", "Cartalax 20mg", "LAX20", { note: BIOREGULATOR_NOTE }),
  one("longevity", "Chonluten 20mg", "CH20", { note: BIOREGULATOR_NOTE }),
  one("longevity", "Crystalagen 20mg", "CRY20", { note: BIOREGULATOR_NOTE }),
  one("longevity", "Ovagen 20mg", "OV20", { note: BIOREGULATOR_NOTE }),
  one("longevity", "Vesugen 20mg", "VE20", { note: BIOREGULATOR_NOTE }),

  // ── Skin, Hair & Beauty ──
  f("skin", "GHK-Cu", [["CU50", "50mg"], ["CU100", "100mg"]]),
  f("skin", "AHK-Cu (Topical)", [["AU50", "50mg"], ["AU100", "100mg"]]),
  one("skin", "GHK-Cu Cosmetic Grade 1g", "CUCG1G"),
  one("skin", "AHK-Cu Cosmetic Grade 1g", "AUCG1G"),
  one("skin", "PDRN Cosmetic Grade 1g", "PDRN"),
  one("skin", "GHK-Cu Hydrogel Mask", "GHKHM"),
  one("skin", "Snap-8 (Topical) 10mg", "NP810"),
  one("skin", "Matrixyl (Topical) 10mg", "MA10"),
  one("skin", "Glutathione 1500mg", "GTT"),
  one("skin", "Botulinum Toxin 100iu", "XT100"),
  one("skin", "Hyaluronic Acid 1ml", "HA5"),
  one("skin", "PTD-DBM 5mg", "PTD5"),
  one("skin", "NCTF 135 HA (Topical)", "NCTF135HA"),
  one("skin", "Pure PDRN Serum (10-day)", "PDRNSerum"),
  one("skin", "Whitening & Spot Fading Skinbooster", "SG01"),
  one("skin", "PDRN Skinbooster", "SG02"),
  one("skin", "Collagen Skinbooster", "SG03"),
  one("skin", "Pink Hyaluronic Acid Essence", "SG04"),
  one("skin", "Acne Clearing Skinbooster", "SG05"),
  one("skin", "Periocular Anti-Wrinkle Peptide Serum", "SG06"),
  one("skin", "NAD+ Skin Serum", "SG07"),
  one("skin", "Blue Copper Peptide Skin Booster", "SG08"),
  one("skin", "Sodium Hyaluronic Skin Booster", "SG09"),
  one("skin", "Anti-Wrinkle Collagen Skin Booster", "SG10"),
  one("skin", "PDRN Peptide Eye Patches", "SG11"),
  one("skin", "Dark Spot Brightening Cream", "SG12"),
  one("skin", "Rejuvenating Solution Serum", "SG13"),
  one("skin", "Microbiome Radiance Ampoule", "SG14"),
  one("skin", "Kojic Acid Brightening Cream", "SG15"),
  one("skin", "Stem-Cell Exosome Skin Booster", "EXO30"),
  one("skin", "MRDR Hair Growth Scalp Serum", "IS24"),
  one("skin", "Sponge Spicule Bio-Microneedling", "SP01", { unit: "pair" }),
  one("skin", "Deep Collagen Silk Peptide Ampoule", "DC01"),
  one("skin", "Kojic Acid + Niacinamide Ampoule", "KN01"),
  one("skin", "PDRN Pink Vitamin Glow Ampoule", "PV01"),
  one("skin", "Glutathione Serum Ampoules", "GS01"),
  one("skin", "Whitening Stem Cell Culture", "SC01"),
  f(
    "skin",
    "Algae Sponge Microneedles",
    [["ASMB", "Blue"], ["ASMBE", "Blue Enhanced"], ["ASMBN", "Brown"], ["ASMG", "Green"], ["ASMPNK", "Pink"], ["ASMW", "White"], ["ASMBLK", "Black"]],
    { unit: "pair", labelOptions: true },
  ),
  one("skin", "The Mica Blend GHK-Cu Shampoo 250ml", "TMB-GHKCU-SH250"),
  one("skin", "The Mica Blend GHK-Cu Conditioner 250ml", "TMB-GHKCND-CND250"),
  one("skin", "The Mica Blend AHK-Cu Scalp & Hair Mist 100ml", "TMB-AHKM100"),
  one("skin", "The Mica Blend Nail Growth Oil 15ml", "TMB-NGO15"),
  one("skin", "The Mica Blend GHK-Cu Serum 30ml", "TMB-GHKSER30"),

  // ── Vitamin Blends & Supplements ──
  one("vitamins", "Healthy Hair, Skin & Nails Blend", "HHB"),
  one("vitamins", "Super Human Blend", "SBH"),
  one("vitamins", "Relaxation PM Blend", "RP226"),
  one("vitamins", "Liposomal Glutathione 60ml", "ORALGTT"),
  one("vitamins", "NAD+ + Biotin Gummies", "NBG60"),
  one("vitamins", "Mama Mica GLW Biotin with Collagen & Keratin", "MMG-BTN15K"),

  // ── Waters & Supplies ──
  f("supplies", "BApH Bacteriostatic Water", [
    ["BA3PH", "3ml"], ["BA5PH", "5ml"], ["BA10PH", "10ml"],
    ["BA3PHRMAGREEN", "3ml Pharma Green"], ["BA10PHRMAGREEN", "10ml Pharma Green"],
  ]),
  f("supplies", "Phosphate Buffered Saline (Topical)", [["WA3", "3ml"], ["WA10", "10ml"]]),
  f("supplies", "Acetic Acid Water 0.6%", [["AA3", "3ml"], ["AA10", "10ml"]]),
  one("supplies", "Sodium Chloride 0.9% for Nasal Spray (5 ampoules)", "NS10"),

  // ── Label Printers ──
  one("printers", "Niimbot M2 Label Printer", "Niimbot M2", { note: PRINTER_NOTE }),
  one("printers", "Niimbot K3 Label Printer (with 50×30 label roll)", "Niimbot K3 w/ 1 big roll of 50*30 label", { note: PRINTER_NOTE }),
  f(
    "printers",
    "Niimbot B1 Pro Label Printer",
    [["Niimbot B1 Pro White", "White"], ["Niimbot B1 Pro Purple", "Purple"], ["Niimbot B1 Pro Green", "Green"], ["Niimbot B1 Pro Black", "Black"]],
    { note: PRINTER_NOTE },
  ),
  one("printers", "Niimbot D11 Label Printer (with 12×40 labels)", "Niimbot D11 White w/12*40 Label", { note: PRINTER_NOTE }),
];
