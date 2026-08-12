import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-client";
import { createTenantWithSetup, type TenantSetupInput } from "@/lib/tenant/setup";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { uploadTenantMedia } from "@/lib/imagekit/server";
import {
  fetchMcpImageAsset,
  validatePublicMcpImageUrl,
  type McpImageAsset,
} from "@/lib/mcp/image-assets";
import { normalizeProductInput } from "@/lib/storefront/product-input";
import { normalizeHeroMedia } from "@/lib/storefront/hero-media";
import {
  currencySymbolToIso,
  dbProductToStorefront,
  productToDbWrite,
  slugify,
  uniqueize,
  type DbProductRow,
} from "@/lib/storefront/product-mapping";
import { preserveResellerMetadata } from "@/lib/storefront/reseller-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = {
  name: "pepweb-whitelabel-admin",
  title: "Pepweb Whitelabel Admin",
  version: "1.1.0",
};

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

const CREATE_TENANT_TOOL = {
  name: "create_whitelabel_tenant",
  title: "Create Whitelabel Tenant",
  description:
    "Use this when a platform operator asks ChatGPT to create a Pepweb whitelabel tenant and configure its logo, favicon, default product image, and homepage hero. This is a write action that creates a live tenant record. Do not call it unless the user has explicitly asked to create or provision a tenant.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: {
        type: "string",
        description:
          "Optional fallback token for testing when ChatGPT is configured with No Authentication. Prefer Authorization: Bearer via the connector settings.",
      },
      name: { type: "string", description: "Business/store name, e.g. Nordic Peptides." },
      slug: {
        type: "string",
        description: "Subdomain slug using lowercase letters, numbers, and hyphens, e.g. nordic-peptides.",
      },
      planKey: {
        type: "string",
        enum: ["starter", "pro", "enterprise"],
        description: "Package plan. Defaults to pro.",
      },
      status: {
        type: "string",
        enum: ["trial", "active", "pending_setup"],
        description: "Initial tenant status. Use trial unless the operator says to publish immediately.",
      },
      themeId: { type: "string", description: "Theme preset id. Defaults to clinical-white." },
      ownerEmail: {
        type: "string",
        description: "Owner email. If omitted, the configured MCP fallback owner email is used.",
      },
      ownerUserId: {
        type: "string",
        description: "Supabase auth user id for the owner. If omitted, the configured MCP fallback owner id is used.",
      },
      storeAdminEmail: { type: "string", description: "Store admin email. Defaults to ownerEmail." },
      supportEmail: { type: "string", description: "Public support email. Defaults to ownerEmail." },
      industry: { type: "string", description: "Short industry/category label for the storefront." },
      description: { type: "string", description: "Short store description used for hero fallback copy." },
      currency: { type: "string", description: "Store currency symbol or ISO code, e.g. PHP, ₱, USD, SAR." },
      logo: { $ref: "#/$defs/asset" },
      favicon: { $ref: "#/$defs/asset" },
      defaultProductImage: { $ref: "#/$defs/asset" },
      hero: {
        type: "object",
        additionalProperties: false,
        properties: {
          chip: { type: "string" },
          line1: { type: "string" },
          line2: { type: "string" },
          sub: { type: "string" },
          cta1: { type: "string" },
          cta2: { type: "string" },
          cta1LinkType: { type: "string", enum: ["page", "custom"] },
          cta1LinkPage: { type: "string" },
          cta1LinkUrl: { type: "string" },
          cta2LinkType: { type: "string", enum: ["page", "custom"] },
          cta2LinkPage: { type: "string" },
          cta2LinkUrl: { type: "string" },
          image: { $ref: "#/$defs/asset" },
          imageAlt: { type: "string" },
          imageRatio: { type: "string", enum: ["wide", "standard", "tall"] },
          imageFocus: { type: "string", enum: ["center", "top", "bottom", "left", "right"] },
          imageOverlay: { type: "boolean" },
          imageScrim: { type: "number" },
          imageLinkType: { type: "string", enum: ["page", "custom", "none"] },
          imageLinkPage: { type: "string" },
          imageLinkUrl: { type: "string" },
        },
      },
    },
    required: ["name", "slug"],
    $defs: {
      asset: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: {
            type: "string",
            description:
              "Public http(s) URL for the image. By default the server downloads and rehosts it to the tenant ImageKit folder.",
          },
          dataUrl: { type: "string", description: "Base64 data URL, e.g. data:image/png;base64,..." },
          dataBase64: { type: "string", description: "Raw base64 file bytes." },
          mimeType: { type: "string", description: "Required with dataBase64, e.g. image/png." },
          fileName: { type: "string" },
          upload: {
            type: "boolean",
            description:
              "Defaults to true. Set false to store an existing hosted URL directly instead of rehosting it.",
          },
        },
      },
    },
  },
  annotations: {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

const MCP_ASSET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    url: {
      type: "string",
      description:
        "Public http(s) image URL. By default the server downloads and rehosts it to the tenant ImageKit folder.",
    },
    dataUrl: { type: "string", description: "Base64 data URL, e.g. data:image/png;base64,..." },
    dataBase64: { type: "string", description: "Raw base64 file bytes." },
    mimeType: { type: "string", description: "Required with dataBase64, e.g. image/png." },
    fileName: { type: "string" },
    upload: {
      type: "boolean",
      description: "Defaults to true. Set false to store an existing hosted URL directly instead of rehosting it.",
    },
  },
};

