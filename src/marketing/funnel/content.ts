// ============================================================================
// Peptide Business Automation System — sales funnel copy + data.
// Pure module (no "use server" / no JSX): the page and its reusable components
// import these typed arrays so all copy lives in one place. Icon values are
// lucide-react components (plain values, safe in a .ts module).
//
// Voice: conversational Taglish for the emotional sections (problem → vision),
// clean English for feature/benefit labels. All original copy.
// ============================================================================

import type { LucideIcon } from "lucide-react";
import {
  MessageCircleQuestion,
  FileText,
  PackageSearch,
  ShieldQuestion,
  Inbox,
  MoonStar,
  TrendingDown,
  Hourglass,
  Flame,
  Users,
  Bot,
  Layers,
  Sparkles,
  Globe,
  LayoutGrid,
  HelpCircle,
  FolderOpen,
  FileCheck2,
  Send,
  Database,
  Smartphone,
  BarChart3,
  Workflow,
  Clock,
  BadgeCheck,
  FolderTree,
  Smile,
  Rocket,
} from "lucide-react";

export type IconItem = { icon: LucideIcon; title: string; body: string };

// ──────────────────────────── Hero ────────────────────────────
export const HERO = {
  chip: "Peptide Business Automation System",
  headline1: "Stop Being The Customer Support",
  headlineAccent: "Of Your Own Peptide Business",
  sub: "Your system shows your products, answers the same questions, and hands out your COAs and info 24/7 — para ikaw na ulit ang boss, hindi ang reply machine. Mas kaunting chat, mas maraming oras para palaguin ang negosyo.",
  primaryCta: "Get Started",
  secondaryCta: "See How It Works",
  bullets: [
    "Auto-sagot sa paulit-ulit na tanong",
    "Products at COAs, organized at presentable",
    "Serious buyers lang ang aabot sa’yo",
    "Mukhang legit at propesyonal ang brand mo",
  ],
  trust: ["Built for PH peptide sellers", "Set up in days, not months", "Gumagana sa kahit anong phone"],
} as const;

// ──────────────────────────── Section 2 — The Problem ────────────────────────────
export const PROBLEMS: IconItem[] = [
  { icon: MessageCircleQuestion, title: "“Magkano po?”", body: "Same question, pang-40 na today. Copy-paste ka na lang ng copy-paste." },
  { icon: FileText, title: "“Pa-send po ng COA”", body: "Hinahanap mo pa sa files, ise-send mong isa-isa — paulit-ulit, araw-araw." },
  { icon: PackageSearch, title: "“May stock pa po ba?”", body: "Kahit 11PM na, naka-standby ka pa rin para mag-check ng inventory." },
  { icon: ShieldQuestion, title: "“Legit po ba kayo?”", body: "Kailangan mo pang patunayan ang sarili mo bago pa man bumili." },
  { icon: Inbox, title: "Sobrang dami ng DMs", body: "Naiipon ang messages, nauubos ang araw mo, wala ka pang nabebenta." },
  { icon: MoonStar, title: "Pag offline ka, sarado", body: "Pag hindi ka nakareply on time, parang nakapinid ang tindahan mo." },
];

// ──────────────────────────── Section 3 — The Hidden Cost ────────────────────────────
export const COST_STEPS = [
  { value: "3 hrs", label: "kada araw na nakaupo sa chat" },
  { value: "90 hrs", label: "kada buwan na napupunta sa replies" },
  { value: "1,080 hrs", label: "kada taon — mahigit 6 na linggo ng full-time" },
] as const;

export const COSTS: IconItem[] = [
  { icon: TrendingDown, title: "Lost leads", body: "Di nasagot agad? Nasa kakompetensya mo na ang pera. Time-sensitive ang buyer." },
  { icon: Hourglass, title: "Slower growth", body: "Walang oras mag-source, mag-market, o mag-expand — puno ang araw mo sa tanong." },
  { icon: Flame, title: "Burnout", body: "Laging naka-standby, parang on-call doctor. Hindi ka na talaga nag-o-off." },
  { icon: Users, title: "Missed opportunities", body: "Yung malalaking buyer na sana repeat customer — na-overlook sa dami ng inbox." },
];

