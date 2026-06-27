import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getEntitlements } from "@/lib/features/entitlements";
import { planFeatureSet, FEATURE_META, ALL_FEATURES, FEATURE_GROUPS, FEATURES, type FeatureKey } from "@/lib/features/catalog";
import {
  isDemoMode,
  listDemoTenants,
  getDemoTenant,
  getDemoOrderFormat,
  getDemoEntitlements,
  getDemoBranding,
  type DemoTenant,
} from "@/lib/demo/fixtures";
import { planMeta } from "@/lib/admin/plans";
import { planConfigPriceCents } from "@/lib/platform/plan-config";
import { getPlanConfig } from "@/lib/platform/plan-config-server";
import { normalizeOrderNumberFormat, type OrderNumberFormat } from "@/lib/orders/order-number-format";
import { normalizeContactChannels } from "@/lib/storefront/contact-channels";
import { normalizeAdminFee, type AdminFeeConfig } from "@/lib/storefront/admin-fee";
import { BRAND } from "@/storefront/data";
import type { ContactChannel } from "@/storefront/types";

/* ============================================================
   Shared shapes consumed by the admin pages / client components
   ============================================================ */

export type TenantStatus = "active" | "trial" | "suspended" | "past_due" | "pending" | "canceled";

export type AdminTenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  planKey: string;
  themeId: string;
  logoUrl?: string;
  owner: string;
  email: string;
  createdAt: string; // ISO date (YYYY-MM-DD)
  revenueCents: number;
  orders: number;
  features: number;
};

export type OverviewData = {
  kpis: {
    totalTenants: number;
    activeSubscriptions: number;
    monthlyRevenueCents: number;
    totalOrders: number;
    totalCustomers: number;
    activeTrials: number;
    newTenants30d: number;
    newOrders30d: number;
  };
  revenueSeries: { labels: string[]; current: number[]; previous: number[] }; // dollars
  tenantGrowth: number[];
  topTenants: AdminTenantRow[];
  activity: ActivityItem[];
  // small sparkline series for KPI cards (dollars / counts)
  sparks: {
    tenants: number[];
    subscriptions: number[];
    revenue: number[];
    orders: number[];
    customers: number[];
    trials: number[];
  };
};

export type ActivityItem = {
  icon: string; // primitives icon key
  text: string; // markdown-ish (**bold**)
  time: string;
  danger?: boolean;
};

export type RecentOrder = {
  orderNumber: string;
  date: string;
  customer: string;
  items: number;
  totalCents: number;
  status: string;
};

export type TenantFeatureState = {
  key: string;
  label: string;
  description: string;
  group: string;
  enabled: boolean;
  locked: boolean;
};

export type TenantDetail = AdminTenantRow & {
  monthlyRevenue: number[]; // dollars, 12 mo
  recentOrders: RecentOrder[];
  features: number;
  featureStates: TenantFeatureState[];
  enabledFeatures: number;
  totalFeatures: number;
  lifetimeRevenueCents: number;
  visitors: number;
  audit: ActivityItem[];
  planPriceCents: number; // effective monthly price (operator-edited plan config)
};

/* ============================================================
   Helpers
   ============================================================ */

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hashInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return h;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ago(d: Date): string {
  const ms = Date.now() - d.getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}

/** Owner display name derived from an email local-part (no name column). */
function nameFromEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const local = email.split("@")[0];
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/** Resolved feature count for a plan + override list. */
function countFeatures(planKey: string, overrides: { enabled: boolean; key: string }[]): number {
  const set = new Set<string>(planFeatureSet(planKey));
  for (const o of overrides) {
    if (o.enabled) set.add(o.key);
    else set.delete(o.key);
  }
  return set.size;
}

/** Last 12 month labels ending on the current month. */
function trailing12Labels(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(MONTH_LABELS[d.getMonth()]);
  }
  return out;
}

/** Bucket {createdAt, totalCents} into 12 trailing-month dollar totals, offset months back. */
function monthlyRevenue(orders: { createdAt: Date; totalCents: number }[], offsetMonths = 0): number[] {
  const now = new Date();
  const buckets = new Array(12).fill(0);
  for (const o of orders) {
    const monthsBack =
      (now.getFullYear() - o.createdAt.getFullYear()) * 12 + (now.getMonth() - o.createdAt.getMonth()) - offsetMonths;
    const idx = 11 - monthsBack;
    if (idx >= 0 && idx < 12) buckets[idx] += o.totalCents;
  }
  return buckets.map((c) => Math.round(c / 100));
}