const PRODUCT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sku: { type: "string", description: "Optional SKU base. If omitted, Pepweb generates one from the name." },
    name: { type: "string" },
    description: { type: "string" },
    price: { type: "number", description: "Retail price in major units, e.g. 1500 for ₱1,500." },
    currency: { type: "string", description: "Display currency symbol or ISO code, e.g. PHP, ₱, USD." },
    purity: { type: "string" },
    category: { type: "string", description: "Storefront filter/category label. Required unless defaultCategory is set." },
    featured: { type: "boolean" },
    image: {
      type: "string",
      description: "Existing public hosted product image URL. Do not combine this with imageAsset.",
    },
    imageAsset: {
      ...MCP_ASSET_SCHEMA,
      description:
        "Product image to upload from a public URL, data URL, or raw base64 bytes. JPG, PNG, or WebP; max 10 MB. Do not combine this with image.",
    },
    stock: { type: "number" },
    available: { type: "boolean", description: "False creates the product as draft/unavailable." },
    discountPrice: { type: "number" },
    discountEnabled: { type: "boolean" },
    productType: { type: "string", enum: ["onhand", "gb"], description: "Use gb for group-buy products." },
    gbPrice: { type: "number", description: "Group-buy price in major units. Used only when productType is gb." },
    purchasable: { type: "boolean", description: "False keeps the item listed but not orderable." },
    priceOnRequest: { type: "boolean" },
    freeShipping: { type: "boolean" },
    productClass: { type: "string", enum: ["peptide", "bacWater", "other"] },
    isSet: { type: "boolean" },
    inclusions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          qty: { type: "number" },
        },
      },
    },
    molecularWeight: { type: "string" },
    cas: { type: "string" },
    storage: { type: "string" },
    sequence: { type: "string" },
    sizes: { type: "string" },
    variations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          price: { type: "number" },
          stock: { type: "number" },
          gbPrice: { type: "number" },
        },
      },
    },
    reseller: {
      type: "object",
      additionalProperties: false,
      properties: {
        vialsOnly: { type: "number" },
        completeSet: { type: "number" },
        minQty: { type: "number" },
      },
    },
  },
  required: ["name"],
};

const PRODUCT_PATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: PRODUCT_SCHEMA.properties,
};

const PRODUCT_IDENTIFIER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", description: "Pepweb product id." },
    productId: { type: "string", description: "Alias for id." },
    slug: { type: "string", description: "Product URL slug." },
    productSlug: { type: "string", description: "Alias for slug." },
    sku: { type: "string" },
    name: { type: "string", description: "Exact product name match, case-insensitive." },
  },
};

