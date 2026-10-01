import "server-only";

import { unstable_cache } from "next/cache";
import { brandPaletteFromBranding } from "@/lib/theme/resolve-css-vars";
import { appStorefrontOrigin } from "@/lib/mobile/storefront-origin";
import { FEATURES } from "@/lib/features/catalog";
import { STAFF_MODULES, isModuleAllowed } from "@/storefront/admin/staff-permissions";
import { buildCommunityMe } from "@/lib/community/members.server";
import type { TenantContext } from "@/lib/tenant/context";
import { loadAccountProfileSafe } from "./account-profile.server";
import { storeDisplayName, storeLogoUrl } from "./store-name";
import type { MeResponse, MobileBrandFonts, MobileBrandTheme, WebModuleLink } from "./contract";
import type { MobileContext, Principal } from "./auth";
import { buildMobileTheme } from "./theme";

/**
 * Identity + permissions + tenant theme for the signed-in phone (GET /me, and
 * the login response). Everything is derived from the tenant's CURRENT branding
 * row (cached under the same `tenant:<id>` tag every branding save already
 * busts), so a website re-theme reaches the app on its next /me.
 */

const FONT_FETCH_TIMEOUT_MS = 3000;
const FONT_CACHE_SECONDS = 24 * 60 * 60;

/** Modules the app handles natively — never duplicated as website links. */
const NATIVE_MODULES = new Set(["orders", "inv", "store-status", "community"]);

/**
 * Modules whose visibility depends on an entitlement or page toggle
 * (storefront/visibility.ts ADMIN_VIEW_TOGGLE / BUSINESS_EXCLUSIVE_MODULES).
 * The app does not re-derive those rules, so it never links to them — it only
 * lists modules that every store has. The website remains the full admin.
 */
const ENTITLEMENT_GATED = new Set([
  "faq", "lab", "proto", "reviews", "analytics", "reseller", "design", "groupbuy",
  "checkout", "access-code", "groupbuys", "fee",
]);

function cfg(config: unknown): Record<string, unknown> {
  return config && typeof config === "object" && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** TTF URLs for one Google Fonts family (regular + bold), or {} on any failure. */
const googleFontFiles = (family: string) =>
  unstable_cache(
    async (): Promise<{ regular?: string; bold?: string }> => {
      const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;700&display=swap`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS) });
        if (!res.ok) return {};
        const css = await res.text();
        const pick = (weight: number) =>
          new RegExp(`font-weight: ${weight};[^}]*?url\\((https://fonts\\.gstatic\\.com/[^)]+\\.ttf)\\)`).exec(css)?.[1];
        return { regular: pick(400), bold: pick(700) };
      } catch {
        return {};
      }
    },
    ["mobile-font-files", family],
    { revalidate: FONT_CACHE_SECONDS },
  )();

async function fontFiles(heading?: string, body?: string): Promise<MobileBrandFonts["files"]> {
  const [h, b] = await Promise.all([
    heading ? googleFontFiles(heading) : Promise.resolve({} as { regular?: string; bold?: string }),
    body ? googleFontFiles(body) : Promise.resolve({} as { regular?: string; bold?: string }),
  ]);
  return { heading: h.regular, headingBold: h.bold, body: b.regular, bodyBold: b.bold };
}

export async function buildTheme(ctx: { tenant: TenantContext }): Promise<MobileBrandTheme> {
  const { branding } = ctx.tenant;
  const config = cfg(branding?.config);
  const base = brandPaletteFromBranding(branding ?? null);
  const palette = {
    ...base,
    main: str(config.main) ?? base.main,
    accent: str(config.accent) ?? base.accent,
    button: str(config.button) ?? base.button,
    buttonText: str(config.buttonText) ?? base.buttonText,
    headerBg: str(config.headerBg),
    headerText: str(config.headerText),
    // Same precedence as the storefront (storefront-home.tsx): preset < config.
    background: str(config.background) ?? base.background,
    surface: str(config.surface) ?? base.surface,
    text: str(config.text) ?? base.text,
    borderColor: str(config.borderColor),
    headingFont: str(config.headingFont) ?? base.headingFont,
    bodyFont: str(config.bodyFont) ?? base.bodyFont,
  };
  return buildMobileTheme({
    name: storeDisplayName(ctx.tenant),
    logoUrl: storeLogoUrl(ctx.tenant),
    palette,
    fontFiles: await fontFiles(palette.headingFont, palette.bodyFont),
  });
}

function webModules(ctx: MobileContext, adminUrl: string): WebModuleLink[] {
  return STAFF_MODULES.filter(
    (m) => !NATIVE_MODULES.has(m.key) && !ENTITLEMENT_GATED.has(m.key) && isModuleAllowed(ctx.actor, m.key),
  ).map((m) => ({ key: m.key, label: m.label, url: adminUrl }));
}

/** What this account may do in the app — each flag re-checked server-side per call. */
export function mobileCan(ctx: MobileContext): MeResponse["can"] {
  const config = cfg(ctx.tenant.branding?.config);
  const allowed = (key: string) => isModuleAllowed(ctx.actor, key);
  return {
    orders: allowed("orders"),
    products: allowed("products"),
    inventory: allowed("inv"),
    storeStatus: allowed("store-status"),
    // Same two-layer gate as the web's Sales Analytics view (entitlement AND the
    // operator's branding switch), plus the staff grant.
    analytics:
      allowed("analytics") &&
      ctx.tenant.has(FEATURES.STORE_SALES_ANALYTICS) &&
      config.showAdminAnalytics !== false,
  };
}

const NO_ADMIN: MeResponse["can"] = {
  orders: false,
  products: false,
  inventory: false,
  storeStatus: false,
  analytics: false,
};

/** GET /me for either kind of phone: the app picks its tab set from `mode`. */
export async function buildMe(principal: Principal): Promise<MeResponse> {
  const ctx = principal.ctx;
  const config = cfg(ctx.tenant.branding?.config);
  const websiteUrl = appStorefrontOrigin(ctx.slug) ?? "";
  const adminUrl = `${websiteUrl}/#admin`;
  const [theme, community, account] = await Promise.all([
    buildTheme(ctx),
    buildCommunityMe(principal),
    loadAccountProfileSafe(principal),
  ]);
  const admin = principal.kind === "admin" ? principal.ctx : null;

  return {
    store: {
      name: theme.name,
      slug: ctx.slug,
      websiteUrl,
      adminUrl,
      currency: str(config.currency) ?? "₱",
    },
    mode: admin ? "admin" : "customer",
    actor: { ...ctx.actorInfo, displayName: account.displayName },
    can: admin ? mobileCan(admin) : NO_ADMIN,
    webModules: admin ? webModules(admin, adminUrl) : [],
    theme,
    community,
    account,
  };
}
