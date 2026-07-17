import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { planMeta } from "@/lib/admin/plans";
import {
  isDemoMode,
  listDemoOnboarding,
  getDemoOnboarding,
  type DemoOnboardingSubmission,
} from "@/lib/demo/fixtures";
import {
  ONBOARDING_STATUS_LABELS,
  type OnboardingProductView,
  type OnboardingPaymentView,
  type OnboardingSummary,
  type OnboardingDetailView,
} from "@/lib/admin/onboarding-types";
import { STARTER_FEATURE_LABELS, type StarterFeatureKey } from "@/lib/onboarding/schema";

/* ============================================================
   Self-serve onboarding submissions — read models for the
   Super Admin "Onboarding" dashboard.

   The shared constants + view types live in the client-safe
   `onboarding-types` module (so the client components can import
   them too); re-exported here for existing server-side imports.
   ============================================================ */

export {
  ONBOARDING_STATUSES,
  ONBOARDING_STATUS_LABELS,
} from "@/lib/admin/onboarding-types";
export type {
  OnboardingStatus,
  OnboardingProductView,
  OnboardingPaymentView,
  OnboardingSummary,
  OnboardingDetailView,
} from "@/lib/admin/onboarding-types";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").replace(/:\d+$/, "");

function asArray<T = Record<string, unknown>>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function productViews(v: unknown): OnboardingProductView[] {
  return asArray(v).map((p) => {
    const o = p as Record<string, unknown>;
    return {
      name: str(o.name),
      price: Number(o.price) || 0,
      description: str(o.description),
      category: str(o.category),
      imageUrl: str(o.imageUrl),
    };
  });
}
function paymentViews(v: unknown): OnboardingPaymentView[] {
  return asArray(v).map((p) => {
    const o = p as Record<string, unknown>;
    return {
      name: str(o.name),
      account: str(o.account),
      number: str(o.number),
      qrUrl: str(o.qrUrl),
      instructions: str(o.instructions),
    };
  });
}

/** Map stored Starter feature keys to their human labels (drops unknown keys). */
function featureViews(v: unknown): string[] {
  return asArray<string>(v)
    .filter((k): k is StarterFeatureKey => typeof k === "string" && k in STARTER_FEATURE_LABELS)
    .map((k) => STARTER_FEATURE_LABELS[k]);
}

type DbRow = {
  id: string;
  businessName: string;
  businessType: string;
  description: string | null;
  contactPerson: string | null;
  email: string;
  whatsapp: string | null;
  facebook: string | null;
  themeStyle: string | null;
  themeId: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoUrl: string | null;
  bannerUrls: unknown;
  inspirationUrls: unknown;
  inspirationNotes: string | null;
  products: unknown;
  orderDestination: string | null;
  orderDestinationValue: string | null;
  paymentMethods: unknown;
  packageKey: string;
  trial: boolean;
  trialStartsAt: Date | null;
  trialEndsAt: Date | null;
  amountDueCents: number | null;
  selectedFeatures: unknown;
  paymentProofUrl: string | null;
  termsAccepted: boolean;
  slug: string;
  tenantId: string | null;
  setupStatus: string;
  createdAt: Date;
  tenant: { status: string } | null;
};

function summaryFromDb(r: DbRow): OnboardingSummary {
  const pm = planMeta(r.packageKey);
  return {
    id: r.id,
    businessName: r.businessName,
    email: r.email,
    contactPerson: r.contactPerson ?? "",
    slug: r.slug,
    url: `${r.slug}.${ROOT}`,
    packageKey: pm.key,
    packageLabel: pm.label,
    trial: r.trial,
    trialStartsAt: r.trialStartsAt?.toISOString() ?? null,
    trialEndsAt: r.trialEndsAt?.toISOString() ?? null,
    amountDueCents: r.amountDueCents,
    setupStatus: r.setupStatus,
    setupStatusLabel: ONBOARDING_STATUS_LABELS[r.setupStatus] ?? r.setupStatus,
    tenantId: r.tenantId,
    tenantStatus: r.tenant?.status ?? null,
    published: r.tenant?.status === "active",
    productCount: productViews(r.products).length,
    paymentProofUrl: r.paymentProofUrl,
    createdAt: r.createdAt.toISOString(),
  };
}

function detailFromDb(r: DbRow): OnboardingDetailView {
  return {
    ...summaryFromDb(r),
    businessType: r.businessType,
    description: r.description ?? "",
    whatsapp: r.whatsapp ?? "",
    facebook: r.facebook ?? "",
    themeStyle: r.themeStyle,
    themeId: r.themeId,
    primaryColor: r.primaryColor,
    secondaryColor: r.secondaryColor,
    logoUrl: r.logoUrl,
    bannerUrls: asArray<string>(r.bannerUrls).filter((x) => typeof x === "string"),
    inspirationUrls: asArray<string>(r.inspirationUrls).filter((x) => typeof x === "string"),
    inspirationNotes: r.inspirationNotes ?? "",
    products: productViews(r.products),
    orderDestination: r.orderDestination,
    orderDestinationValue: r.orderDestinationValue,
    paymentMethods: paymentViews(r.paymentMethods),
    selectedFeatures: featureViews(r.selectedFeatures),
    termsAccepted: r.termsAccepted,
  };
}