/* ============================================================
   Storefront orders — manual-checkout orders live in StorefrontOrder
   (JSON blobs, whole-currency prices), not the Stripe/analytics `Order`
   table. Admin dashboards must aggregate BOTH or live tenants (which
   only take manual checkouts today) read as $0 / 0 orders.
   ============================================================ */

type SfMoneyFields = { items: unknown; shipping: unknown; adminFee: unknown; discount?: unknown };

/** Storefront order grand total in cents: items − discount + shipping fee + admin fee. */
function sfTotalCents(o: SfMoneyFields): number {
  const items = Array.isArray(o.items) ? (o.items as { price?: number; qty?: number }[]) : [];
  const sub = items.reduce((s, it) => s + (Number(it?.price) || 0) * (Number(it?.qty) || 1), 0);
  const ship = Number((o.shipping as { fee?: number } | null)?.fee) || 0;
  const fee = Number((o.adminFee as { amount?: number } | null)?.amount) || 0;
  const discount = Number((o.discount as { amount?: number } | null)?.amount) || 0;
  return Math.round((Math.max(0, sub - discount + ship + fee)) * 100);
}

function sfCustomer(o: { customer: unknown }): { name: string; email: string } {
  const c = (o.customer ?? {}) as { name?: unknown; email?: unknown };
  return { name: typeof c.name === "string" ? c.name : "", email: typeof c.email === "string" ? c.email : "" };
}

/** Cancelled orders are excluded from revenue (mirrors the store admin). */
function sfCountsForRevenue(status: string): boolean {
  return status !== "cancelled";
}

/* ============================================================
   DEMO synthesis — file-backed tenants have no order history,
   so derive deterministic, stable numbers per slug.
   ============================================================ */

function demoRow(t: DemoTenant): AdminTenantRow {
  const h = hashInt(t.slug);
  const orders = (h % 2600) + (t.plan === "enterprise" ? 800 : t.plan === "pro" ? 300 : 20);
  const aov = 90 + (h % 240);
  const revenueCents = orders * aov * 100;
  const created = new Date(2024, h % 12, (h % 27) + 1);
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: "active",
    planKey: t.plan,
    themeId: t.themeId,
    owner: nameFromEmail(`${t.slug}@example.com`),
    email: `owner@${t.slug}.co`,
    createdAt: isoDate(created),
    revenueCents,
    orders,
    features: getDemoEntitlements(t.slug).size,
  };
}

/* ============================================================
   Public API
   ============================================================ */

const _cachedTenantNames = unstable_cache(
  async () => {
    const ts = await prisma.tenant.findMany({ select: { slug: true, name: true } });
    return { count: ts.length, bySlug: Object.fromEntries(ts.map((t) => [t.slug, t.name])) };
  },
  ["admin-tenant-names"],
  { tags: ["admin:data"], revalidate: 120 },
);

/** Lightweight slug→name map + count, for the shell layout (crumbs + badge). */
export async function listTenantNames(): Promise<{ count: number; bySlug: Record<string, string> }> {
  if (isDemoMode()) {
    const ts = listDemoTenants();
    return { count: ts.length, bySlug: Object.fromEntries(ts.map((t) => [t.slug, t.name])) };
  }
  return _cachedTenantNames();
}

/** Tenant name + normalized order-number format for the settings editor. */
export async function getTenantOrderFormat(
  slug: string,
): Promise<{ name: string; format: OrderNumberFormat } | null> {
  if (isDemoMode()) {
    if (!listDemoTenants().some((t) => t.slug === slug)) return null;
    return { name: getDemoTenant(slug).name, format: getDemoOrderFormat(slug) };
  }
  const t = await prisma.tenant.findUnique({
    where: { slug },
    select: { name: true, orderNumberFormat: true },
  });
  if (!t) return null;
  return { name: t.name, format: normalizeOrderNumberFormat(t.orderNumberFormat, t.name) };
}

/** Tenant's current package-plan key + lifecycle status, for the settings
 *  "Plan & status" editor. planKey is the raw stored key (canonical for DB and
 *  demo tenants); the editor normalizes it for its <select>. Demo tenants are
 *  immutable fixtures and report as active. */
