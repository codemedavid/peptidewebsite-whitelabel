/* ============================================================
   Client-safe onboarding constants + view types.

   These are shared by both server code (onboarding-data.ts, the
   admin-onboarding server actions) and CLIENT components
   (OnboardingList/OnboardingDetail). They must NOT live in the
   `server-only` data module, or importing them into a client
   component fails the build — so they sit here, free of any
   server-only / Prisma imports.
   ============================================================ */

// The operator's setup workflow (per the product spec). Shared by the UI + actions.
export const ONBOARDING_STATUSES = [
  "payment_received",
  "tenant_created",
  "customizing",
  "revision",
  "completed",
] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const ONBOARDING_STATUS_LABELS: Record<string, string> = {
  payment_received: "Payment Received",
  tenant_created: "Tenant Created",
  customizing: "Customizing",
  revision: "Revision Phase",
  completed: "Completed",
};

export type OnboardingProductView = {
  name: string;
  price: number;
  description?: string;
  category?: string;
  imageUrl?: string;
};
export type OnboardingPaymentView = {
  name: string;
  account?: string;
  number?: string;
  qrUrl?: string;
  instructions?: string;
};

export type OnboardingSummary = {
  id: string;
  businessName: string;
  email: string;
  contactPerson: string;
  slug: string;
  url: string;
  packageKey: string;
  packageLabel: string;
  setupStatus: string;
  setupStatusLabel: string;
  tenantId: string | null;
  tenantStatus: string | null; // pending_setup | active | suspended | …
  published: boolean;
  productCount: number;
  paymentProofUrl: string | null;
  createdAt: string; // ISO
};

export type OnboardingDetailView = OnboardingSummary & {
  businessType: string;
  description: string;
  whatsapp: string;
  facebook: string;
  themeStyle: string | null;
  themeId: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoUrl: string | null;
  bannerUrls: string[];
  inspirationUrls: string[];
  inspirationNotes: string;
  products: OnboardingProductView[];
  orderDestination: string | null;
  orderDestinationValue: string | null;
  paymentMethods: OnboardingPaymentView[];
  termsAccepted: boolean;
};
