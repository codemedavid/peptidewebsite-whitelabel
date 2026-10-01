// Source of truth for the Pepweb / PepWorld Privacy Policy.
// PURE data module (no server-only imports), rendered by the marketing /privacy
// page and linked from the App Store listing. Edit the copy here.

import { SITE } from "@/marketing/config";
import { TERMS_META, type TermsSection } from "@/marketing/terms";

export const PRIVACY_META = {
  effectiveDate: "October 1, 2026",
  lastUpdated: "October 1, 2026",
  contactEmail: SITE.contactEmail,
  operator: TERMS_META.operator,
  businessName: TERMS_META.businessName,
  appName: "PepWorld",
};

export const PRIVACY_INTRO =
  "This Privacy Policy explains what information Pepweb (“we,” “us,” “our”) collects " +
  "through the PepWorld mobile app, the Pepweb websites, and the online stores we host " +
  "for our clients (together, the “Services”), how we use it, and the choices you have. " +
  "We collect only what we need to run your store or your orders, we never sell your " +
  "personal information, and we do not show ads or track you across other apps or websites.";

export const PRIVACY_SECTIONS: TermsSection[] = [
  {
    n: 1,
    title: "Who We Are and Our Role",
    blocks: [
      { type: "p", text: "Pepweb builds and hosts online stores for independent sellers (“Stores”). The PepWorld app lets Store owners and their staff manage their Store, and lets shoppers browse, order from, and chat with the Stores they use." },
      { type: "p", text: "When you shop with a Store, that Store decides what it does with your order and contact details and is responsible for it. We process that information on the Store’s behalf to provide the Services. For Store owner and staff accounts, and for the app itself, Pepweb is responsible for your information." },
    ],
  },
  {
    n: 2,
    title: "Information We Collect",
    blocks: [
      { type: "p", text: "Information you give us:" },
      { type: "ul", items: [
        "Account details: your name, nickname, email address, password (stored only as a one-way hash), and an optional profile photo.",
        "Order details: the items you order, your delivery name, phone number, delivery address, chosen courier, and any note you add at checkout.",
        "Payment confirmation: if you pay by bank transfer or e-wallet, the screenshot or photo of your payment receipt that you upload. We do not collect or store card numbers, and we do not process card payments in the app.",
        "Content you share: messages, photos, and documents you send in Store chats and community channels, and reviews you post.",
        "Store information (owners and staff): your Store’s products, prices, photos, orders, and settings.",
      ] },
      { type: "p", text: "Information collected automatically:" },
      { type: "ul", items: [
        "A push notification token, if you allow notifications, so we can alert you about orders and messages.",
        "Basic technical information needed to keep you signed in securely and fix problems, such as your device type, operating system version, app version, and the time of each request.",
      ] },
      { type: "p", text: "Camera and photo library access is used only when you choose to take or attach a photo, for example a payment receipt, product photo, or chat image. We never access your camera or photos in the background." },
    ],
  },
  {
    n: 3,
    title: "How We Use Your Information",
    blocks: [
      { type: "ul", items: [
        "To create and secure your account and keep you signed in.",
        "To place, process, deliver, and track your orders, and to let the Store confirm your payment.",
        "To send you notifications about your orders, your Store, and your messages.",
        "To run Store chats and community features you choose to use.",
        "To provide customer support and respond to your requests.",
        "To keep the Services safe, prevent fraud and abuse, and meet our legal obligations.",
      ] },
      { type: "p", text: "We do not use your information for advertising, we do not sell or rent it, and we do not build profiles of you for marketing by third parties." },
    ],
  },
  {
    n: 4,
    title: "How Information Is Shared",
    blocks: [
      { type: "p", text: "We share information only as needed to provide the Services:" },
      { type: "ul", items: [
        "With the Store you order from or chat with, so it can fulfil your order and reply to you.",
        "With service providers that host and run the Services for us, under contracts that require them to protect your information: cloud hosting (Vercel), database hosting (Supabase), image storage and delivery (ImageKit), push notification delivery (Expo and Apple Push Notification service), and transactional email delivery.",
        "With a courier, but only the delivery details the Store passes on to ship your order.",
        "When required by law, or to protect the rights, safety, and property of our users, Stores, or the public.",
      ] },
    ],
  },
  {
    n: 5,
    title: "Tracking",
    blocks: [
      { type: "p", text: "The PepWorld app does not track you. We do not link information collected in the app with third-party data for advertising, and we do not share it with data brokers. The app does not use advertising identifiers." },
    ],
  },
  {
    n: 6,
    title: "Data Retention",
    blocks: [
      { type: "p", text: "We keep your account information while your account is active. When you delete your account, we delete or anonymize your personal information. Order records, including the delivery details on them, are no longer linked to your account but may be kept by the Store for as long as it needs them for its accounting and legal obligations; you can ask the Store or us to erase them. Backups are overwritten on a rolling schedule." },
    ],
  },
  {
    n: 7,
    title: "Deleting Your Account",
    blocks: [
      { type: "p", text: "You can delete your account at any time inside the PepWorld app: open the More tab (or your Account screen), tap “Delete account,” and confirm with your password." },
      { type: "ul", items: [
        "Shopper accounts: your account, profile, password, and community data are deleted right away, your chat messages are removed, past orders are unlinked from you, and you are signed out on every device.",
        "Store owner and staff accounts: your request is sent to us, you are signed out on every device, and your account and Store data are deleted within 30 days, unless we must keep certain records by law.",
      ] },
      { type: "p", text: "You can also ask us to delete your information by emailing us at the address below." },
    ],
  },
  {
    n: 8,
    title: "Your Rights",
    blocks: [
      { type: "p", text: "Under the Philippine Data Privacy Act of 2012 (Republic Act No. 10173) and other laws that may apply to you, you have the right to be informed, to access your personal information, to correct it, to object to its processing, to have it erased or blocked, to data portability, and to file a complaint with the National Privacy Commission. To exercise any of these rights, contact us. If your request concerns an order with a particular Store, we will work with that Store to respond." },
    ],
  },
  {
    n: 9,
    title: "Security",
    blocks: [
      { type: "p", text: "We use encryption in transit (HTTPS), hashed passwords, short-lived sign-in tokens stored in your device’s secure storage, and per-Store data separation to protect your information. No system is perfectly secure, so please use a strong password and keep your device locked." },
    ],
  },
  {
    n: 10,
    title: "Children",
    blocks: [
      { type: "p", text: "The Services are intended for adults aged 18 and over. We do not knowingly collect information from children. If you believe a child has given us personal information, contact us and we will delete it." },
    ],
  },
  {
    n: 11,
    title: "Changes to This Policy",
    blocks: [
      { type: "p", text: "We may update this Privacy Policy from time to time. We will change the “Last Updated” date above and, for significant changes, let you know in the app or by email." },
    ],
  },
];