const BULK_ADD_PRODUCTS_TOOL = {
  name: "bulk_add_products",
  title: "Add/Bulk Add Products",
  description:
    "Use this when a platform operator asks ChatGPT to add one or more products to an existing Pepweb whitelabel tenant. This is a write action that creates live or draft product rows for the named tenant.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: {
        type: "string",
        description:
          "Optional fallback token for testing when ChatGPT is configured with No Authentication. Prefer Authorization: Bearer via the connector settings.",
      },
      tenantSlug: {
        type: "string",
        description: "Existing tenant slug, e.g. pepglow-by-elle.",
      },
      currency: {
        type: "string",
        description: "Default currency for products that omit currency. Falls back to tenant branding currency, then ₱.",
      },
      defaultCategory: {
        type: "string",
        description: "Category to apply to products that omit category.",
      },
      duplicateMode: {
        type: "string",
        enum: ["skip", "create"],
        description:
          "skip avoids creating products whose names already exist in the tenant. create always inserts new rows with unique slug/SKU suffixes. Defaults to skip.",
      },
      product: PRODUCT_SCHEMA,
      products: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: PRODUCT_SCHEMA,
      },
    },
    required: ["tenantSlug"],
  },
  annotations: {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

const UPDATE_PRODUCTS_TOOL = {
  name: "update_products",
  title: "Edit Products",
  description:
    "Use this when a platform operator asks ChatGPT to edit one or more existing products for a Pepweb whitelabel tenant. Products can be found by id, slug, sku, or exact name. This updates product fields but keeps the product's existing URL slug and SKU stable.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: {
        type: "string",
        description:
          "Optional fallback token for testing when ChatGPT is configured with No Authentication. Prefer Authorization: Bearer via the connector settings.",
      },
      tenantSlug: {
        type: "string",
        description: "Existing tenant slug, e.g. pepglow-by-elle.",
      },
      currency: {
        type: "string",
        description: "Default currency for updates that omit currency.",
      },
      defaultCategory: {
        type: "string",
        description: "Category to apply if the existing product and patch both omit category.",
      },
      match: PRODUCT_IDENTIFIER_SCHEMA,
      patch: PRODUCT_PATCH_SCHEMA,
      updates: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            productId: { type: "string" },
            slug: { type: "string" },
            productSlug: { type: "string" },
            sku: { type: "string" },
            name: { type: "string" },
            patch: PRODUCT_PATCH_SCHEMA,
          },
        },
      },
    },
    required: ["tenantSlug"],
  },
  annotations: {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

const UPLOAD_HERO_IMAGE_TOOL = {
  name: "upload_hero_image",
  title: "Upload Hero Section Image",
  description:
    "Use this when a platform operator asks ChatGPT to upload or set the homepage hero section image for an existing Pepweb whitelabel tenant. This updates branding.config.heroMedia for the named tenant.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: {
        type: "string",
        description:
          "Optional fallback token for testing when ChatGPT is configured with No Authentication. Prefer Authorization: Bearer via the connector settings.",
      },
      tenantSlug: {
        type: "string",
        description: "Existing tenant slug, e.g. pepglow-by-elle.",
      },
      image: MCP_ASSET_SCHEMA,
      alt: { type: "string", description: "Image alt text. Defaults to the tenant name." },
      ratio: { type: "string", enum: ["wide", "standard", "tall"] },
      focus: { type: "string", enum: ["center", "top", "bottom", "left", "right"] },
      overlay: { type: "boolean", description: "Show hero text over the image. Defaults to true." },
      scrim: { type: "number", description: "Dark scrim strength from 0 to 70. Defaults to 30." },
      linkType: { type: "string", enum: ["page", "custom", "none"] },
      linkPage: { type: "string", description: "Storefront page target when linkType is page. Defaults to catalog." },
      linkUrl: { type: "string", description: "Custom http(s) target when linkType is custom." },
    },
    required: ["tenantSlug", "image"],
  },
  annotations: {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

function jsonRpcResult(id: JsonRpcId | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonRpcError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

function textResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

function paramsObject(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
}

function bearerToken(req: NextRequest): string {
  const auth = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match?.[1]?.trim() ?? "";
}

function requireMcpAuth(req: NextRequest, args: Record<string, unknown>): string | null {
  const expected = process.env.MCP_ADMIN_TOKEN?.trim();
  if (!expected) return "MCP_ADMIN_TOKEN is not configured on the server.";

  const supplied = bearerToken(req) || String(args.adminToken ?? "").trim();
  if (!supplied || supplied !== expected) return "Invalid or missing MCP admin token.";
  return null;
}

function fallbackOwner() {
  return {
    ownerUserId: process.env.MCP_OWNER_USER_ID?.trim() || process.env.OWNER_USER_ID?.trim() || "",
    ownerEmail: process.env.MCP_OWNER_EMAIL?.trim() || process.env.OWNER_EMAIL?.trim() || "",
  };
}

async function callCreateTenant(req: NextRequest, args: Record<string, unknown>) {
  const authError = requireMcpAuth(req, args);
  if (authError) {
    return {
      content: [{ type: "text", text: authError }],
      isError: true,
    };
  }

  const owner = fallbackOwner();
  const ownerUserId = String(args.ownerUserId ?? owner.ownerUserId).trim();
  const ownerEmail = String(args.ownerEmail ?? owner.ownerEmail).trim();
  if (!ownerUserId || !ownerEmail) {
    return {
      content: [
        {
          type: "text",
          text: "Set MCP_OWNER_USER_ID and MCP_OWNER_EMAIL, or provide ownerUserId and ownerEmail in the tool call.",
        },
      ],
      isError: true,
    };
  }

  try {
    const input = {
      ...args,
      ownerUserId,
      ownerEmail,
    } as unknown as TenantSetupInput;
    const tenant = await createTenantWithSetup(input);
    const text = JSON.stringify(tenant, null, 2);
    return {
      content: [{ type: "text", text }],
      structuredContent: tenant,
      isError: false,
    };
  } catch (e) {
    const text =
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
        ? `Slug "${String(args.slug ?? "")}" is already taken.`
        : e instanceof Error
          ? e.message
          : "Failed to create tenant.";
    return {
      content: [{ type: "text", text }],
      isError: true,
    };
  }
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanString(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function resolveMcpImage(
  tenantId: string,
  asset: McpImageAsset,
  kind: "hero" | "product",
): Promise<{ url: string; fileId?: string }> {
  const label = kind === "hero" ? "hero image" : "product image";
  const needsUpload =
    asset.upload !== false || Boolean(String(asset.dataUrl ?? "").trim() || String(asset.dataBase64 ?? "").trim());
  if (!needsUpload) {
    return { url: await validatePublicMcpImageUrl(asset.url, label) };
  }

  const file = await fetchMcpImageAsset(asset, label);
  const mediaType = kind === "hero" ? "branding:hero" : "product";

  const uploaded = await uploadTenantMedia({
    tenantId,
    file: file.bytes,
    fileName: `${kind}-${file.fileName}`,
    tags: kind === "hero" ? ["branding:hero", "hero"] : ["product"],
  });

  // The image is already safely hosted if this audit row fails, so match the
  // existing storefront upload behavior and keep the successful URL usable.
  try {
    await withTenant(tenantId, (db) =>
      db.mediaAsset.create({
        data: { tenantId, imagekitId: uploaded.fileId, url: uploaded.url, type: mediaType },
      }),
    );
  } catch {
    // Best-effort media-library record only.
  }

  return { url: uploaded.url, fileId: uploaded.fileId };
}

function lowerName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function skuBase(raw: Record<string, unknown>, fallbackSlug: string): string {
  const supplied = cleanString(raw.sku, 80);
  return slugify(supplied || fallbackSlug).toUpperCase();
}

type ProductMatch = {
  id?: string;
  productId?: string;
  slug?: string;
  productSlug?: string;
  sku?: string;
  name?: string;
};

type McpProductRow = DbProductRow & { metadata: unknown };

function productMatchFrom(raw: unknown): ProductMatch {
  const o = plainObject(raw) ?? {};
  return {
    id: cleanString(o.id, 80) || undefined,
    productId: cleanString(o.productId, 80) || undefined,
    slug: cleanString(o.slug, 200) || undefined,
    productSlug: cleanString(o.productSlug, 200) || undefined,
    sku: cleanString(o.sku, 200) || undefined,
    name: cleanString(o.name, 200) || undefined,
  };
}

function matchLabel(match: ProductMatch): string {
  if (match.id || match.productId) return `id "${match.id || match.productId}"`;
  if (match.slug || match.productSlug) return `slug "${match.slug || match.productSlug}"`;
  if (match.sku) return `sku "${match.sku}"`;
  if (match.name) return `name "${match.name}"`;
  return "empty match";
}

function resolveProductMatch(rows: McpProductRow[], match: ProductMatch): McpProductRow | { error: string } {
  const id = match.id || match.productId;
  if (id) {
    const row = rows.find((p) => p.id === id);
    return row ?? { error: `No product found for ${matchLabel(match)}.` };
  }

  const slug = match.slug || match.productSlug;
  if (slug) {
    const row = rows.find((p) => p.slug === slug);
    return row ?? { error: `No product found for ${matchLabel(match)}.` };
  }

  if (match.sku) {
    const row = rows.find((p) => p.sku.toLocaleLowerCase() === match.sku!.toLocaleLowerCase());
    return row ?? { error: `No product found for ${matchLabel(match)}.` };
  }

  if (match.name) {
    const found = rows.filter((p) => lowerName(p.name) === lowerName(match.name!));
    if (found.length === 1) return found[0];
    if (found.length > 1) return { error: `Multiple products match ${matchLabel(match)}. Use id, slug, or sku.` };
    return { error: `No product found for ${matchLabel(match)}.` };
  }

  return { error: "Provide one product identifier: id, slug, sku, or name." };
}

function isProductRow(value: McpProductRow | { error: string }): value is McpProductRow {
  return !("error" in value);
}

function productPatchFrom(raw: unknown): Record<string, unknown> {
  return plainObject(raw) ?? {};
}

function productImageInputError(input: Record<string, unknown>): string | null {
  if (input.imageAsset !== undefined && !plainObject(input.imageAsset)) {
    return "imageAsset must be an object.";
  }
  if (cleanString(input.image, 2_000) && plainObject(input.imageAsset)) {
    return "Provide either image or imageAsset, not both.";
  }
  return null;
}

async function resolveProductImageInput(
  tenantId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { imageAsset: rawAsset, ...cleanInput } = input;
  const asset = plainObject(rawAsset);
  if (asset) {
    const uploaded = await resolveMcpImage(tenantId, asset, "product");
    return { ...cleanInput, image: uploaded.url };
  }

  const image = cleanString(input.image, 2_000);
  if (image) {
    return {
      ...cleanInput,
      image: await validatePublicMcpImageUrl(image, "product image"),
    };
  }
  return cleanInput;
}

function mergeProductPatch(existing: McpProductRow, displaySymbol: string, patch: Record<string, unknown>) {
  const current = dbProductToStorefront(existing, displaySymbol);
  const { id: _id, productId: _productId, slug: _slug, productSlug: _productSlug, sku: _sku, ...cleanPatch } = patch;
  void _id;
  void _productId;
  void _slug;
  void _productSlug;
  void _sku;
  return normalizeProductInput({ ...current, ...cleanPatch, id: existing.id });
}

async function callBulkAddProducts(req: NextRequest, args: Record<string, unknown>) {
  const authError = requireMcpAuth(req, args);
  if (authError) {
    return {
      content: [{ type: "text", text: authError }],
      isError: true,
    };
  }

  const tenantSlug = cleanString(args.tenantSlug ?? args.slug, 80).toLowerCase();
  if (!tenantSlug) {
    return {
      content: [{ type: "text", text: "tenantSlug is required." }],
      isError: true,
    };
  }

  const rawProducts = Array.isArray(args.products)
    ? args.products
    : args.product !== undefined
      ? [args.product]
      : [];
  if (!rawProducts.length) {
    return {
      content: [{ type: "text", text: "Provide product or products." }],
      isError: true,
    };
  }
  if (rawProducts.length > 100) {
    return {
      content: [{ type: "text", text: "Bulk add is limited to 100 products per call." }],
      isError: true,
    };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) {
    return {
      content: [{ type: "text", text: `Tenant "${tenantSlug}" was not found.` }],
      isError: true,
    };
  }

  const duplicateMode = args.duplicateMode === "create" ? "create" : "skip";
  const defaultCategory = cleanString(args.defaultCategory, 64);
  const resellerEntitled = await hasFeature(tenant.id, FEATURES.STORE_RESELLER_PORTAL);

  try {
    const context = await withTenant(tenant.id, async (db) => {
      const branding = await db.branding.findUnique({
        where: { tenantId: tenant.id },
        select: { config: true },
      });
      const brandingConfig = plainObject(branding?.config) ?? {};
      const defaultCurrency =
        cleanString(args.currency, 8) || cleanString(brandingConfig.currency, 8) || "₱";

      const existing = await db.product.findMany({
        where: { status: { not: "archived" } },
        select: { name: true, slug: true, sku: true },
      });
      return { defaultCurrency, existing };
    });

    const nameSet = new Set(context.existing.map((p) => lowerName(p.name)));
    const slugSet = new Set(context.existing.map((p) => p.slug).filter((s): s is string => !!s));
    const skuSet = new Set(context.existing.map((p) => p.sku));
    const skipped: { index: number; name: string; reason: string }[] = [];
    const errors: { index: number; name?: string; error: string }[] = [];
    const candidates: {
      index: number;
      input: Record<string, unknown>;
      name: string;
      slug: string;
      sku: string;
    }[] = [];

    rawProducts.forEach((raw, index) => {
      const product = plainObject(raw);
      if (!product) {
        errors.push({ index, error: "Product must be an object." });
        return;
      }

      const imageError = productImageInputError(product);
      const input = {
        ...product,
        currency: cleanString(product.currency, 8) || context.defaultCurrency,
        category: cleanString(product.category, 64) || defaultCategory,
      };
      const p = normalizeProductInput(input);
      if (!p.name) errors.push({ index, error: "Product name is required." });
      else if (!p.category) errors.push({ index, name: p.name, error: "Product category is required." });
      else if (imageError) errors.push({ index, name: p.name, error: imageError });
      else {
        const nameKey = lowerName(p.name);
        if (duplicateMode === "skip" && nameSet.has(nameKey)) {
          skipped.push({ index, name: p.name, reason: "A product with this name already exists." });
          return;
        }
        const baseSlug = slugify(p.name);
        const finalSlug = uniqueize(baseSlug, slugSet);
        const finalSku = uniqueize(skuBase(product, baseSlug), skuSet);
        slugSet.add(finalSlug);
        skuSet.add(finalSku);
        nameSet.add(nameKey);
        candidates.push({ index, input, name: p.name, slug: finalSlug, sku: finalSku });
      }
    });

    const pending: {
      displaySymbol: string;
      data: {
        tenantId: string;
        sku: string;
        slug: string;
        name: string;
        description: string | null;
        priceCents: number;
        currency: string;
        stock: number;
        status: string;
        active: boolean;
        images: string[];
        metadata: Record<string, unknown>;
      };
    }[] = [];

    if (!errors.length) {
      for (const candidate of candidates) {
        try {
          const resolvedInput = await resolveProductImageInput(tenant.id, candidate.input);
          const p = normalizeProductInput(resolvedInput);
          const write = productToDbWrite(p, currencySymbolToIso(p.currency), p.currency);
          pending.push({
            displaySymbol: p.currency,
            data: {
              tenantId: tenant.id,
              sku: candidate.sku,
              slug: candidate.slug,
              name: write.name,
              description: write.description,
              priceCents: write.priceCents,
              currency: write.currency,
              stock: write.stock,
              status: write.status,
              active: write.active,
              images: write.images,
              metadata: preserveResellerMetadata(
                write.metadata as Record<string, unknown>,
                undefined,
                resellerEntitled,
              ),
            },
          });
        } catch (e) {
          errors.push({
            index: candidate.index,
            name: candidate.name,
            error: e instanceof Error ? e.message : "Product image upload failed.",
          });
        }
      }
    }

    if (errors.length) {
      const result = { tenant, added: [], skipped, errors };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: true,
      };
    }

    const added = await withTenant(tenant.id, async (db) => {
      const added = [];
      for (const item of pending) {
        const saved = await db.product.create({
          data: {
            ...item.data,
            images: item.data.images as unknown as Prisma.InputJsonValue,
            metadata: item.data.metadata as Prisma.InputJsonValue,
          },
        });
        added.push(dbProductToStorefront(saved as DbProductRow, item.displaySymbol));
      }
      return added;
    });

    const result = { tenant, added, skipped, errors };

    if (result.added.length) revalidateTenant(tenant.id, tenant.slug);

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
      isError: false,
    };
  } catch (e) {
    const text =
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
        ? "A product slug or SKU collided with an existing product. Retry with duplicateMode=create or provide distinct names/SKUs."
        : e instanceof Error
          ? e.message
          : "Failed to add products.";
    return {
      content: [{ type: "text", text }],
      isError: true,
    };
  }
}

async function callUpdateProducts(req: NextRequest, args: Record<string, unknown>) {
  const authError = requireMcpAuth(req, args);
  if (authError) {
    return {
      content: [{ type: "text", text: authError }],
      isError: true,
    };
  }

  const tenantSlug = cleanString(args.tenantSlug ?? args.slug, 80).toLowerCase();
  if (!tenantSlug) {
    return {
      content: [{ type: "text", text: "tenantSlug is required." }],
      isError: true,
    };
  }

  const rawUpdates = Array.isArray(args.updates)
    ? args.updates
    : args.match !== undefined || args.patch !== undefined
      ? [{ ...(plainObject(args.match) ?? {}), patch: args.patch }]
      : [];
  if (!rawUpdates.length) {
    return {
      content: [{ type: "text", text: "Provide match + patch or updates." }],
      isError: true,
    };
  }
  if (rawUpdates.length > 100) {
    return {
      content: [{ type: "text", text: "Product updates are limited to 100 products per call." }],
      isError: true,
    };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) {
    return {
      content: [{ type: "text", text: `Tenant "${tenantSlug}" was not found.` }],
      isError: true,
    };
  }

  const defaultCategory = cleanString(args.defaultCategory, 64);
  const resellerEntitled = await hasFeature(tenant.id, FEATURES.STORE_RESELLER_PORTAL);

  try {
    const context = await withTenant(tenant.id, async (db) => {
      const branding = await db.branding.findUnique({
        where: { tenantId: tenant.id },
        select: { config: true },
      });
      const brandingConfig = plainObject(branding?.config) ?? {};
      const defaultCurrency =
        cleanString(args.currency, 8) || cleanString(brandingConfig.currency, 8) || "₱";

      const rows = (await db.product.findMany({
        where: { status: { not: "archived" } },
        orderBy: { createdAt: "asc" },
      })) as McpProductRow[];
      return { defaultCurrency, rows };
    });

    const errors: { index: number; match: string; error: string }[] = [];
    const candidates: {
      index: number;
      match: string;
      row: McpProductRow;
      displaySymbol: string;
      patch: Record<string, unknown>;
    }[] = [];
    const seen = new Set<string>();

    rawUpdates.forEach((raw, index) => {
      const update = plainObject(raw);
      if (!update) {
        errors.push({ index, match: "invalid", error: "Update must be an object." });
        return;
      }

      const match = productMatchFrom(update);
      const label = matchLabel(match);
      const resolved = resolveProductMatch(context.rows, match);
      if (!isProductRow(resolved)) {
        errors.push({ index, match: label, error: resolved.error });
        return;
      }
      if (seen.has(resolved.id)) {
        errors.push({ index, match: label, error: "This product is already being updated in this call." });
        return;
      }

      const patch = productPatchFrom(update.patch);
      const imageError = productImageInputError(patch);
      if (!Object.keys(patch).length) errors.push({ index, match: label, error: "Patch is empty." });
      else if (imageError) errors.push({ index, match: label, error: imageError });
      else {
        seen.add(resolved.id);
        candidates.push({
          index,
          match: label,
          row: resolved,
          displaySymbol: cleanString(patch.currency, 8) || context.defaultCurrency,
          patch,
        });
      }
    });

    const pending: {
      row: McpProductRow;
      displaySymbol: string;
      write: ReturnType<typeof productToDbWrite>;
    }[] = [];

    if (!errors.length) {
      for (const item of candidates) {
        try {
          const resolvedPatch = await resolveProductImageInput(tenant.id, item.patch);
          const p = mergeProductPatch(item.row, item.displaySymbol, resolvedPatch);
          if (!p.name) throw new Error("Product name is required.");
          if (!p.category && !defaultCategory) throw new Error("Product category is required.");
          if (!p.category) p.category = defaultCategory;
          pending.push({
            row: item.row,
            displaySymbol: p.currency,
            write: productToDbWrite(p, currencySymbolToIso(p.currency), p.currency),
          });
        } catch (e) {
          errors.push({
            index: item.index,
            match: item.match,
            error: e instanceof Error ? e.message : "Product update validation failed.",
          });
        }
      }
    }

    if (errors.length) {
      const result = { tenant, updated: [], errors };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: true,
      };
    }

    const updated = await withTenant(tenant.id, async (db) => {
      const savedProducts = [];
      for (const item of pending) {
        const write = item.write;
        const saved = await db.product.update({
          where: { id: item.row.id },
          data: {
            name: write.name,
            description: write.description,
            priceCents: write.priceCents,
            currency: write.currency,
            stock: write.stock,
            status: write.status,
            active: write.active,
            images: write.images as unknown as Prisma.InputJsonValue,
            metadata: preserveResellerMetadata(
              write.metadata as Record<string, unknown>,
              item.row.metadata,
              resellerEntitled,
            ) as Prisma.InputJsonValue,
          },
        });
        savedProducts.push(dbProductToStorefront(saved as DbProductRow, item.displaySymbol));
      }
      return savedProducts;
    });
    const result = { tenant, updated, errors };

    if (result.updated.length) revalidateTenant(tenant.id, tenant.slug);

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
      isError: false,
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: e instanceof Error ? e.message : "Failed to update products." }],
      isError: true,
    };
  }
}