// ──────────────────────────── Section 5 — Future Vision ────────────────────────────
export const VISION: IconItem[] = [
  { icon: Sparkles, title: "Nasasagot na sila kahit wala ka", body: "Products, presyo, FAQs, COAs — nandoon lahat. Hindi na kailangang mag-abang sa reply mo." },
  { icon: FolderTree, title: "Organized ang lahat ng info", body: "Isang link lang, kumpleto na. Walang hanapan, walang paulit-ulit na paliwanag." },
  { icon: Layers, title: "Smoother ang operations", body: "Walang magulong inbox, walang nakakalimutang order. May sistema kang masasandalan." },
  { icon: Clock, title: "Mas kaunting manual work", body: "Magising ka na may bagong inquiries na — hindi backlog ng paulit-ulit na tanong." },
];

// ──────────────────────────── Section 6 — Solution positioning ────────────────────────────
export const SOLUTION_CARDS: IconItem[] = [
  { icon: Bot, title: "A 24/7 digital employee", body: "Hindi humihingi ng off, hindi nagkakasakit, hindi nagrereklamo. Trabaho lang nang trabaho." },
  { icon: LayoutGrid, title: "A complete business system", body: "Hindi lang website, hindi lang software — display, organize, answer, at filter, all-in-one." },
  { icon: BadgeCheck, title: "Built around peptide sellers", body: "COA-ready, catalog-ready, inquiry-ready. Ginawa para sa paraan ng pagbenta mo." },
];

// ──────────────────────────── Section 7 — How it works ────────────────────────────
export const STEPS = [
  { n: "01", title: "Visitor arrives", body: "Makikita nila ang professional, branded storefront mo — hindi makalat na chat thread." },
  { n: "02", title: "Views products & info", body: "Babasahin nila ang catalog, presyo, at details — kasing linaw ng totoong tindahan." },
  { n: "03", title: "Gets answers", body: "Common questions, COAs, at resources — sagot na bago pa sila mag-message." },
  { n: "04", title: "Submits an inquiry", body: "Pag seryoso na, mag-i-inquire o mag-o-order sila — organized at handa nang i-process." },
  { n: "05", title: "You handle serious buyers", body: "Ikaw na lang ang papasok sa mga ready-to-buy. No more paulit-ulit na ‘magkano po?’." },
] as const;

// ──────────────────────────── Section 8 — Benefits ────────────────────────────
export const BENEFITS: IconItem[] = [
  { icon: Workflow, title: "Less Repetitive Work", body: "The system absorbs the questions you answer a hundred times a day." },
  { icon: Clock, title: "More Time Freedom", body: "Get your hours back — for growth, for family, for actually living." },
  { icon: BadgeCheck, title: "Professional Brand Image", body: "Look like the established brand you are — clean, organized, and trustworthy." },
  { icon: FolderTree, title: "Organized Operations", body: "Products, COAs, inquiries, and records — all in one tidy place." },
  { icon: Smile, title: "Better Customer Experience", body: "Buyers get instant answers, clear info, and a smooth way to order." },
  { icon: Rocket, title: "A Business That Scales", body: "Grow your sales without growing the hours you personally pour in." },
];

// ──────────────────────────── Section 9 — Features ────────────────────────────
export const FEATURES: IconItem[] = [
  { icon: Globe, title: "Custom Branded Website", body: "Your logo, colors, and identity — a storefront that's unmistakably yours." },
  { icon: LayoutGrid, title: "Product Catalog", body: "Display every product with photos, prices, and details, beautifully organized." },
  { icon: HelpCircle, title: "FAQ System", body: "Answer the repeat questions once — then let the system answer them forever." },
  { icon: FolderOpen, title: "Resource Library", body: "Guides, dosing info, and docs in one central, easy-to-find place." },
  { icon: FileCheck2, title: "COA Organization", body: "Every certificate of analysis, sorted and instantly accessible to customers." },
  { icon: Send, title: "Customer Inquiry System", body: "Capture serious inquiries cleanly — no more lost messages in the DMs." },
  { icon: Database, title: "CRM Integration", body: "Keep customer records and history organized so you can sell smarter." },
  { icon: Smartphone, title: "Mobile Responsive Design", body: "Flawless on every phone — where your customers actually shop." },
  { icon: BarChart3, title: "Analytics Dashboard", body: "See what's working — views, inquiries, and demand at a glance." },
  { icon: Workflow, title: "Automation Workflows", body: "Repetitive steps run themselves so your day runs on autopilot." },
];

