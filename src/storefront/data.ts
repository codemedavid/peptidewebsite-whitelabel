// Seed data for the white-label storefront, ported verbatim from the Claude
// Design handoff bundle (BRAND_DEFAULTS, window.PRODUCTS, CATEGORIES, …).
// These are the tenant's starting content; the admin edits live in the store.

import type {
  Brand,
  Category,
  CoaReport,
  FaqGroup,
  Order,
  PaymentMethod,
  Product,
  PromoCode,
  Protocol,
  Review,
  ShippingLocation,
} from "./types";

export const BRAND: Brand = {
  name: "BrandName",
  logoUrl: "",
  ctaLabel: "Shop Now",
  industry: "premium peptides",

  main: "#B0345E",
  accent: "#E94B7D",
  button: "#E94B7D",
  button2: "#F687A8",
  buttonText: "#ffffff",
  background: "#FFF7FA",
  surface: "#ffffff",
  text: "#3B1F2A",
  headingFont: "Playfair Display",
  bodyFont: "Inter",

  adminPassword: "admin",
  adminLoginTitle: "Admin Access",
  adminLoginSub: "",

  showHeader: true,
  showHero: true,
  showCategories: true,
  showCatalog: true,
  showFooter: true,
  showPageTrack: true,
  showPageFAQ: true,
  showPageCOA: true,
  showPageProtocols: true,
  showPageReviews: true,
  showPageMerchant: false,
  showAdminAnalytics: true,
  showAdminCardStudio: true,

  headerShowBrand: true,
  headerShowCart: true,
  headerShowCta: true,

  heroVariant: "centered",
  heroShowLogo: true,
  heroShowChip: true,
  heroShowSub: true,
  heroShowCtas: true,
  heroShowCta2: true,
  heroChipLabel: "",
  heroLine1: "Premium products,",
  heroLine2: "beautifully verified.",
  heroSub:
    "A refined shopping experience with verified product details, straightforward protocols, and discreet nationwide delivery.",
  heroCta1: "Shop Now",
  heroCta2: "Learn More",

  catalogEyebrow: "Catalog",
  catalogTitle: "Our Collection",
  catalogShowSearch: true,
  catalogShowSort: true,
  catalogShowCount: true,

  footerShowBrand: true,
  footerShowBlurb: true,
  footerShowSocials: true,
  footerShowColumns: true,
  footerShowLegal: true,
  footerBlurb:
    "Verified products, transparent protocols, and discreet nationwide delivery.",
  footerDisclaimer: "Research use only. For qualified personnel.",
  footerCopyright: "© {year} {brand}. All rights reserved.",
  footerSocials: [
    { label: "Instagram", href: "#", icon: "instagram", show: true },
    { label: "Facebook", href: "#", icon: "facebook", show: true },
    { label: "Twitter", href: "#", icon: "twitter", show: true },
  ],
  footerColumns: [
    {
      title: "Shop",
      links: [
        { label: "All Products", href: "#catalog" },
        { label: "Featured", href: "#" },
        { label: "New Arrivals", href: "#" },
        { label: "Bestsellers", href: "#" },
      ],
    },
    {
      title: "Support",
      links: [
        { label: "Track Order", href: "#track" },
        { label: "FAQ", href: "#faq" },
        { label: "Shipping", href: "#" },
        { label: "Contact", href: "#" },
      ],
    },
    {
      title: "Resources",
      links: [
        { label: "COAs", href: "#coa" },
        { label: "Protocols", href: "#protocols" },
        { label: "Reviews", href: "#reviews" },
        { label: "Blog", href: "#" },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Privacy", href: "#" },
        { label: "Terms", href: "#" },
        { label: "Disclaimer", href: "#" },
      ],
    },
  ],

  trackTitle: "Track Your Order",
  trackSub:
    "Enter your Order Number to check the current status of your package.",
  trackPlaceholder: "Enter Order Number (e.g., ORD-1234)",
  trackCta: "Track Order",
  trackBackLabel: "Back to Shop",

  faqTitle: "Frequently Asked Questions",
  faqBackLabel: "Back",

  coaTitle: "Lab Reports",
  coaVerifiedLabel: "Lab Verified",
  coaBackLabel: "Back to Shop",
  coaEmptyMsg: "No lab reports available yet.",
  coaInfoTitle: "Independent Laboratory Verification",
  coaInfoBody:
    "We partner with top-tier third-party laboratories to ensure the highest quality standards. Each batch is rigorously tested for purity and concentration using HPLC and Mass Spectrometry.",
  coaPartners: [
    { label: "Janoshik", href: "#" },
    { label: "Chromate", href: "#" },
  ],
  coaBadges: [
    { label: "99%+ Purity", icon: "check" },
    { label: "Certified", icon: "award" },
    { label: "Verified", icon: "shield" },
  ],

  protocolsEyebrow: "Protocol Guide",
  protocolsTitle: "Protocol Guide",
  protocolsSub:
    "General guidelines and protocols. Always consult with a healthcare professional before use.",
  protocolsBackLabel: "Back to Home",
  protocolsGuidelinesTitle: "General Guidelines",
  protocolsGuidelines: [
    { label: "Preparation", text: " Follow instructions on the kit. Do not shake vigorously." },
    { label: "Storage", text: " Keep refrigerated until use." },
    { label: "Hygiene", text: " Use sterile, single-use supplies." },
    { label: "Timing", text: " Best taken on a consistent schedule." },
  ],
  protocolsStorageTitle: "Storage Guidelines",
  protocolsStorage: [
    { title: "Lyophilized (Powder)", text: "Store at -20°C for long-term. Stable at 2-8°C for weeks." },
    { title: "Reconstituted", text: "Refrigerate at 2-8°C. Use within 14-28 days depending on product." },
  ],

  reviewsTitle: "Customer Reviews",
  reviewsBackLabel: "Back",

  merchantEyebrow: "Wholesale",
  merchantTitle: "Reseller Price List",
  merchantSub: "Wholesale pricing for verified resellers. Minimum 10 units per item.",
  merchantBackLabel: "Back",
  merchantGateTitle: "Reseller Access",
  merchantGateSub: "Enter your reseller code to view wholesale pricing.",

  checkoutTitle: "Complete your order",
  checkoutNote:
    "Send us your order through your preferred app and we'll confirm availability, total and shipping.",
  contactChannels: [
    { type: "whatsapp", destination: "", enabled: false },
    { type: "telegram", destination: "", enabled: false },
    { type: "messenger", destination: "", enabled: false },
  ],

  nav: [
    { label: "Products", href: "#catalog" },
    { label: "Track Order", href: "#track" },
    { label: "FAQ", href: "#faq" },
    { label: "COA", href: "#coa" },
    { label: "Protocols", href: "#protocols" },
    { label: "Reviews", href: "#reviews" },
  ],
};