// ── Demo mapping ──
function summaryFromDemo(s: DemoOnboardingSubmission): OnboardingSummary {
  const d = s.data as Record<string, unknown>;
  const pm = planMeta(str(d.packageKey) || "starter");
  return {
    id: s.id,
    businessName: str(d.businessName),
    email: str(d.email),
    contactPerson: str(d.contactPerson),
    slug: s.slug,
    url: `${s.slug}.${ROOT}`,
    packageKey: pm.key,
    packageLabel: pm.label,
    trial: pm.key === "pro" && Boolean(d.trial),
    // Demo submissions have no operator-managed trial window or stamped total.
    trialStartsAt: null,
    trialEndsAt: null,
    amountDueCents: null,
    setupStatus: s.setupStatus,
    setupStatusLabel: ONBOARDING_STATUS_LABELS[s.setupStatus] ?? s.setupStatus,
    tenantId: s.tenantId,
    tenantStatus: "pending_setup",
    published: false,
    productCount: productViews(d.products).length,
    paymentProofUrl: str(d.paymentProofUrl) || null,
    createdAt: s.createdAt,
  };
}
function detailFromDemo(s: DemoOnboardingSubmission): OnboardingDetailView {
  const d = s.data as Record<string, unknown>;
  return {
    ...summaryFromDemo(s),
    businessType: str(d.businessType),
    description: str(d.description),
    whatsapp: str(d.whatsapp),
    facebook: str(d.facebook),
    themeStyle: str(d.themeStyle) || null,
    themeId: str(d.themeId) || "clinical-white",
    primaryColor: str(d.primaryColor) || null,
    secondaryColor: str(d.secondaryColor) || null,
    logoUrl: str(d.logoUrl) || null,
    bannerUrls: asArray<string>(d.bannerUrls).filter((x) => typeof x === "string"),
    inspirationUrls: asArray<string>(d.inspirationUrls).filter((x) => typeof x === "string"),
    inspirationNotes: str(d.inspirationNotes),
    products: productViews(d.products),
    orderDestination: str(d.orderDestination) || null,
    orderDestinationValue: str(d.orderDestinationValue) || null,
    paymentMethods: paymentViews(d.paymentMethods),
    selectedFeatures: featureViews(d.selectedFeatures),
    termsAccepted: !!d.termsAccepted,
  };
}

const SELECT = {
  id: true,
  businessName: true,
  businessType: true,
  description: true,
  contactPerson: true,
  email: true,
  whatsapp: true,
  facebook: true,
  themeStyle: true,
  themeId: true,
  primaryColor: true,
  secondaryColor: true,
  logoUrl: true,
  bannerUrls: true,
  inspirationUrls: true,
  inspirationNotes: true,
  products: true,
  orderDestination: true,
  orderDestinationValue: true,
  paymentMethods: true,
  packageKey: true,
  trial: true,
  trialStartsAt: true,
  trialEndsAt: true,
  amountDueCents: true,
  selectedFeatures: true,
  paymentProofUrl: true,
  termsAccepted: true,
  slug: true,
  tenantId: true,
  setupStatus: true,
  createdAt: true,
  tenant: { select: { status: true } },
} as const;

const _cachedList = unstable_cache(
  async (): Promise<OnboardingSummary[]> => {
    const rows = await prisma.onboardingSubmission.findMany({
      orderBy: { createdAt: "desc" },
      select: SELECT,
    });
    return rows.map((r) => summaryFromDb(r as DbRow));
  },
  ["admin-onboarding-list"],
  { tags: ["admin:data"], revalidate: 60 },
);

/** All submissions, newest first (for the admin Onboarding list). */
export async function listOnboardingSubmissions(): Promise<OnboardingSummary[]> {
  if (isDemoMode()) return listDemoOnboarding().map(summaryFromDemo);
  return _cachedList();
}

/** One submission with all submitted detail, or null. */
export async function getOnboardingSubmission(id: string): Promise<OnboardingDetailView | null> {
  if (isDemoMode()) {
    const s = getDemoOnboarding(id);
    return s ? detailFromDemo(s) : null;
  }
  const r = await prisma.onboardingSubmission.findUnique({ where: { id }, select: SELECT });
  return r ? detailFromDb(r as DbRow) : null;
}

/** Count of submissions not yet completed — for the nav badge. */
export async function pendingOnboardingCount(): Promise<number> {
  if (isDemoMode()) return listDemoOnboarding().filter((s) => s.setupStatus !== "completed").length;
  return prisma.onboardingSubmission.count({ where: { setupStatus: { not: "completed" } } });
}