// ──────────────────────────── Section 10 — Value stack ────────────────────────────
export const VALUE_STACK = [
  { item: "Custom Branded Website", value: "₱25,000" },
  { item: "Professional Product Catalog", value: "₱15,000" },
  { item: "FAQ + Inquiry Automation", value: "₱20,000" },
  { item: "COA & Resource Library", value: "₱12,000" },
  { item: "CRM + Customer Records", value: "₱18,000" },
  { item: "Analytics Dashboard", value: "₱10,000" },
  { item: "Automation Workflows", value: "₱15,000" },
] as const;

export const VALUE_TOTAL = "₱115,000+";

// ──────────────────────────── Section 11 — FAQ ────────────────────────────
export type Faq = { q: string; a: string };

export const FAQS: Faq[] = [
  {
    q: "Hindi ako techy — kaya ko ba ’to?",
    a: "Oo. Done-for-you ang setup — kami ang magbubuo ng system mo. Ikaw, ire-review mo lang at sasabihin kung ano ang gusto mong palitan. Walang coding, walang kaba.",
  },
  {
    q: "May Facebook page na ako — bakit pa ’to?",
    a: "Para sa reach ang Facebook. Para sa sistema naman ’to. Dito naka-organize lahat — searchable, presentable, at bukas 24/7. Magkatuwang sila: ang FB ang nagdadala ng tao, ang system mo ang sumasagot at nagbebenta.",
  },
  {
    q: "Papalitan ba nito ang team ko?",
    a: "Hindi. Inaalis nito ang paulit-ulit na trabaho para ang team mo ay maka-focus sa mga seryosong buyer at sa paglago — hindi sa pag-copy-paste ng parehong sagot buong araw.",
  },
  {
    q: "Pwede ko bang i-update ang products?",
    a: "Anytime. Mula sa isang simpleng dashboard, pwede kang mag-add, mag-edit, o mag-remove ng products, presyo, at photos — walang kailangang developer.",
  },
  {
    q: "Gaano katagal ang setup?",
    a: "Karaniwang ilang araw lang matapos ang onboarding at matanggap namin ang details mo. Depende sa laki ng catalog, pero hindi months — days lang.",
  },
  {
    q: "Makikipag-usap pa rin ba sa’kin ang customers?",
    a: "Oo, pero ibang usapan na. Ang aabot sa’yo ay ang mga seryosong buyer na ready nang bumili — hindi na yung paulit-ulit na ‘magkano po?’ at ‘legit po ba?’.",
  },
  {
    q: "Paano ang COAs at documents?",
    a: "Centralized sila sa resource library. Hahanapin at makikita ng customers ang COAs nang mag-isa — wala ka nang ise-send nang isa-isa.",
  },
  {
    q: "Safe ba ang info ng business ko?",
    a: "Oo. Sa’yo ang system at sa’yo ang data. Organized, private, at ikaw ang may kontrol kung ano ang ipapakita sa publiko.",
  },
  {
    q: "Para lang ba ’to sa malalaking seller?",
    a: "Hindi. Para ’to sa kahit sinong pagod na maging 24/7 support — nagsisimula ka man o lumalago na. Mas maaga mong i-set up, mas maaga mong mababawi ang oras mo.",
  },
  {
    q: "Paano ako magsisimula?",
    a: "I-click ang Get Started, sagutin ang ilang simpleng tanong tungkol sa business mo, at kami na ang bahala sa setup. Ilang minuto lang para magsimula.",
  },
];

// ──────────────────────────── Section 12 — Final comparison ────────────────────────────
export const COMPARE = {
  manual: {
    title: "Manual lang lahat",
    points: [
      "Ikaw pa rin ang sasagot ng bawat tanong",
      "Nawawala ang leads tuwing busy o tulog ka",
      "Walang oras para mag-grow o mag-source",
      "Naka-tali sa phone, 24/7, walang off",
      "Umaasa ang buong business sa presence mo",
    ],
  },
  automated: {
    title: "May system na tumatakbo",
    points: [
      "Sumasagot ang system para sa’yo, 24/7",
      "Serious buyers lang ang aabot sa’yo",
      "May oras ka nang mag-scale at mag-market",
      "Tumatakbo ang business kahit tulog ka",
      "Hindi na umaasa sa’yo ang bawat sale",
    ],
  },
} as const;