export async function getTenantPlanStatus(
  slug: string,
): Promise<{ planKey: string; status: string } | null> {
  if (isDemoMode()) {
    if (!listDemoTenants().some((t) => t.slug === slug)) return null;
    return { planKey: getDemoTenant(slug).plan, status: "active" };
  }
  const t = await prisma.tenant.findUnique({
    where: { slug },
    select: { status: true, plan: { select: { key: true } } },
  });
  if (!t) return null;
  return { planKey: t.plan.key, status: t.status };
}

export type TenantContactChannels = {
  name: string;
  contactChannels: ContactChannel[];
  checkoutTitle: string;
  checkoutNote: string;
  metaDescription: string;
  /** Whether checkout requires a proof-of-payment upload (default true). */
  requireProofOfPayment: boolean;
};

/** Tenant name + its storefront order-contact channels for the settings editor.
 *  Reads from the shared branding.config blob, normalized to the 3 channels. */
export async function getTenantContactChannels(
  slug: string,
): Promise<TenantContactChannels | null> {
  const fromConfig = (
    name: string,
    config: Record<string, unknown>,
  ): TenantContactChannels => ({
    name,
    contactChannels: normalizeContactChannels(config.contactChannels),
    checkoutTitle:
      typeof config.checkoutTitle === "string" ? config.checkoutTitle : BRAND.checkoutTitle ?? "",
    checkoutNote:
      typeof config.checkoutNote === "string" ? config.checkoutNote : BRAND.checkoutNote ?? "",
    metaDescription:
      typeof config.metaDescription === "string" ? config.metaDescription : "",
    // Absent → required (historical default); only an explicit false opts out.
    requireProofOfPayment: config.requireProofOfPayment !== false,
  });

  if (isDemoMode()) {
    if (!listDemoTenants().some((t) => t.slug === slug)) return null;
    const config = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
    return fromConfig(getDemoTenant(slug).name, config);
  }

  const t = await prisma.tenant.findUnique({
    where: { slug },
    select: { name: true, branding: { select: { config: true } } },
  });
  if (!t) return null;
  return fromConfig(t.name, (t.branding?.config ?? {}) as Record<string, unknown>);
}

export type TenantAdminFee = AdminFeeConfig & {
  /** The store's currency symbol, for display next to the amount input. */
  currency: string;
  /** Whether the tenant is entitled to the admin-fee feature (admin → Features).
   *  When false the platform settings form is shown locked and no fee is charged. */
  entitled: boolean;
};

/** The tenant's checkout admin-fee config (super-admin toggle: whether a flat
 *  fee is added on top of the order total, what it's for, and how much).
 *  Read from the shared branding.config blob, same as the contact channels.
 *  `entitled` reflects the operator's admin → Features toggle (STORE_ADMIN_FEE). */
export async function getTenantAdminFee(slug: string): Promise<TenantAdminFee | null> {
  const fromConfig = (config: Record<string, unknown>, entitled: boolean): TenantAdminFee => ({
    ...normalizeAdminFee(config.adminFee),
    currency:
      typeof config.currency === "string" && config.currency.trim()
        ? config.currency.trim()
        : "₱",
    entitled,
  });

  if (isDemoMode()) {
    if (!listDemoTenants().some((t) => t.slug === slug)) return null;
    const entitled = getDemoEntitlements(slug).has(FEATURES.STORE_ADMIN_FEE);
    return fromConfig((getDemoBranding(slug).config ?? {}) as Record<string, unknown>, entitled);
  }

  const t = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, branding: { select: { config: true } } },
  });
  if (!t) return null;
  const entitled = (await getEntitlements(t.id)).has(FEATURES.STORE_ADMIN_FEE);
  return fromConfig((t.branding?.config ?? {}) as Record<string, unknown>, entitled);
}

/** Current storefront-admin password override (blank = falls back to "admin").
 *  Read from the shared branding.config blob, same as the contact channels. */
export async function getTenantAdminPassword(slug: string): Promise<string | null> {
  const fromConfig = (config: Record<string, unknown>): string =>
    typeof config.adminPassword === "string" ? config.adminPassword : "";

  if (isDemoMode()) {
    if (!listDemoTenants().some((t) => t.slug === slug)) return null;
    return fromConfig((getDemoBranding(slug).config ?? {}) as Record<string, unknown>);
  }

  const t = await prisma.tenant.findUnique({
    where: { slug },
    select: { branding: { select: { config: true } } },
  });
  if (!t) return null;
  return fromConfig((t.branding?.config ?? {}) as Record<string, unknown>);
}

