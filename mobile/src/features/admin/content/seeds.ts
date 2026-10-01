import type { Row } from "../setup/rules";

/**
 * The website admin's starter content (src/storefront/data.ts SEED_*). A store
 * that never saved FAQ / lab reports / protocols has NO key in branding.config,
 * and the web editor shows these until the first save — so the app does too,
 * and the owner's first edit here writes exactly what the web's would.
 * (Reviews need no seed: the brand projection always normalizes them to a list.)
 */

export const SEED_COA_REPORTS: Row[] = [
  { id: "coa1", name: "BPC-157 5mg", lab: "Janoshik Analytical", date: "2026-04-12", purity: "99.2%", image: "", link: "" },
  { id: "coa2", name: "Tirzepatide 15mg", lab: "Chromate Laboratories", date: "2026-03-28", purity: "99.8%", image: "", link: "" },
];

export const SEED_FAQ_GROUPS: Row[] = [
  {
    id: "shipping", label: "Shipping & Delivery", icon: "shipping",
    items: [
      { q: "Where is the seller located?", a: "Our fulfillment is based locally with a satellite warehouse for faster delivery." },
      { q: "Do you ship internationally or nationwide only?", a: "We currently ship nationwide. International shipping is rolling out region by region." },
      { q: "How do I know my parcel is shipped?", a: "You'll receive a tracking number via email once your order leaves the warehouse." },
    ],
  },
  {
    id: "payment", label: "Payment", icon: "payment",
    items: [
      { q: "What payment methods do you accept?", a: "Major credit cards, bank transfers, and e-wallets." },
      { q: "Is payment secure?", a: "Yes — all transactions are processed over encrypted channels." },
    ],
  },
  {
    id: "product", label: "Product", icon: "product",
    items: [
      { q: "Are products tested?", a: "Every batch is independently lab-tested for purity. See our COA page." },
      { q: "How should I store products?", a: "Refrigerate after opening. See protocol guide for specifics." },
    ],
  },
];

