// MCP tool: update_whitelabel_branding — restyle an EXISTING tenant.
//
// The connector could only create tenants. An operator who wanted a live store
// redesigned had exactly two bad options: provision a duplicate, or re-run the
// creation endpoint over the real one. Both lose data. This is the third door.
//
// It lives outside app/api/mcp/route.ts because that file is already long, and
// because everything here is one coherent operation: resolve the tenant, upload
// whatever assets came with the request, merge the style patch, write once.
//
// The merge itself is NOT here — it is the pure, tested core in
// @/lib/tenant/branding-update (npm run test:branding-update). This module is
// the I/O shell around it: schema, asset uploads, one write, revalidate. Auth is
// the ROUTE's job; by the time callUpdateBranding runs the caller has already
// proven the admin token.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-client";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { uploadTenantBrandingAsset } from "@/lib/tenant/setup";
import { buildTenantBrandingUpdate } from "@/lib/tenant/branding-update";
import { applyDefaultProductImage } from "@/lib/upload/branding-assets";
import { normalizeHeroMedia } from "@/lib/storefront/hero-media";
import { THEME_PRESETS } from "@/lib/theme/presets";
import { SPLASH_DESIGNS } from "@/lib/storefront/brand-splash";
import { HOME_LAYOUTS } from "@/lib/storefront/home-layout";
import { MCP_ASSET_SCHEMA, resolveMcpImage } from "@/lib/mcp/tenant-media";

const HEX_HINT = "Hex color, e.g. #1C1917.";

const COLORS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description:
    "Storefront palette. Every value is a hex color. Only the keys you send change; the rest of the tenant's palette is left alone.",
  properties: {
    main: { type: "string", description: `Primary brand color. ${HEX_HINT}` },
    accent: { type: "string", description: `Accent/highlight color. ${HEX_HINT}` },
    button: { type: "string", description: `Primary button fill. ${HEX_HINT}` },
    button2: { type: "string", description: `Secondary button fill. ${HEX_HINT}` },
    buttonText: { type: "string", description: `Text on the primary button. ${HEX_HINT}` },
    background: { type: "string", description: `Page background. ${HEX_HINT}` },
    surface: { type: "string", description: `Card/panel surface. ${HEX_HINT}` },
    text: { type: "string", description: `Body text. ${HEX_HINT}` },
    headerBg: { type: "string", description: `Sticky header background. ${HEX_HINT}` },
    headerText: { type: "string", description: `Sticky header text. ${HEX_HINT}` },
    borderColor: { type: "string", description: `Hairline/border color. ${HEX_HINT}` },
    heroHighlight: { type: "string", description: `Hero chip/accent color. ${HEX_HINT}` },
    borderWidth: { type: "number", description: "Border thickness in px, 1 to 6." },
  },
};

const FONTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description: "Font family names. Send an empty string to inherit the theme font.",
  properties: {
    heading: { type: "string" },
    body: { type: "string" },
    button: { type: "string" },
    price: { type: "string" },
    heroTitle: { type: "string" },
    heroBody: { type: "string" },
  },
};

const LAYOUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description: "Storefront layout and section visibility. Only the keys you send change.",
  properties: {
    heroVariant: {
      type: "string",
      enum: ["centered", "split", "editorial", "card", "minimal", "spotlight", "wordmark"],
    },
    heroAlign: { type: "string", enum: ["left", "center"] },
    heroTitleSize: { type: "string", enum: ["sm", "md", "lg", "xl"] },
    heroBodySize: { type: "string", enum: ["sm", "md", "lg"] },
    heroTitleWeight: { type: "number", description: "400 to 800." },
    heroLogoSize: { type: "number", description: "Hero logo card size in px, 24 to 480." },
    homeLayout: {
      type: "string",
      enum: [...HOME_LAYOUTS],
      description: "Homepage shape. \"two-ways\" additionally needs an operator grant to render.",
    },
    footerStyle: { type: "string", enum: ["columns", "compact"] },
    catalogSortStyle: { type: "string", enum: ["classic", "simple"] },
    logoCurve: { type: "number", description: "Logo corner rounding, 0 (square) to 50 (circle)." },
    siteBorder: { type: "boolean", description: "Editorial frame around the whole viewport." },
    showHeader: { type: "boolean" },
    showHero: { type: "boolean" },
    showCategories: { type: "boolean" },
    showCatalog: { type: "boolean" },
    showFooter: { type: "boolean" },
    headerShowBrand: { type: "boolean" },
    headerShowLogo: { type: "boolean" },
    headerShowCart: { type: "boolean" },
    headerShowCta: { type: "boolean" },
    heroShowLogo: { type: "boolean" },
    heroShowChip: { type: "boolean" },
    heroShowSub: { type: "boolean" },
    heroShowCtas: { type: "boolean" },
    heroShowCta2: { type: "boolean" },
    catalogShowSearch: { type: "boolean" },
    catalogShowSort: { type: "boolean" },
    catalogShowCount: { type: "boolean" },
    footerShowBrand: { type: "boolean" },
    footerShowBlurb: { type: "boolean" },
    footerShowSocials: { type: "boolean" },
    footerShowColumns: { type: "boolean" },
  },
};

const SPLASH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description:
    "Branded loading screen shown while the storefront hydrates. Only the keys you send change; the rest of the tenant's splash is left alone. Send an empty string on a color to fall back to the theme.",
  properties: {
    enabled: { type: "boolean", description: "false hides the splash entirely." },
    design: {
      type: "string",
      enum: [...SPLASH_DESIGNS],
      description: "Loading animation. \"ring\" and \"bar\" show visible progress; the others only animate the mark.",
    },
    bgColor: { type: "string", description: `Splash backdrop. ${HEX_HINT}` },
    accentColor: { type: "string", description: `Spinner/bar color. ${HEX_HINT}` },
    textColor: { type: "string", description: `Tagline color. ${HEX_HINT}` },
    tagline: { type: "string", description: "Optional line under the mark." },
    showTagline: { type: "boolean", description: "Whether the tagline renders." },
    minDurationMs: { type: "number", description: "Floor before the splash may lift, 0 to 3000." },
    maxDurationMs: { type: "number", description: "Ceiling after which it lifts regardless, 300 to 5000." },
    logoUrl: {
      type: "string",
      description: 'Already-hosted http(s) splash mark, or "" to fall back to the header logo. To UPLOAD one, use splashLogo instead.',
    },
  },
};