async function callUploadHeroImage(req: NextRequest, args: Record<string, unknown>) {
  const authError = requireMcpAuth(req, args);
  if (authError) {
    return {
      content: [{ type: "text", text: authError }],
      isError: true,
    };
  }

  const tenantSlug = cleanString(args.tenantSlug ?? args.slug, 80).toLowerCase();
  if (!tenantSlug) {
    return {
      content: [{ type: "text", text: "tenantSlug is required." }],
      isError: true,
    };
  }

  const image = plainObject(args.image);
  if (!image) {
    return {
      content: [{ type: "text", text: "image is required." }],
      isError: true,
    };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) {
    return {
      content: [{ type: "text", text: `Tenant "${tenantSlug}" was not found.` }],
      isError: true,
    };
  }

  try {
    const heroImage = await resolveMcpImage(tenant.id, image, "hero");
    const result = await withTenant(tenant.id, async (db) => {
      const branding = await db.branding.findUnique({
        where: { tenantId: tenant.id },
        select: { config: true },
      });
      const current = plainObject(branding?.config) ?? {};
      const existingMedia = plainObject(current.heroMedia) ?? {};
      const heroMedia = normalizeHeroMedia({
        heroMedia: {
          ...existingMedia,
          mode: "image",
          url: heroImage.url,
          alt: cleanString(args.alt, 200) || cleanString(existingMedia.alt, 200) || `${tenant.name} hero image`,
          ratio: args.ratio ?? existingMedia.ratio ?? "standard",
          focus: args.focus ?? existingMedia.focus ?? "center",
          overlay: args.overlay ?? existingMedia.overlay ?? true,
          scrim: args.scrim ?? existingMedia.scrim ?? 30,
          linkType: args.linkType ?? existingMedia.linkType ?? "page",
          linkPage: args.linkPage ?? existingMedia.linkPage ?? "catalog",
          linkUrl: args.linkUrl ?? existingMedia.linkUrl ?? "",
        },
      });
      const config = { ...current, heroMedia };

      await db.branding.upsert({
        where: { tenantId: tenant.id },
        update: { config: config as Prisma.InputJsonValue },
        create: { tenantId: tenant.id, config: config as Prisma.InputJsonValue },
      });

      return {
        tenant,
        heroMedia,
        assets: {
          heroImageUrl: heroImage.url,
          heroImageFileId: heroImage.fileId ?? null,
        },
      };
    });

    revalidateTenant(tenant.id, tenant.slug);

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
      isError: false,
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: e instanceof Error ? e.message : "Failed to upload hero image." }],
      isError: true,
    };
  }
}

