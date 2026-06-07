"use client";

// Model + state for the onboarding wizard: the draft shape, step metadata, the
// option catalogs, per-step validation, the draft → submit-payload mapping, and
// a hook that owns the draft (with localStorage persistence so a mid-flow refresh
// survives). The wizard component drives step navigation + submission.

import { useCallback, useEffect, useState } from "react";
import type { OnboardingPayload } from "@/lib/onboarding/schema";

export type DraftProduct = {
  name: string;
  price: string; // kept as string for the input; coerced on submit
  description: string;
  category: string;
  imageUrl: string;
};

export type DraftPayment = {
  name: string;
  account: string;
  number: string;
  qrUrl: string;
  instructions: string;
};

export type Draft = {
  // 1 — business
  businessName: string;
  businessType: string;
  description: string;
  contactPerson: string;
  email: string;
  whatsapp: string;
  facebook: string;
  // 2 — branding
  themeStyle: string;
  themeId: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
  bannerUrls: string[];
  inspirationUrls: string[];
  inspirationNotes: string;
  // 3 — products
  products: DraftProduct[];
  // 4 — order destination
  orderDestination: "whatsapp" | "messenger" | "telegram" | "email";
  orderDestinationValue: string;
  // 5 — payment methods
  paymentMethods: DraftPayment[];
  // 6 — package
  packageKey: string;
  // 7 — checkout
  paymentProofUrl: string;
  termsAccepted: boolean;
  // anti-spam honeypot
  website: string;
};

export const emptyProduct = (): DraftProduct => ({
  name: "",
  price: "",
  description: "",
  category: "",
  imageUrl: "",
});

export const INITIAL_DRAFT: Draft = {
  businessName: "",
  businessType: "",
  description: "",
  contactPerson: "",
  email: "",
  whatsapp: "",
  facebook: "",
  themeStyle: "minimal",
  themeId: "clinical-white",
  primaryColor: "#B0345E",
  secondaryColor: "#E94B7D",
  logoUrl: "",
  bannerUrls: [],
  inspirationUrls: [],
  inspirationNotes: "",
  products: [emptyProduct()],
  orderDestination: "whatsapp",
  orderDestinationValue: "",
  paymentMethods: [],
  packageKey: "starter",
  paymentProofUrl: "",
  termsAccepted: false,
  website: "",
};

export const STEPS = [
  { key: "business", title: "Business information", subtitle: "Tell us who you are and how to reach you." },
  { key: "branding", title: "Branding & design", subtitle: "Pick a style and your brand colors." },
  { key: "products", title: "Products", subtitle: "Add what you sell — you can add more later." },
  { key: "orders", title: "Order destination", subtitle: "Where should customer orders go?" },
  { key: "payments", title: "Payment methods", subtitle: "How will customers pay you?" },
  { key: "package", title: "Choose your package", subtitle: "Pick the plan that fits your business." },
  { key: "checkout", title: "Checkout & terms", subtitle: "Pay, upload your proof, and submit." },
] as const;

export const THEME_STYLE_OPTIONS = [
  { id: "minimal", label: "Minimal", desc: "Clean, lots of whitespace, modern.", themeId: "clinical-white", icon: "Minus" },
  { id: "luxury", label: "Luxury / Clean", desc: "Elegant and premium, serif accents.", themeId: "clinical-white", icon: "Gem" },
  { id: "ecommerce", label: "Modern E-commerce", desc: "Bright, conversion-focused catalog.", themeId: "clinical-white", icon: "ShoppingBag" },
  { id: "dark", label: "Dark Mode", desc: "Sleek dark surfaces, high contrast.", themeId: "midnight-lab", icon: "Moon" },
  { id: "custom", label: "Custom", desc: "Start neutral — we'll tailor it to your pegs.", themeId: "clinical-white", icon: "Wand2" },
] as const;

export const ORDER_DESTINATION_OPTIONS = [
  { id: "whatsapp", label: "WhatsApp", desc: "Orders sent to your WhatsApp.", icon: "MessageCircle", placeholder: "e.g. 639171234567", hint: "International format, digits only." },
  { id: "messenger", label: "Messenger", desc: "Orders open in Messenger.", icon: "MessagesSquare", placeholder: "e.g. yourpage", hint: "Your Facebook page username." },
  { id: "telegram", label: "Telegram", desc: "Orders sent to Telegram.", icon: "Send", placeholder: "e.g. yourstore", hint: "Username, with or without @." },
  { id: "email", label: "Email", desc: "Orders emailed to you.", icon: "Mail", placeholder: "e.g. orders@store.com", hint: "Where order emails should land." },
] as const;