export const UPDATE_BRANDING_TOOL = {
  name: "update_whitelabel_branding",
  title: "Update Tenant Branding / Storefront",
  description:
    "Use this when a platform operator asks ChatGPT to restyle or redesign an EXISTING Pepweb whitelabel tenant — its theme preset, colors, fonts, storefront layout, hero copy, hero image, logo, favicon, default product image, or its branded loading splash. This is a partial update: only the fields you send change, and the tenant's products, orders, payment methods, FAQ, promo codes and other storefront data are never touched. Prefer this over create_whitelabel_tenant for any store that already exists — never re-create a tenant to change how it looks.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: {
        type: "string",
        description:
          "Optional fallback token for testing when ChatGPT is configured with No Authentication. Prefer Authorization: Bearer via the connector settings.",
      },
      tenantSlug: { type: "string", description: "Existing tenant slug, e.g. skn-aesthetic-supply-co." },
      themeId: {
        type: "string",
        description: `Theme preset id. One of: ${Object.keys(THEME_PRESETS).join(", ")}.`,
      },
      colors: COLORS_SCHEMA,
      fonts: FONTS_SCHEMA,
      layout: LAYOUT_SCHEMA,
      hero: {
        type: "object",
        additionalProperties: false,
        description: "Hero copy. Send an empty string to clear a line.",
        properties: {
          chip: { type: "string" },
          line1: { type: "string" },
          line2: { type: "string" },
          sub: { type: "string" },
          cta1: { type: "string" },
          cta2: { type: "string" },
        },
      },
      identity: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Store name shown in the storefront chrome." },
          industry: { type: "string" },
          ctaLabel: { type: "string" },
          metaDescription: { type: "string", description: "Link-preview / SEO description." },
          footerBlurb: { type: "string" },
        },
      },
      splash: SPLASH_SCHEMA,
      catalog: {
        type: "object",
        additionalProperties: false,
        properties: {
          eyebrow: { type: "string" },
          title: { type: "string" },
        },
      },
      logo: MCP_ASSET_SCHEMA,
      favicon: MCP_ASSET_SCHEMA,
      defaultProductImage: MCP_ASSET_SCHEMA,
      heroImage: {
        ...MCP_ASSET_SCHEMA,
        description:
          "Homepage hero image to upload from a public URL, data URL, or raw base64 bytes. Setting it switches the hero to image mode.",
      },
      heroImageAlt: { type: "string" },
      heroImageRatio: { type: "string", enum: ["wide", "standard", "tall"] },
      heroImageFocus: { type: "string", enum: ["center", "top", "bottom", "left", "right"] },
      heroImageOverlay: { type: "boolean", description: "Show hero text over the image." },
      heroImageScrim: { type: "number", description: "Dark scrim strength, 0 to 70." },
      splashLogo: {
        ...MCP_ASSET_SCHEMA,
        description:
          "Splash-screen mark to upload from a public URL, data URL, or raw base64 bytes. Overrides splash.logoUrl.",
      },
    },
    required: ["tenantSlug"],
  },
  annotations: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

/** Style sections forwarded to the pure merge; everything else here is I/O. */
const PATCH_SECTIONS = ["themeId", "colors", "fonts", "layout", "hero", "identity", "catalog", "splash"] as const;

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError: boolean;
};

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanString(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function fail(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function ok(result: unknown, isError = false): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
    isError,
  };
}

/**
 * Restyle an existing tenant. The style patch is validated BEFORE any upload —
 * a typo should cost a round trip, not an orphaned image in the tenant's
 * ImageKit folder — and the whole Branding row is then written once.
 */