export type TenantDomainRow = {
  id: string;
  hostname: string;
  verified: boolean;
  isPrimary: boolean;
};

/** Custom domains attached to a tenant, for the settings "Custom domains" card. */
export async function listTenantDomains(slug: string): Promise<TenantDomainRow[]> {
  // Built-in demo tenants are immutable fixtures with no real domain provisioning.
  if (isDemoMode()) return [];
  const t = await prisma.tenant.findUnique({
    where: { slug },
    select: {
      domains: {
        select: { id: true, hostname: true, verified: true, isPrimary: true },
        orderBy: [{ isPrimary: "desc" }, { hostname: "asc" }],
      },
    },
  });
  return t?.domains ?? [];
}

const _cachedAdminTenants = unstable_cache(
  async (): Promise<AdminTenantRow[]> => {
    const [tenants, revenue, sfOrders] = await Promise.all([
      prisma.tenant.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
          plan: { select: { key: true } },
          branding: { select: { themeId: true, logoUrl: true } },
          members: { where: { role: "owner" }, select: { email: true }, take: 1 },
          _count: { select: { orders: true } },
          featureOverrides: { select: { enabled: true, feature: { select: { key: true } } } },
        },
      }),
      prisma.order.groupBy({ by: ["tenantId"], _sum: { totalCents: true } }),
      prisma.storefrontOrder.findMany({
        select: { tenantId: true, status: true, items: true, shipping: true, adminFee: true, discount: true },
      }),
    ]);
    const revByTenant = new Map(revenue.map((r) => [r.tenantId, r._sum.totalCents ?? 0]));
    const sfRevByTenant = new Map<string, number>();
    const sfCountByTenant = new Map<string, number>();
    for (const o of sfOrders) {
      sfCountByTenant.set(o.tenantId, (sfCountByTenant.get(o.tenantId) ?? 0) + 1);
      if (sfCountsForRevenue(o.status)) {
        sfRevByTenant.set(o.tenantId, (sfRevByTenant.get(o.tenantId) ?? 0) + sfTotalCents(o));
      }
    }
    return tenants
      .map((t): AdminTenantRow => {
        const email = t.members[0]?.email;
        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          status: t.status,
          planKey: t.plan.key,
          themeId: t.branding?.themeId ?? "clinical-white",
          logoUrl: t.branding?.logoUrl ?? undefined,
          owner: nameFromEmail(email),
          email: email ?? "—",
          createdAt: isoDate(t.createdAt),
          revenueCents: (revByTenant.get(t.id) ?? 0) + (sfRevByTenant.get(t.id) ?? 0),
          orders: t._count.orders + (sfCountByTenant.get(t.id) ?? 0),
          features: countFeatures(
            t.plan.key,
            t.featureOverrides.map((o) => ({ enabled: o.enabled, key: o.feature.key })),
          ),
        };
      })
      .sort((a, b) => b.revenueCents - a.revenueCents);
  },
  ["admin-tenant-list"],
  { tags: ["admin:data"], revalidate: 120 },
);

export async function listAdminTenants(): Promise<AdminTenantRow[]> {
  if (isDemoMode()) {
    return listDemoTenants().map(demoRow).sort((a, b) => b.revenueCents - a.revenueCents);
  }
  return _cachedAdminTenants();
}

