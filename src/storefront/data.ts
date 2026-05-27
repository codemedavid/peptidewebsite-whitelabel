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

export const SEED_ORDERS: Order[] = [
  {
    id: "BRC-2843", status: "new", paymentStatus: "pending", paymentMethod: "GCash",
    date: "2026-05-27T03:10:40",
    customer: { name: "Love Gabuat", email: "gabuatlovemarie@gmail.com", phone: "09270832083", contactMethod: "Instagram" },
    shipping: { address: "Blk 46 Lot 13, Phase 1, San Lorenzo Village", barangay: "Puan", city: "Davao", province: "Davao del Sur", postal: "8000", country: "Philippines", region: "MINDANAO", fee: 100 },
    courier: "LBC Express", trackingNumber: "", shippingNote: "",
    items: [{ name: "Tirzepatide 15mg (kit)", qty: 1, price: 1500 }],
    paymentProof: null,
  },
  {
    id: "BRC-8260", status: "new", paymentStatus: "pending", paymentMethod: "GCash",
    date: "2026-05-26T22:18:33",
    customer: { name: "Jewel Rose De Asis barrios", email: "barriosjewel@gmail.com", phone: "09171234567", contactMethod: "Instagram" },
    shipping: { address: "123 Sample Street, Phase 2", barangay: "Pinyahan", city: "Quezon City", province: "Metro Manila", postal: "1100", country: "Philippines", region: "LUZON", fee: 180 },
    courier: "J&T Express", trackingNumber: "", shippingNote: "",
    items: [
      { name: "Tirzepatide 30mg (kit)", qty: 1, price: 2500 },
      { name: "10pcs 10ml BacWater", qty: 30, price: 92.67 },
    ],
    paymentProof: null,
  },
  {
    id: "BRC-3905", status: "processing", paymentStatus: "paid", paymentMethod: "GCash",
    date: "2026-05-26T05:20:48",
    customer: { name: "Thealyssa Sonia Castro", email: "thealyssasoniacastro@icloud.com", phone: "09181234567", contactMethod: "Instagram" },
    shipping: { address: "45 Riverside Drive", barangay: "Lahug", city: "Cebu City", province: "Cebu", postal: "6000", country: "Philippines", region: "VISAYAS", fee: 150 },
    courier: "LBC Express", trackingNumber: "LBC123456789", shippingNote: "Shipped via LBC Express",
    items: [
      { name: "Tirzepatide 30mg (kit)", qty: 1, price: 2500 },
      { name: "5-Amino (kit)", qty: 1, price: 1400 },
    ],
    paymentProof: null,
  },
];

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
    category: "Weight Management", name: "Sample Protocol A",
    dosage: "Low → titrate up", frequency: "Once weekly", duration: "12-16 weeks per cycle",
    notes: ["Start with lowest dose for first 4 weeks", "Increase gradually as tolerated", "Take with or without food"],
    storage: "Refrigerate at 2-8°C. Once in use, can be kept at room temperature for up to 21 days.",
  },
  {
    category: "Beauty & Anti-Aging", name: "Sample Protocol B",
    dosage: "1-2mg daily", frequency: "Once daily", duration: "8-12 weeks",
    notes: ["Apply consistently", "Avoid combining with retinoids during early weeks"],
    storage: "Refrigerate. Stable for 28 days reconstituted.",
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