export const SEED_PRODUCTS: Product[] = [
  { id: "p1", name: "Product One (kit)", description: "Short, descriptive copy about the product's primary benefit and what's in the kit.", price: 1500, currency: "₱", purity: "99%", category: "weight", featured: true, image: null },
  { id: "p2", name: "Product Two (kit)", description: "Recommended for users with a higher weekly dosage. Sold by kit with complete supplies.", price: 2500, currency: "₱", purity: "99%", category: "weight", featured: true, image: null },
  { id: "p3", name: "Vial — Variant A", description: "Concise variant description goes here so cards stay scannable at a glance.", price: 1100, currency: "₱", purity: "99%", category: "peptides", featured: false, image: null },
  { id: "p4", name: "Accessory Pack", description: "Sold per box.", price: 1500, currency: "₱", purity: "99%", category: "wellness", featured: false, image: null },
  { id: "p5", name: "Product Five", description: "Beauty & anti-aging formulation. Targeted, evidence-based.", price: 1800, currency: "₱", purity: "99%", category: "beauty", featured: false, image: null },
  { id: "p6", name: "Product Six", description: "Vitality and wellness blend with verified third-party COAs.", price: 2100, currency: "₱", purity: "99%", category: "wellness", featured: false, image: null },
  { id: "p7", name: "Insulin Pen — Standard", description: "Pre-filled pen device. Discreet, nationwide shipping.", price: 3200, currency: "₱", purity: "99%", category: "insulin", featured: false, image: null },
  { id: "p8", name: "Sample Eight", description: "Compact starter option — ideal for first-time buyers.", price: 900, currency: "₱", purity: "99%", category: "peptides", featured: false, image: null },
];