export async function getPlatformOverview(): Promise<OverviewData> {
  const [rows, planConfig] = await Promise.all([listAdminTenants(), getPlanConfig()]);
  const totalTenants = rows.length;
  const activeSubscriptions = rows.filter((r) => r.status === "active").length;
  const activeTrials = rows.filter((r) => r.status === "trial").length;
  const totalOrders = rows.reduce((s, r) => s + r.orders, 0);
  const mrrCents = rows
    .filter((r) => r.status === "active")
    .reduce((s, r) => s + planConfigPriceCents(planConfig, r.planKey), 0);

  const now = Date.now();
  const D30 = 30 * 24 * 3600 * 1000;
  const newTenants30d = rows.filter((r) => now - new Date(r.createdAt).getTime() < D30).length;

  const labels = trailing12Labels();
  let revCurrent: number[];
  let revPrevious: number[];
  let growth: number[];
  let totalCustomers: number;
  let trailing30dOrderCents = 0;
  let newOrders30d = 0;
  let activity: ActivityItem[];

  if (isDemoMode()) {
    const base = Math.max(40, totalOrders / 40);
    revCurrent = labels.map((_, i) => Math.round((base * (0.6 + i * 0.05)) * 100) / 100 * 1000);
    revPrevious = revCurrent.map((v) => Math.round(v * 0.72));
    growth = labels.map((_, i) => Math.round(totalTenants * (0.62 + i * 0.035)));
    totalCustomers = rows.reduce((s, r) => s + Math.round(r.orders * 0.7), 0);
    trailing30dOrderCents = Math.round(mrrCents * 0.4);
    newOrders30d = Math.round(totalOrders * 0.06);
    activity = demoActivity(rows);
  } else {
    const since24mo = new Date(new Date().getFullYear() - 2, new Date().getMonth(), 1);
    const [orders24mo, customers, allTenants, recentOrders, recentEvents, sfOrders] = await Promise.all([
      prisma.order.findMany({ where: { createdAt: { gte: since24mo } }, select: { createdAt: true, totalCents: true } }),
      prisma.contact.count(),
      prisma.tenant.findMany({ select: { createdAt: true } }),
      prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { orderNumber: true, totalCents: true, createdAt: true, tenant: { select: { name: true } } },
      }),
      safeRecentEvents(),
      prisma.storefrontOrder.findMany({
        orderBy: { placedAt: "desc" },
        select: {
          tenantId: true,
          orderNumber: true,
          status: true,
          placedAt: true,
          customer: true,
          items: true,
          shipping: true,
          adminFee: true,
          discount: true,
          tenant: { select: { name: true } },
        },
      }),
    ]);
    const sfRevenueRows = sfOrders
      .filter((o) => sfCountsForRevenue(o.status))
      .map((o) => ({ createdAt: o.placedAt, totalCents: sfTotalCents(o) }));
    const allOrders = [...orders24mo, ...sfRevenueRows];
    revCurrent = monthlyRevenue(allOrders, 0);
    revPrevious = monthlyRevenue(allOrders, 12);
    // Contacts plus distinct storefront-checkout customers (manual checkout
    // doesn't create Contact rows).
    const sfCustomerKeys = new Set(
      sfOrders
        .map((o) => {
          const c = sfCustomer(o);
          const key = (c.email || c.name).toLowerCase().trim();
          return key ? `${o.tenantId}:${key}` : "";
        })
        .filter(Boolean),
    );
    totalCustomers = customers + sfCustomerKeys.size;
    trailing30dOrderCents = allOrders
      .filter((o) => now - o.createdAt.getTime() < D30)
      .reduce((s, o) => s + o.totalCents, 0);
    newOrders30d = allOrders.filter((o) => now - o.createdAt.getTime() < D30).length;

    // cumulative tenant growth across the trailing 12 months
    growth = (() => {
      const out: number[] = [];
      for (let i = 11; i >= 0; i--) {
        const cutoff = new Date(new Date().getFullYear(), new Date().getMonth() - i + 1, 1).getTime();
        out.push(allTenants.filter((t) => t.createdAt.getTime() < cutoff).length);
      }
      return out;
    })();

    activity = recentEvents.length
      ? recentEvents
      : [
          ...recentOrders.map((o) => ({ name: o.tenant.name, orderNumber: o.orderNumber, totalCents: o.totalCents, at: o.createdAt })),
          ...sfOrders.slice(0, 6).map((o) => ({ name: o.tenant.name, orderNumber: o.orderNumber, totalCents: sfTotalCents(o), at: o.placedAt })),
        ]
          .sort((a, b) => b.at.getTime() - a.at.getTime())
          .slice(0, 6)
          .map((o) => ({
            icon: "Box",
            text: `**${o.name}** received order ${o.orderNumber} · ₱${Math.round(o.totalCents / 100).toLocaleString("en-PH")}`,
            time: ago(o.at),
          }));
    if (!activity.length) activity = demoActivity(rows);
  }

  return {
    kpis: {
      totalTenants,
      activeSubscriptions,
      monthlyRevenueCents: mrrCents + trailing30dOrderCents,
      totalOrders,
      totalCustomers,
      activeTrials,
      newTenants30d,
      newOrders30d,
    },
    revenueSeries: { labels, current: revCurrent, previous: revPrevious },
    tenantGrowth: growth,
    topTenants: rows.filter((r) => r.status === "active").slice(0, 5),
    activity,
    sparks: {
      tenants: growth,
      subscriptions: growth.map((v) => Math.round(v * 0.89)),
      revenue: revCurrent,
      orders: revCurrent.map((_, i) => Math.round((totalOrders / 12) * (0.7 + i * 0.05))),
      customers: revCurrent.map((_, i) => Math.round((totalCustomers / 12) * (0.7 + i * 0.05))),
      trials: growth.map((v) => Math.max(0, Math.round(v * 0.05))),
    },
  };
}