export async function callUpdateBranding(args: Record<string, unknown>): Promise<ToolResult> {
  const tenantSlug = cleanString(args.tenantSlug ?? args.slug, 80).toLowerCase();
  if (!tenantSlug) return fail("tenantSlug is required.");

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) return fail(`Tenant "${tenantSlug}" was not found.`);

  const heroImage = plainObject(args.heroImage);
  const splashLogo = plainObject(args.splashLogo);
  const assetKinds = [
    { key: "logo", kind: "logo" as const },
    { key: "favicon", kind: "favicon" as const },
    { key: "defaultProductImage", kind: "defaultProductImage" as const },
  ];
  const suppliedAssets = assetKinds.filter(({ key }) => plainObject(args[key]));

  // A call that names a tenant and changes nothing is a mistake, not a success.
  const hasStylePatch = PATCH_SECTIONS.some((key) => args[key] !== undefined);
  if (!hasStylePatch && !heroImage && !splashLogo && !suppliedAssets.length) {
    return fail(
      `Nothing to update. Send at least one of: ${PATCH_SECTIONS.join(", ")}, logo, favicon, defaultProductImage, heroImage, splashLogo.`,
    );
  }

  const current = await prisma.branding.findUnique({
    where: { tenantId: tenant.id },
    select: { themeId: true, config: true },
  });

  const patch: Record<string, unknown> = {};
  for (const key of PATCH_SECTIONS) {
    if (args[key] !== undefined) patch[key] = args[key];
  }
  const merged = hasStylePatch
    ? buildTenantBrandingUpdate({ themeId: current?.themeId, config: current?.config }, patch)
    : {
        themeId: undefined,
        config: plainObject(current?.config) ?? {},
        changed: [] as string[],
        errors: [] as string[],
        warnings: [] as string[],
      };

  if (merged.errors.length) {
    return ok({ tenant, applied: false, errors: merged.errors }, true);
  }

  try {
    const [uploads, hero, splashMark] = await Promise.all([
      Promise.all(
        suppliedAssets.map(async ({ key, kind }) => ({
          kind,
          upload: await uploadTenantBrandingAsset(tenant.id, kind, args[key]),
        })),
      ),
      heroImage ? resolveMcpImage(tenant.id, heroImage, "hero") : Promise.resolve(null),
      splashLogo ? resolveMcpImage(tenant.id, splashLogo, "splash") : Promise.resolve(null),
    ]);

    let config = merged.config;
    const changed = [...merged.changed];

    const byKind = new Map(uploads.map((u) => [u.kind, u.upload]));
    const logoUrl = byKind.get("logo")?.url;
    const faviconUrl = byKind.get("favicon")?.url;
    const defaultProductImageUrl = byKind.get("defaultProductImage")?.url;

    if (logoUrl) changed.push("logo");
    if (faviconUrl) changed.push("favicon");
    if (defaultProductImageUrl) {
      config = applyDefaultProductImage(config, defaultProductImageUrl);
      changed.push("defaultProductImage");
    }

    if (splashMark) {
      // Merge, never replace: buildTenantBrandingUpdate may have just written
      // colors and a tagline into this same object, and the operator's stored
      // durations live here too.
      config = {
        ...config,
        brandSplash: { ...(plainObject(config.brandSplash) ?? {}), logoUrl: splashMark.url },
      };
      changed.push("splashLogo");
    }

    if (hero) {
      const existingMedia = plainObject(config.heroMedia) ?? {};
      config = {
        ...config,
        heroMedia: normalizeHeroMedia({
          heroMedia: {
            ...existingMedia,
            mode: "image",
            url: hero.url,
            alt:
              cleanString(args.heroImageAlt, 200) ||
              cleanString(existingMedia.alt, 200) ||
              `${tenant.name} hero image`,
            ratio: args.heroImageRatio ?? existingMedia.ratio ?? "standard",
            focus: args.heroImageFocus ?? existingMedia.focus ?? "center",
            overlay: args.heroImageOverlay ?? existingMedia.overlay ?? true,
            scrim: args.heroImageScrim ?? existingMedia.scrim ?? 30,
            linkType: existingMedia.linkType ?? "page",
            linkPage: existingMedia.linkPage ?? "catalog",
            linkUrl: existingMedia.linkUrl ?? "",
          },
        }),
      };
      changed.push("heroImage");
    }

    await withTenant(tenant.id, (db) =>
      db.branding.upsert({
        where: { tenantId: tenant.id },
        update: {
          ...(merged.themeId ? { themeId: merged.themeId } : {}),
          ...(logoUrl ? { logoUrl } : {}),
          ...(faviconUrl ? { faviconUrl } : {}),
          config: config as Prisma.InputJsonValue,
        },
        create: {
          tenantId: tenant.id,
          themeId: merged.themeId ?? current?.themeId ?? "clinical-white",
          ...(logoUrl ? { logoUrl } : {}),
          ...(faviconUrl ? { faviconUrl } : {}),
          config: config as Prisma.InputJsonValue,
        },
      }),
    );

    revalidateTenant(tenant.id, tenant.slug);

    return ok({
      tenant,
      applied: true,
      themeId: merged.themeId ?? current?.themeId ?? null,
      changed,
      warnings: merged.warnings,
      assets: {
        logoUrl: logoUrl ?? null,
        faviconUrl: faviconUrl ?? null,
        defaultProductImageUrl: defaultProductImageUrl ?? null,
        heroImageUrl: hero?.url ?? null,
        splashLogoUrl: splashMark?.url ?? null,
      },
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to update tenant branding.");
  }
}