export const SEED_PROTOCOLS: Row[] = [
  {
    category: "Weight Management", name: "Tirzepetide 15MG Protocol",
    dosage: "2.5mg - 7.5mg weekly (dose based on vial size)", frequency: "Once weekly on the same day", duration: "12-16 weeks per cycle",
    notes: ["Start with 2.5mg for first 4 weeks", "Increase by 2.5mg every 4 weeks as tolerated", "This is the 15mg vial - yields multiple doses", "Inject subcutaneously in abdomen, thigh, or upper arm", "Take with or without food", "Rotate injection sites"],
    storage: "Refrigerate at 2-8°C. Once in use, can be kept at room temperature for up to 21 days.",
  },
  {
    category: "Weight Management", name: "Tirzepetide 30MG Protocol",
    dosage: "5mg - 15mg weekly (higher dose vial)", frequency: "Once weekly on the same day", duration: "12-16 weeks per cycle",
    notes: ["Start with 5mg for first 4 weeks if experienced", "Increase by 2.5-5mg every 4 weeks as tolerated", "Maximum dose is 15mg weekly", "This larger vial offers more flexibility", "Inject subcutaneously", "May cause nausea initially - eat smaller meals"],
    storage: "Refrigerate at 2-8°C.",
  },
  {
    category: "Longevity & Anti-Aging", name: "NAD+ 500MG Protocol",
    dosage: "100mg - 250mg daily", frequency: "Once daily, preferably morning", duration: "8-12 weeks per cycle",
    notes: ["Start with 100mg and increase gradually", "Subcutaneous or intramuscular injection", "Higher dose vial allows extended use", "Take in morning to avoid sleep disruption", "Supports cellular energy and repair", "Some initial flushing is normal"],
    storage: "Refrigerate after reconstitution. Protect from light.",
  },
  {
    category: "Beauty & Regeneration", name: "GHK CU 50MG Protocol",
    dosage: "1mg - 2mg daily", frequency: "Once daily", duration: "8-12 weeks per cycle",
    notes: ["Can be used topically or via injection", "Promotes collagen synthesis", "Supports skin elasticity and wound healing", "Also used for hair regrowth", "Copper peptide with many benefits", "Safe for long-term use"],
    storage: "Refrigerate after reconstitution.",
  },
  {
    category: "Beauty & Regeneration", name: "GHK CU 100MG Protocol",
    dosage: "2mg - 3mg daily", frequency: "Once daily", duration: "8-12 weeks per cycle",
    notes: ["Higher concentration for extended protocols", "Excellent for anti-aging protocols", "Can inject near treatment area", "Supports tissue repair", "Works synergistically with other peptides", "Monitor for copper sensitivity"],
    storage: "Refrigerate after reconstitution.",
  },
  {
    category: "Sleep & Recovery", name: "DSIP 5MG Protocol",
    dosage: "100mcg - 300mcg before bed", frequency: "Once daily, 30 min before sleep", duration: "2-4 weeks per cycle",
    notes: ["Start with 100mcg to assess tolerance", "Promotes deep, restorative sleep", "Do not combine with other sedatives", "Effects build over several days", "Take 2-4 week breaks between cycles", "Subcutaneous injection preferred"],
    storage: "Refrigerate after reconstitution.",
  },
  {
    category: "Sleep & Recovery", name: "DSIP 15MG Protocol",
    dosage: "200mcg - 400mcg before bed", frequency: "Once daily, 30 min before sleep", duration: "4-6 weeks per cycle",
    notes: ["Larger vial for extended sleep support", "Gradually increase dose as needed", "Supports natural sleep architecture", "May help with stress-related insomnia", "Avoid alcohol when using", "Take breaks to prevent tolerance"],
    storage: "Refrigerate after reconstitution.",
  },
  {
    category: "Detox & Skin Brightening", name: "Glutathione 1500MG Protocol",
    dosage: "200mg - 500mg every other day", frequency: "3-4 times weekly", duration: "8-12 weeks per cycle",
    notes: ["Master antioxidant for detoxification", "Skin brightening and evening tone", "Can inject subcutaneously or intramuscularly", "Often combined with Vitamin C", "Supports liver function", "Results visible after 4-6 weeks"],
    storage: "Refrigerate. Protect from light and heat.",
  },
  {
    category: "Fat Burning & Energy", name: "Lipo C with B12 Protocol",
    dosage: "1ml injection", frequency: "2-3 times weekly", duration: "Ongoing or 8-12 week cycles",
    notes: ["Lipotropic injection for fat metabolism", "Boosts energy and metabolism", "Inject intramuscularly in thigh or buttock", "Best combined with exercise program", "Supports liver fat processing", "B12 provides energy boost"],
    storage: "Refrigerate. Protect from light.",
  },
  {
    category: "Mitochondrial Health", name: "SS31 10MG Protocol",
    dosage: "5mg - 10mg daily", frequency: "Once daily", duration: "4-6 weeks per cycle",
    notes: ["Targets inner mitochondrial membrane", "Protects against oxidative stress", "Supports cellular energy production", "Inject subcutaneously", "Best taken in morning", "Take 4-week breaks between cycles"],
    storage: "Refrigerate. Protect from light.",
  },
  {
    category: "Mitochondrial Health", name: "SS31 50MG Protocol",
    dosage: "10mg - 20mg daily", frequency: "Once daily", duration: "4-8 weeks per cycle",
    notes: ["Higher dose for intensive protocols", "Advanced mitochondrial support", "Anti-aging at cellular level", "Monitor energy levels", "May enhance exercise performance", "Rotate injection sites"],
    storage: "Refrigerate. Protect from light.",
  },
  {
    category: "Metabolic Health", name: "MOTS C 10MG Protocol",
    dosage: "5mg twice weekly", frequency: "Twice weekly (e.g., Mon/Thu)", duration: "8-12 weeks per cycle",
    notes: ["Mitochondrial-derived peptide", "Improves insulin sensitivity", "Enhances exercise capacity", "Take before exercise for best results", "Supports metabolic health", "Intramuscular or subcutaneous"],
    storage: "Refrigerate after reconstitution.",
  },
  {
    category: "Metabolic Health", name: "MOTS C 40MG Protocol",
    dosage: "10mg twice weekly", frequency: "Twice weekly (e.g., Mon/Thu)", duration: "8-12 weeks per cycle",
    notes: ["Higher dose for intensive protocols", "Enhanced metabolic optimization", "Great for athletes and active users", "Best taken pre-workout", "Supports weight management", "Monitor blood glucose if diabetic"],
    storage: "Refrigerate after reconstitution.",
  },
  {
    category: "Healing & Anti-Inflammatory", name: "KLOW (CU50+TB10+BC10+KPV10) Protocol",
    dosage: "As pre-mixed or follow component ratios", frequency: "Once daily", duration: "6-8 weeks per cycle",
    notes: ["Powerful combination stack", "GHK-Cu for regeneration", "TB-500 for tissue repair", "BPC-157 for healing", "KPV for anti-inflammatory", "All-in-one healing protocol"],
    storage: "Refrigerate after reconstitution.",
  },
  {
    category: "Fat Dissolving", name: "Lemon Bottle 10MG Protocol",
    dosage: "Apply as directed to treatment area", frequency: "Weekly treatments", duration: "4-6 sessions typically",
    notes: ["Lipolytic solution for fat reduction", "Professional application recommended", "Targets stubborn fat deposits", "Massage after application", "Results visible after 2-3 sessions", "Avoid strenuous exercise 24hrs after"],
    storage: "Refrigerate. Keep away from direct sunlight.",
  },
  {
    category: "Anti-Inflammatory & Regeneration", name: "KPV 10MG + GHKCu 50MG Protocol",
    dosage: "KPV: 200mcg + GHKCu: 1mg daily", frequency: "Once daily", duration: "6-8 weeks per cycle",
    notes: ["Synergistic anti-inflammatory combo", "KPV reduces inflammation", "GHKCu promotes tissue repair", "Great for skin and gut health", "Subcutaneous injection", "Can split doses AM/PM"],
    storage: "Refrigerate after reconstitution.",
  },
  {
    category: "Anti-Wrinkle", name: "Snap-8 (Botox in a Bottle) Protocol",
    dosage: "Apply topically to wrinkle-prone areas", frequency: "Twice daily", duration: "Ongoing use",
    notes: ["Topical anti-wrinkle peptide", "Apply to forehead, crows feet, frown lines", "Works by relaxing facial muscles", "Visible results in 2-4 weeks", "Safe for daily use", "Can layer under moisturizer"],
    storage: "Store at room temperature. Keep sealed.",
  },
  {
    category: "Professional Cosmetic Use", name: "GHKCu Cosmetic Grade (1 gram) Protocol",
    dosage: "Mix into serums: 0.1-0.5% concentration", frequency: "Daily as part of skincare routine", duration: "Ongoing use",
    notes: ["High-grade copper peptide powder", "Mix into your preferred serum base", "Start with lower concentration", "Store mixed serum in dark bottle", "Promotes collagen and elastin", "Professional skincare formulation"],
    storage: "Store powder in freezer. Mixed serum refrigerate.",
  },
  {
    category: "Cognitive Enhancement", name: "Semax 10MG + Selank 10MG Protocol",
    dosage: "Semax: 300mcg + Selank: 250mcg daily", frequency: "1-2 times daily", duration: "2-4 weeks per cycle",
    notes: ["Powerful nootropic combination", "Semax for focus and memory", "Selank for anxiety and stress", "Intranasal or subcutaneous", "Best taken morning/early afternoon", "Take breaks between cycles"],
    storage: "Refrigerate. Use within 30 days.",
  },
  {
    category: "Anti-Inflammatory", name: "KPV 5MG Protocol",
    dosage: "100mcg - 200mcg daily", frequency: "Once daily", duration: "4-8 weeks per cycle",
    notes: ["Potent anti-inflammatory peptide", "Alpha-MSH fragment", "Gut health and skin conditions", "Subcutaneous injection", "No significant side effects", "Works systemically"],
    storage: "Refrigerate after reconstitution.",
  },
  {
    category: "Anti-Inflammatory", name: "KPV 10MG Protocol",
    dosage: "200mcg - 400mcg daily", frequency: "Once or twice daily", duration: "4-8 weeks per cycle",
    notes: ["Higher dose for stronger effect", "Excellent for inflammatory conditions", "Can split dose morning/evening", "Supports gut barrier function", "Anti-microbial properties", "Safe for extended use"],
    storage: "Refrigerate after reconstitution.",
  },
  {
    category: "Growth Hormone", name: "Tesamorelin 5MG Protocol",
    dosage: "1mg daily", frequency: "Once daily before bed on empty stomach", duration: "12-26 weeks per cycle",
    notes: ["FDA-approved GHRH analog", "Reduces visceral fat", "Inject subcutaneously in abdomen", "No food 2 hours before/after", "Stimulates natural GH release", "Monitor IGF-1 levels"],
    storage: "Refrigerate at 2-8°C.",
  },
  {
    category: "Growth Hormone", name: "Tsamorelin 10MG Protocol",
    dosage: "1mg - 2mg daily", frequency: "Once daily before bed on empty stomach", duration: "12-26 weeks per cycle",
    notes: ["Larger vial for extended use", "Same protocol as 5MG", "Consistent timing important", "Best taken before bed", "Avoid eating after injection", "Results visible after 8-12 weeks"],
    storage: "Refrigerate at 2-8°C.",
  },
  {
    category: "Longevity & Anti-Aging", name: "Epitalon 10MG Protocol",
    dosage: "5mg - 10mg daily for 10-20 days", frequency: "Once daily, preferably before bed", duration: "10-20 day cycles, 4-6 months apart",
    notes: ["Telomere elongation peptide", "Short intense cycles", "Promotes melatonin production", "Anti-aging at DNA level", "Take 2-3 cycles per year", "Subcutaneous injection"],
    storage: "Refrigerate. Stable for 6 months.",
  },
  {
    category: "Longevity & Anti-Aging", name: "Epitalon 50MG Protocol",
    dosage: "10mg daily for 10-20 days", frequency: "Once daily, preferably before bed", duration: "10-20 day cycles, 4-6 months apart",
    notes: ["Higher dose vial for multiple cycles", "Ultimate longevity peptide", "Resets biological clock", "Improves sleep quality", "Supports immune function", "Visible anti-aging effects"],
    storage: "Refrigerate. Stable for 6 months.",
  },
  {
    category: "Sexual Wellness", name: "PT141 10MG Protocol",
    dosage: "500mcg - 2mg as needed", frequency: "As needed, 1-2 hours before activity", duration: "Use as needed, 24hr minimum between doses",
    notes: ["Also known as Bremelanotide", "Start with 500mcg to assess tolerance", "Effects last 24-72 hours", "Inject subcutaneously 45min-2hrs before", "May cause nausea initially", "Maximum once per 24 hours"],
    storage: "Refrigerate. Use within 30 days.",
  },
];