/** Recent platform Events humanized into the activity feed (empty-safe). */
async function safeRecentEvents(): Promise<ActivityItem[]> {
  try {
    const events = await prisma.event.findMany({
      orderBy: { ts: "desc" },
      take: 8,
      select: { name: true, ts: true, tenant: { select: { name: true } } },
    });
    return events.map((e) => ({
      icon: iconForEvent(e.name),
      text: `**${e.tenant.name}** · ${humanizeEvent(e.name)}`,
      time: ago(e.ts),
    }));
  } catch {
    return [];
  }
}

function humanizeEvent(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function iconForEvent(name: string): string {
  if (name.includes("order") || name.includes("checkout")) return "Box";
  if (name.includes("cart")) return "ShoppingBag";
  if (name.includes("email") || name.includes("notify")) return "Mail";
  if (name.includes("login") || name.includes("auth")) return "Users";
  return "Activity";
}

function demoActivity(rows: AdminTenantRow[]): ActivityItem[] {
  const top = rows.slice(0, 6);
  const verbs: { icon: string; mk: (n: string) => string; danger?: boolean }[] = [
    { icon: "Buildings", mk: (n) => `New tenant **${n}** signed up on a trial.` },
    { icon: "Layers", mk: (n) => `**${n}** enabled a new feature module.` },
    { icon: "Box", mk: (n) => `**${n}** crossed a new lifetime-orders milestone.` },
    { icon: "TrendUp", mk: (n) => `**${n}** upgraded their subscription plan.` },
    { icon: "AlertCircle", mk: (n) => `Payment retry scheduled for **${n}**.`, danger: true },
    { icon: "Card", mk: (n) => `Subscription renewed for **${n}**.` },
  ];
  return top.map((t, i) => ({
    icon: verbs[i % verbs.length].icon,
    text: verbs[i % verbs.length].mk(t.name),
    time: `${(i + 1) * 9}m ago`,
    danger: verbs[i % verbs.length].danger,
  }));
}

const _cachedTenantDetail = unstable_cache(
  async (slug: string): Promise<Omit<TenantDetail, "planPriceCents"> | null> => {
    const t = await prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        plan: { select: { key: true } },
        branding: { select: { themeId: true } },
        members: { where: { role: "owner" }, select: { email: true }, take: 1 },
        _count: { select: { orders: true, contacts: true } },
      },
    });
    if (!t) return null;

    const [revAgg, orders24mo, recentOrders, events, enabled, sfOrders] = await Promise.all([
      prisma.order.aggregate({ where: { tenantId: t.id }, _sum: { totalCents: true } }),
      prisma.order.findMany({
        where: { tenantId: t.id, createdAt: { gte: new Date(new Date().getFullYear() - 1, new Date().getMonth(), 1) } },
        select: { createdAt: true, totalCents: true },
      }),
      prisma.order.findMany({
        where: { tenantId: t.id },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          orderNumber: true,
          totalCents: true,
          status: true,
          createdAt: true,
          contact: { select: { email: true } },
          _count: { select: { items: true } },
        },
      }),
      safeTenantEvents(t.id),
      getEntitlements(t.id),
      prisma.storefrontOrder.findMany({
        where: { tenantId: t.id },
        orderBy: { placedAt: "desc" },
        select: {
          orderNumber: true,
          status: true,
          placedAt: true,
          customer: true,
          items: true,
          shipping: true,
          adminFee: true,
        },
      }),
    ]);

    const ceiling = planFeatureSet(t.plan.key);
    const email = t.members[0]?.email;
    const sfRevenue = sfOrders.filter((o) => sfCountsForRevenue(o.status));
    const lifetime = (revAgg._sum.totalCents ?? 0) + sfRevenue.reduce((s, o) => s + sfTotalCents(o), 0);
    const sfMonthly = sfRevenue.map((o) => ({ createdAt: o.placedAt, totalCents: sfTotalCents(o) }));
    const sfCustomers = new Set(
      sfOrders
        .map((o) => {
          const c = sfCustomer(o);
          return (c.email || c.name).toLowerCase().trim();
        })
        .filter(Boolean),
    );
    const allRecent = [
      ...recentOrders.map((o) => ({
        orderNumber: o.orderNumber,
        date: isoDate(o.createdAt),
        customer: nameFromEmail(o.contact?.email),
        items: o._count.items,
        totalCents: o.totalCents,
        status: o.status,
      })),
      ...sfOrders.slice(0, 12).map((o) => {
        const c = sfCustomer(o);
        return {
          orderNumber: o.orderNumber,
          date: isoDate(o.placedAt),
          customer: c.name || nameFromEmail(c.email),
          items: Array.isArray(o.items) ? o.items.length : 0,
          totalCents: sfTotalCents(o),
          status: o.status,
        };
      }),
    ]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 12);

    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      planKey: t.plan.key,
      themeId: t.branding?.themeId ?? "clinical-white",
      owner: nameFromEmail(email),
      email: email ?? "—",
      createdAt: isoDate(t.createdAt),
      revenueCents: lifetime,
      orders: t._count.orders + sfOrders.length,
      features: enabled.size,
      monthlyRevenue: monthlyRevenue([...orders24mo, ...sfMonthly], 0),
      recentOrders: allRecent,
      featureStates: featureStates(ceiling, enabled),
      enabledFeatures: enabled.size,
      totalFeatures: ceilingPlusEnabled(ceiling, enabled),
      lifetimeRevenueCents: lifetime,
      visitors: t._count.contacts + sfCustomers.size,
      audit: events,
    };
  },
  ["admin-tenant-detail"],
  { tags: ["admin:data"], revalidate: 120 },
);