export const PAYMENT_PRESETS = ["GCash", "Maya", "Bank Transfer", "PayPal", "QR Payments", "Crypto"] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Per-step validation. Returns a field→message map (empty = valid). */
export function validateStep(step: number, d: Draft): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 0) {
    if (d.businessName.trim().length < 2) e.businessName = "Please enter your business name.";
    if (!EMAIL_RE.test(d.email.trim())) e.email = "Please enter a valid email address.";
  }
  if (step === 2) {
    d.products.forEach((p, i) => {
      if (p.name.trim() && !(Number(p.price) >= 0 && p.price !== "")) {
        e[`product-${i}`] = "Add a price for this product.";
      }
    });
  }
  if (step === 3) {
    if (!d.orderDestinationValue.trim()) e.orderDestinationValue = "Add where orders should go.";
  }
  if (step === 5) {
    if (!d.packageKey) e.packageKey = "Please choose a package.";
  }
  if (step === 6) {
    if (!d.paymentProofUrl) e.paymentProofUrl = "Please upload your proof of payment.";
    if (!d.termsAccepted) e.termsAccepted = "Please accept the terms to continue.";
  }
  return e;
}

/** Map the UI draft into the server action payload. */
export function draftToPayload(d: Draft): OnboardingPayload {
  return {
    businessName: d.businessName.trim(),
    businessType: d.businessType.trim(),
    description: d.description.trim(),
    contactPerson: d.contactPerson.trim(),
    email: d.email.trim(),
    whatsapp: d.whatsapp.trim(),
    facebook: d.facebook.trim(),
    themeStyle: (d.themeStyle as OnboardingPayload["themeStyle"]) ?? undefined,
    themeId: d.themeId,
    primaryColor: d.primaryColor,
    secondaryColor: d.secondaryColor,
    logoUrl: d.logoUrl,
    bannerUrls: d.bannerUrls,
    inspirationUrls: d.inspirationUrls,
    inspirationNotes: d.inspirationNotes.trim(),
    products: d.products
      .filter((p) => p.name.trim())
      .map((p) => ({
        name: p.name.trim(),
        price: Number(p.price) || 0,
        description: p.description.trim(),
        category: p.category.trim(),
        imageUrl: p.imageUrl,
      })),
    orderDestination: d.orderDestination,
    orderDestinationValue: d.orderDestinationValue.trim(),
    paymentMethods: d.paymentMethods.map((m) => ({
      name: m.name.trim(),
      account: m.account.trim(),
      number: m.number.trim(),
      qrUrl: m.qrUrl,
      instructions: m.instructions.trim(),
    })),
    packageKey: d.packageKey,
    paymentProofUrl: d.paymentProofUrl,
    termsAccepted: d.termsAccepted,
    website: d.website,
  };
}

/** Upload one image to the public onboarding endpoint; returns its hosted URL. */
export async function uploadOnboardingImage(file: File, kind: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);
  const res = await fetch("/api/onboarding/upload", { method: "POST", body: fd });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error || "Upload failed.");
  return data.url;
}

const STORAGE_KEY = "jonina-onboarding-draft";

/** Draft state with best-effort localStorage persistence. */
export function useOnboardingDraft(initialPlan?: string) {
  const [draft, setDraft] = useState<Draft>(INITIAL_DRAFT);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<Draft>;
        setDraft((d) => ({ ...d, ...parsed }));
      }
    } catch {
      /* ignore */
    }
    if (initialPlan && ["starter", "pro", "enterprise"].includes(initialPlan)) {
      setDraft((d) => ({ ...d, packageKey: initialPlan }));
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      // Don't persist the honeypot or terms acceptance.
      const { website, termsAccepted, ...rest } = draft;
      void website;
      void termsAccepted;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    } catch {
      /* ignore */
    }
  }, [draft, hydrated]);

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { draft, update, clearDraft, hydrated };
}