export const SEED_CATEGORIES: Category[] = [
  { id: "all", label: "All Products" },
  { id: "peptides", label: "Peptides" },
  { id: "weight", label: "Weight Management" },
  { id: "beauty", label: "Beauty & Anti-Aging" },
  { id: "wellness", label: "Wellness & Vitality" },
  { id: "glp1", label: "GLP-1 Agonists" },
  { id: "insulin", label: "Insulin Pens" },
];

export const SEED_ORDERS: Order[] = [];

export const SEED_SHIPPING_LOCATIONS: ShippingLocation[] = [
  { id: "s1", code: "LBC_METRO_MANILA", name: "LBC - Metro Manila", price: 150, active: true },
  { id: "s2", code: "NCR", name: "NCR (Metro Manila)", price: 75, active: true },
  { id: "s3", code: "LBC_LUZON", name: "LBC - Luzon (Provincial)", price: 200, active: true },
  { id: "s4", code: "LUZON", name: "Luzon (Outside NCR)", price: 100, active: true },
  { id: "s5", code: "LBC_VISMIN", name: "LBC - Visayas & Mindanao", price: 250, active: true },
  { id: "s6", code: "VISAYAS_MINDANAO", name: "Visayas & Mindanao", price: 130, active: true },
  { id: "s7", code: "JNT_METRO_MANILA", name: "J&T - Metro Manila", price: 120, active: true },
  { id: "s8", code: "LBC EXPRESS", name: "LBC - LUZON, VISAYAS, MINDANAO", price: 450, active: true },
];

export const SEED_COA_REPORTS: CoaReport[] = [
  { id: "coa1", name: "BPC-157 5mg", lab: "Janoshik Analytical", date: "2026-04-12", purity: "99.2%", image: "", link: "" },
  { id: "coa2", name: "Tirzepatide 15mg", lab: "Chromate Laboratories", date: "2026-03-28", purity: "99.8%", image: "", link: "" },
];

export const SEED_PROMO_CODES: PromoCode[] = [
  { id: "pc1", code: "6VO", type: "fixed", value: 600, minPurchase: 0, usageLimit: null, used: 1, expiry: null, active: true },
  { id: "pc2", code: "2VO", type: "fixed", value: 400, minPurchase: 0, usageLimit: null, used: 1, expiry: null, active: true },
  { id: "pc3", code: "ROSIE", type: "fixed", value: 1400, minPurchase: 0, usageLimit: null, used: 1, expiry: "2026-05-17", active: true },
  { id: "pc4", code: "CHARMAINE BONGARES", type: "fixed", value: 900, minPurchase: 0, usageLimit: null, used: 0, expiry: null, active: true },
];

export const SEED_PAYMENT_METHODS: PaymentMethod[] = [
  { id: "pm1", name: "GCash", account: "Peptide Pulse", number: "", qrImage: "", order: 1, active: true },
  { id: "pm2", name: "BDO", account: "Peptide Pulse", number: "", qrImage: "", order: 2, active: true },
  { id: "pm3", name: "Security Bank", account: "Peptide Pulse", number: "", qrImage: "", order: 3, active: true },
  { id: "pm4", name: "Maya", account: "Britt Marie Angelica Arellano", number: "09179966191", qrImage: "", order: 4, active: true },
];

export const SEED_FAQ_GROUPS: FaqGroup[] = [
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

export const SEED_PROTOCOLS: Protocol[] = [
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

export const SEED_REVIEWS: Review[] = [
  { headline: "Plateau breaker 🔥", title: "Plateau breaker 🔥", subtitle: "Scale not moving? This combo got me through.", badge: "Testimonial", image: "" },
  { headline: "Best results", title: "Combo therapy", subtitle: "Great pairing — saw results within weeks.", badge: "Testimonial", image: "" },
  { headline: "Down 4 kg", title: "5 to 4.5", subtitle: "With consistency & patience, you'll reap what you sow.", badge: "Testimonial", image: "" },
  { headline: "Results", title: "Results", subtitle: "April to May progress update.", badge: "Testimonial", image: "" },
  { headline: "Energy is on 🔥", title: "NAD+ is on 🔥", subtitle: "Best energy boost — feels noticeable from day one.", badge: "Testimonial", image: "" },
  { headline: "Amazing results!", title: "Amazing results!", subtitle: "2 months of progress and counting.", badge: "Testimonial", image: "" },
];