export async function getAdminTenantDetail(slug: string): Promise<TenantDetail | null> {
  // Price is attached outside the cache so operator plan-config edits show
  // immediately instead of waiting out the 120s revalidate window.
  const planConfig = await getPlanConfig();
  if (isDemoMode()) {
    const t = listDemoTenants().find((x) => x.slug === slug);
    if (!t) return null;
    const row = demoRow(t);
    const enabled = getDemoEntitlements(t.slug);
    const ceiling = planFeatureSet(t.plan);
    return {
      ...row,
      monthlyRevenue: trailing12Labels().map((_, i) => Math.round((row.revenueCents / 1200) * (0.6 + i * 0.05))),
      recentOrders: demoOrders(row),
      featureStates: featureStates(ceiling, enabled),
      enabledFeatures: enabled.size,
      totalFeatures: ceilingPlusEnabled(ceiling, enabled),
      lifetimeRevenueCents: Math.round(row.revenueCents * 3.6),
      visitors: (hashInt(t.slug) % 18000) + 800,
      audit: demoAudit(row),
      planPriceCents: planConfigPriceCents(planConfig, row.planKey),
    };
  }
  const detail = await _cachedTenantDetail(slug);
  if (!detail) return null;
  return { ...detail, planPriceCents: planConfigPriceCents(planConfig, detail.planKey) };
}

/* ============================================================
   Secondary-page aggregates
   ============================================================ */

export type FeatureModule = { key: string; label: string; description: string; group: string; tier: string; adoption: number };

/** Per-feature adoption (how many tenants are entitled), grouped. */
export async function getFeatureModules(): Promise<{ totalTenants: number; groups: { group: string; items: FeatureModule[] }[] }> {
  const planKeys = isDemoMode()
    ? listDemoTenants().map((t) => t.plan)
    : (await prisma.tenant.findMany({ select: { plan: { select: { key: true } } } })).map((t) => t.plan.key);

  const tierOf = (key: FeatureKey): string => {
    if (planFeatureSet("starter").has(key)) return "starter";
    if (planFeatureSet("pro").has(key)) return "pro";
    return "enterprise";
  };

  const adoption = (key: FeatureKey) => planKeys.filter((pk) => planFeatureSet(pk).has(key)).length;

  const groups = FEATURE_GROUPS.map((group) => ({
    group,
    items: ALL_FEATURES.filter((k) => FEATURE_META[k].group === group).map((k) => ({
      key: k,
      label: FEATURE_META[k].label,
      description: FEATURE_META[k].description,
      group,
      tier: tierOf(k),
      adoption: adoption(k),
    })),
  })).filter((g) => g.items.length > 0);

  return { totalTenants: planKeys.length, groups };
}