async function handleMessage(req: NextRequest, message: JsonRpcRequest) {
  const method = String(message.method ?? "");

  if (!method) return jsonRpcError(message.id, -32600, "Invalid Request");

  if (method === "initialize") {
    const params = paramsObject(message.params);
    const requestedVersion = String(params.protocolVersion || MCP_PROTOCOL_VERSION);
    return jsonRpcResult(message.id, {
      protocolVersion: requestedVersion,
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: SERVER_INFO,
      instructions:
        "This MCP server creates Pepweb whitelabel tenants, adds or edits products on existing tenants, and uploads hero section images. Only call create_whitelabel_tenant after the operator explicitly asks to create a tenant. Only call product tools after the operator explicitly asks to add or edit products for an existing tenant. Product deletion is intentionally unavailable. Only call upload_hero_image after the operator explicitly asks to set a tenant hero image. Ask for missing required tenant, product, or image details before calling.",
    });
  }

  if (method === "notifications/initialized") return undefined;
  if (method === "ping") return jsonRpcResult(message.id, {});

  if (method === "tools/list") {
    return jsonRpcResult(message.id, {
      tools: [
        CREATE_TENANT_TOOL,
        BULK_ADD_PRODUCTS_TOOL,
        UPDATE_PRODUCTS_TOOL,
        UPLOAD_HERO_IMAGE_TOOL,
      ],
    });
  }

  if (method === "tools/call") {
    const params = paramsObject(message.params);
    const name = String(params.name ?? "");
    const args = paramsObject(params.arguments);
    if (name === CREATE_TENANT_TOOL.name) {
      return jsonRpcResult(message.id, await callCreateTenant(req, args));
    }
    if (name === BULK_ADD_PRODUCTS_TOOL.name) {
      return jsonRpcResult(message.id, await callBulkAddProducts(req, args));
    }
    if (name === UPDATE_PRODUCTS_TOOL.name) {
      return jsonRpcResult(message.id, await callUpdateProducts(req, args));
    }
    if (name === UPLOAD_HERO_IMAGE_TOOL.name) {
      return jsonRpcResult(message.id, await callUploadHeroImage(req, args));
    }
    return jsonRpcError(message.id, -32602, `Unknown tool: ${name}`);
  }

  return jsonRpcError(message.id, -32601, `Method not found: ${method}`);
}

export async function OPTIONS() {
  return response({}, 204);
}

export async function GET() {
  return textResponse(
    "Pepweb MCP server is running. Use this URL as the ChatGPT MCP Server URL.",
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return response(jsonRpcError(null, -32700, "Parse error"), 400);
  }

  try {
    if (Array.isArray(body)) {
      const replies = (await Promise.all(body.map((msg) => handleMessage(req, msg as JsonRpcRequest)))).filter(
        Boolean,
      );
      return response(replies);
    }
    const reply = await handleMessage(req, body as JsonRpcRequest);
    return reply ? response(reply) : new NextResponse(null, { status: 202 });
  } catch (e) {
    const id = paramsObject(body).id as JsonRpcId | undefined;
    return response(jsonRpcError(id, -32603, e instanceof Error ? e.message : "Internal error"), 500);
  }
}
