// Source of truth for the Pepweb Terms & Conditions.
// PURE data module (no server-only imports) so the marketing /terms page renders
// it and other surfaces can link to it. Edit the copy here; the page renders it.

import { SITE } from "@/marketing/config";

// Operator-editable header/contact details.
export const TERMS_META = {
  effectiveDate: "June 16, 2026",
  lastUpdated: "June 16, 2026",
  contactEmail: SITE.contactEmail,
  operator: "Ma. Jonina Donaire",
  businessName: "Pepweb",
};

export type TermsBlock =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "note"; text: string };

export type TermsSection = { n: number; title: string; blocks: TermsBlock[] };

export const TERMS_INTRO =
  "These Terms & Conditions (the “Terms”) explain how Pepweb " +
  "(“we,” “us,” “our,” or the “Developer”) works with you (“you,” “your,” " +
  "or the “Client”) when you visit our website, request a quote, or purchase any of " +
  "our website packages and services. We’ve kept them clear and friendly — our goal " +
  "is a great relationship built on trust.";

export const TERMS_SECTIONS: TermsSection[] = [
  {
    n: 1,
    title: "Agreement to These Terms",
    blocks: [
      { type: "p", text: "By browsing our website, requesting a quote, placing an order, or using any service we provide, you confirm that you have read, understood, and agreed to these Terms. If you do not agree with any part of them, please do not use our services." },
      { type: "p", text: "Where you sign a separate Service Agreement for a specific package, that Service Agreement and these Terms work together. If anything in your signed Service Agreement conflicts with these Terms, the Service Agreement takes precedence for that project." },
    ],
  },
  {
    n: 2,
    title: "A Few Key Terms",
    blocks: [
      { type: "ul", items: [
        "Developer — Pepweb, operated by Ma. Jonina Donaire.",
        "Client — the individual or business that purchases or uses our services.",
        "Services — website design, development, delivery, hosting setup, optional care plans, and related work we provide.",
        "Deliverables — the completed website and related items we hand over to you.",
      ] },
    ],
  },
  {
    n: 3,
    title: "Our Services",
    blocks: [
      { type: "p", text: "We design, build, and deliver website packages — including peptide ordering websites and related features — along with optional ongoing care. The specific features, inclusions, and price for your project are set out in your quote and/or signed Service Agreement." },
      { type: "p", text: "We provide the website technology and the work described in your package. We do not supply, sell, endorse, test, or take responsibility for the products you choose to sell through your website." },
    ],
  },
  {
    n: 4,
    title: "Quotes, Selections & Project Confirmation",
    blocks: [
      { type: "ul", items: [
        "Quotes are based on the scope and features discussed at the time and are valid for the period stated in the quote.",
        "Where a package lets you choose optional features, your selections will be confirmed in writing before development begins.",
        "Additional features requested after confirmation may extend timelines and will be quoted separately based on the functionality involved.",
      ] },
    ],
  },
  {
    n: 5,
    title: "Fees, Payment & Taxes",
    blocks: [
      { type: "ul", items: [
        "All fees are stated in Philippine Pesos (₱) unless we agree otherwise in writing.",
        "Package fees, optional plan fees, custom-domain fees, and any add-ons are set out in your quote or Service Agreement.",
        "Work begins once payment (or the agreed initial payment) is received, unless we arrange otherwise.",
        "You are responsible for any taxes, bank charges, or transfer fees that apply to your payment.",
        "Optional recurring plans (such as a monthly care plan) continue until you ask us to pause or cancel them.",
      ] },
    ],
  },
  {
    n: 6,
    title: "Optional Growth & Care Plan",
    blocks: [
      { type: "p", text: "We offer an optional monthly Growth & Care Plan that adds extra protection and room for your store, such as automatic backups, additional storage, and a lower-to-zero downtime experience. It is entirely optional, billed monthly, and you can stop it at any time. If you choose not to use it, your website continues to run — you simply won’t have the plan’s added safeguards." },
    ],
  },
  {
    n: 7,
    title: "Domains",
    blocks: [
      { type: "ul", items: [
        "Eligible packages include a free subdomain that we configure and connect for you before launch.",
        "If you prefer a custom domain, an additional one-time fee applies to cover registration, setup, and initial configuration.",
        "After the first year, domain renewal fees are your responsibility and are charged at the applicable renewal rate. We’ll give you a friendly heads-up before anything is due.",
      ] },
    ],
  },
  {
    n: 8,
    title: "Your Responsibilities & Cooperation",
    blocks: [
      { type: "p", text: "So we can deliver and support your store well, you agree to:" },
      { type: "ul", items: [
        "Provide accurate content in good time — product information, images, Certificates of Analysis (COAs), protocol content (if selected), and business details.",
        "Maintain your own accounts and credentials, including WhatsApp, payment, email, and any third-party accounts your business uses.",
        "Review the website on delivery and let us know promptly of anything that doesn’t match your agreed scope.",
        "Keep your store active — for sites on a free-tier database, we recommend visiting your website at least once a week.",
        "Delays in providing content or approvals may affect your delivery timeline.",
      ] },
    ],
  },
  {
    n: 9,
    title: "Acceptable Use & Legal Compliance",
    blocks: [
      { type: "p", text: "Your business and the products you sell are yours to operate and yours to keep lawful. You agree that:" },
      { type: "ul", items: [
        "You will use our Services and your website only for lawful purposes.",
        "You are solely responsible for ensuring your products, claims, labeling, marketing materials, and business operations comply with all applicable laws, regulations, and platform rules.",
        "You will not use the website or our Services to mislead customers, infringe others’ rights, or distribute unlawful, harmful, or prohibited content.",
      ] },
      { type: "note", text: "Important: We provide website technology only. We do not manufacture, supply, verify, or endorse any peptide or other product sold through your website, and we make no representations about their safety, legality, or fitness for any purpose. Full responsibility for your products, claims, and how your business is run rests with you." },
    ],
  },
  {
    n: 10,
    title: "Delivery, Ownership & Access",
    blocks: [
      { type: "ul", items: [
        "On completion, we deliver your fully built, live website and your account to manage and operate the store.",
        "Once delivered and live, the completed website is fully owned and operated by you.",
        "On request, we will provide your source code and the credentials for your Supabase account.",
        "To keep your store stable, changes to the source code are made by us by default. You may engage another developer at any time; if a different developer changes the source code and an issue results from those changes, that developer is responsible for them.",
      ] },
    ],
  },
  {
    n: 11,
    title: "Edits, Support & Bug Fixes",
    blocks: [
      { type: "p", text: "We stand behind our work. Our support covers website bugs, website errors, store functionality issues, and minor adjustments. If you run into an error or bug, we’ll work on it as soon as possible at no additional charge for the fix. New features or larger changes outside the original scope are quoted separately." },
    ],
  },
  {
    n: 12,
    title: "Final Sale & Refunds",
    blocks: [
      { type: "p", text: "Because each website is custom work created specifically for you, all sales are final and package fees are non-refundable once paid. In return, our support commitment ensures that issues with the delivered work are taken care of, so the value of your package keeps working for you long after launch." },
    ],
  },
  {
    n: 13,
    title: "Third-Party Services",
    blocks: [
      { type: "p", text: "Your website may rely on third-party services such as a database provider (e.g., Supabase), domain registrars, payment providers, and messaging tools (e.g., WhatsApp). These services are governed by their own terms, and we are not responsible for their availability, pricing changes, policy changes, or outages that are outside our control. We’ll always do what we reasonably can to help you navigate any such changes." },
    ],
  },
  {
    n: 14,
    title: "Intellectual Property",
    blocks: [
      { type: "ul", items: [
        "On full payment and delivery, you own the completed website and the content you provided.",
        "Any underlying tools, frameworks, reusable components, or know-how we use to build websites remain ours, and we may reuse them for other projects.",
        "You confirm that any content you provide (text, images, COAs, logos, etc.) is yours to use or properly licensed, and does not infringe anyone else’s rights.",
      ] },
    ],
  },
  {
    n: 15,
    title: "Confidentiality",
    blocks: [
      { type: "p", text: "Each of us will keep the other’s private business information confidential and use it only as needed to deliver and support the Services. This does not apply to information that is public, already known, or required to be disclosed by law." },
    ],
  },
  {
    n: 16,
    title: "Data, Backups & Peace of Mind",
    blocks: [
      { type: "ul", items: [
        "We take great care with your store, but we are not responsible for data deleted by you or your staff, or for losses caused by changes in third-party platforms or technologies outside our control.",
        "The optional Growth & Care Plan adds automatic backups and extra safeguards — the easiest way to stay protected as you grow.",
        "If a free-tier database pauses from inactivity, we can reactivate it promptly at your request.",
      ] },
    ],
  },
  {
    n: 17,
    title: "Disclaimers",
    blocks: [
      { type: "p", text: "We deliver our Services with genuine care and skill. Beyond what is expressly stated in these Terms and your Service Agreement, the Services and Deliverables are provided “as is,” and we do not guarantee that your website will be uninterrupted or error-free at all times, or that your business will achieve any particular result, sales, or revenue." },
    ],
  },
  {
    n: 18,
    title: "Limitation of Liability",
    blocks: [
      { type: "p", text: "To the fullest extent permitted by law, we will not be liable for indirect, incidental, or consequential losses (such as lost profits, lost data, or lost business). Our total liability for any claim connected to the Services will not exceed the total fees you paid to us for the specific project giving rise to the claim. Nothing in these Terms limits any liability that cannot lawfully be limited." },
    ],
  },
  {
    n: 19,
    title: "Indemnity",
    blocks: [
      { type: "p", text: "You agree to cover and hold us harmless from claims, losses, or costs arising out of your products, your claims or marketing, your content, your use of the website, or your breach of these Terms — since these are matters within your control, not ours." },
    ],
  },
  {
    n: 20,
    title: "Term & Termination",
    blocks: [
      { type: "ul", items: [
        "These Terms apply whenever you use our Services and continue while any project, plan, or support is ongoing.",
        "You may cancel an optional recurring plan at any time; one-time package fees remain non-refundable as set out above.",
        "We may suspend or stop providing Services if these Terms are seriously or repeatedly breached, or if continuing would be unlawful.",
      ] },
    ],
  },
  {
    n: 21,
    title: "Changes to These Terms",
    blocks: [
      { type: "p", text: "We may update these Terms from time to time — for example, to reflect new features or legal requirements. The latest version will carry an updated “Last Updated” date, and continued use of our Services after a change means you accept the updated Terms." },
    ],
  },
  {
    n: 22,
    title: "Governing Law & Disputes",
    blocks: [
      { type: "p", text: "These Terms are governed by the laws of the Republic of the Philippines. We’ll always try to resolve any concern with you directly and in good faith first. If a dispute cannot be resolved informally, it will be handled by the appropriate courts of the Philippines." },
    ],
  },
  {
    n: 23,
    title: "General",
    blocks: [
      { type: "ul", items: [
        "These Terms, together with your quote and signed Service Agreement, reflect the full understanding between us.",
        "If any single term is found unenforceable, the rest remain in full effect.",
        "A delay in enforcing a term is not a waiver of it.",
        "You may not transfer your agreement with us to someone else without our written consent.",
        "Notices can be sent using the contact details below.",
      ] },
    ],
  },
];