export type PlanRow = { key: string; label: string; priceCents: number; count: number; mrrCents: number };

/** Plan distribution + MRR/ARR for the Plans & Billing page. */
export async function getPlanDistribution(): Promise<{ rows: PlanRow[]; mrrCents: number; arrCents: number; activeCount: number }> {
  const [rows, planConfig] = await Promise.all([listAdminTenants(), getPlanConfig()]);
  const byKey = new Map<string, { count: number; mrrCents: number }>();
  for (const r of rows) {
    const pm = planMeta(r.planKey);
    const cur = byKey.get(pm.key) ?? { count: 0, mrrCents: 0 };
    cur.count += 1;
    if (r.status === "active") cur.mrrCents += planConfigPriceCents(planConfig, pm.key);
    byKey.set(pm.key, cur);
  }
  const planRows: PlanRow[] = ["starter", "pro", "enterprise"].map((key) => {
    const pm = planMeta(key);
    const agg = byKey.get(key) ?? { count: 0, mrrCents: 0 };
    return { key, label: pm.label, priceCents: planConfigPriceCents(planConfig, key), count: agg.count, mrrCents: agg.mrrCents };
  });
  const mrrCents = planRows.reduce((s, r) => s + r.mrrCents, 0);
  return { rows: planRows, mrrCents, arrCents: mrrCents * 12, activeCount: rows.filter((r) => r.status === "active").length };
}

/** Recent platform-wide Events as an audit timeline (empty-safe). */
export async function getPlatformAudit(): Promise<ActivityItem[]> {
  if (isDemoMode()) return demoActivity(await listAdminTenants());
  return safeRecentEvents();
}

async function safeTenantEvents(tenantId: string): Promise<ActivityItem[]> {
  try {
    const events = await prisma.event.findMany({
      where: { tenantId },
      orderBy: { ts: "desc" },
      take: 10,
      select: { name: true, ts: true, distinctId: true },
    });
    return events.map((e) => ({
      icon: iconForEvent(e.name),
      text: humanizeEvent(e.name),
      time: ago(e.ts),
    }));
  } catch {
    return [];
  }
}

function featureStates(ceiling: Set<FeatureKey>, enabled: Set<FeatureKey>): TenantFeatureState[] {
  return ALL_FEATURES.map((key) => ({
    key,
    label: FEATURE_META[key].label,
    description: FEATURE_META[key].description,
    group: FEATURE_META[key].group,
    enabled: enabled.has(key),
    locked: !ceiling.has(key),
  }));
}

function ceilingPlusEnabled(ceiling: Set<FeatureKey>, enabled: Set<FeatureKey>): number {
  const s = new Set<FeatureKey>(ceiling);
  for (const k of enabled) s.add(k);
  return ALL_FEATURES.length;
}

function demoOrders(row: AdminTenantRow): RecentOrder[] {
  const prefix = row.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "ORD";
  const names = ["Aron Skarsgård", "Mia Andersson", "Filip Bergmann", "Jonas Holm", "Sara Lindqvist", "Kim Petersson"];
  return Array.from({ length: Math.min(8, Math.max(1, Math.round(row.orders / 50))) }).map((_, i) => ({
    orderNumber: `${prefix}-${1184 - i}`,
    date: isoDate(new Date(Date.now() - i * 86400000)),
    customer: names[i % names.length],
    items: (i % 5) + 1,
    totalCents: ([287, 119, 524, 198, 412, 84][i % 6]) * 100,
    status: i === 2 ? "pending" : "paid",
  }));
}

function demoAudit(row: AdminTenantRow): ActivityItem[] {
  return [
    { icon: "Users", text: `Owner login · ${row.owner}`, time: "2m ago" },
    { icon: "Layers", text: "Enabled feature module", time: "2h ago" },
    { icon: "Truck", text: "Order fulfilled", time: "4h ago" },
    { icon: "Card", text: "Subscription renewed", time: "5d ago" },
    { icon: "TrendUp", text: "Plan upgraded", time: "12d ago" },
  ];
}
