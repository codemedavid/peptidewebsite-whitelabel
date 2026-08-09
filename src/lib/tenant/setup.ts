import { Prisma } from "@prisma/client";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { uploadTenantMedia } from "@/lib/imagekit/server";
import { forTenant } from "@/lib/db/tenant-client";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { normalizeOrderNumberFormat, type OrderNumberFormat } from "@/lib/orders/order-number-format";
import { normalizeCurrency } from "@/lib/storefront/currency";
import { normalizeHeroContent } from "@/lib/storefront/hero-content";
import { normalizeHeroLinks } from "@/lib/storefront/hero-links";
import { normalizeHeroMedia, safeImageSrc, type HeroMedia } from "@/lib/storefront/hero-media";
import {
  applyDefaultProductImage,
  validateBrandingAssetFile,
  type BrandingAssetKind,
} from "@/lib/upload/branding-assets";
import type { Brand } from "@/storefront/types";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").replace(/:\d+$/, "");

const tenantSlugSchema = z
  .string()
  .min(2)
  .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers and hyphens only");

const planKeySchema = z.enum(["starter", "pro", "enterprise"]);
const statusSchema = z.enum(["trial", "active", "pending_setup", "suspended"]);

const assetSchema = z
  .object({
    url: z.string().trim().optional(),
    dataUrl: z.string().trim().optional(),
    dataBase64: z.string().trim().optional(),
    mimeType: z.string().trim().optional(),
    fileName: z.string().trim().optional(),
    upload: z.boolean().optional(),
  })
  .refine((asset) => Boolean(asset.url || asset.dataUrl || asset.dataBase64), {
    message: "Asset needs a url, dataUrl, or dataBase64 value.",
  });

const heroSectionSchema = z
  .object({
    chip: z.string().optional(),
    line1: z.string().optional(),
    line2: z.string().optional(),
    sub: z.string().optional(),
    cta1: z.string().optional(),
    cta2: z.string().optional(),
    cta1LinkType: z.enum(["page", "custom"]).optional(),
    cta1LinkPage: z.string().optional(),
    cta1LinkUrl: z.string().optional(),
    cta2LinkType: z.enum(["page", "custom"]).optional(),
    cta2LinkPage: z.string().optional(),
    cta2LinkUrl: z.string().optional(),
    image: assetSchema.optional(),
    imageAlt: z.string().optional(),
    imageRatio: z.enum(["wide", "standard", "tall"]).optional(),
    imageFocus: z.enum(["center", "top", "bottom", "left", "right"]).optional(),
    imageOverlay: z.boolean().optional(),
    imageScrim: z.number().optional(),
    imageLinkType: z.enum(["page", "custom", "none"]).optional(),
    imageLinkPage: z.string().optional(),
    imageLinkUrl: z.string().optional(),
  })
  .optional();

export const tenantSetupSchema = z.object({
  name: z.string().trim().min(2),
  slug: tenantSlugSchema,
  planKey: planKeySchema.default("pro"),
  status: statusSchema.default("trial"),
  themeId: z.string().trim().min(1).default("clinical-white"),
  ownerUserId: z.string().trim().min(1),
  ownerEmail: z.string().trim().email(),
  storeAdminEmail: z.string().trim().email().optional(),
  supportEmail: z.string().trim().email().optional(),
  industry: z.string().trim().optional(),
  description: z.string().trim().optional(),
  currency: z.string().trim().optional(),
  orderNumberFormat: z.custom<OrderNumberFormat>().optional(),
  logo: assetSchema.optional(),
  favicon: assetSchema.optional(),
  defaultProductImage: assetSchema.optional(),
  hero: heroSectionSchema,
});

export type TenantSetupInput = z.input<typeof tenantSetupSchema>;
export type TenantSetupResult = {
  id: string;
  slug: string;
  url: string;
  assets: {
    logoUrl: string | null;
    faviconUrl: string | null;
    defaultProductImageUrl: string | null;
    heroImageUrl: string | null;
  };
};

type ParsedAsset = z.infer<typeof assetSchema>;
type AssetUpload = { url: string; fileId?: string };

function safeHttpAssetUrl(raw: string | undefined, label: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return s;
  } catch {
    /* handled below */
  }
  throw new Error(`${label} must be an http(s) URL or an uploadable base64 asset.`);
}

function parseDataAsset(asset: ParsedAsset): { bytes: Buffer; mimeType: string } | null {
  if (asset.dataUrl) {
    const match = /^data:([^;,]+);base64,([a-z0-9+/=]+)$/i.exec(asset.dataUrl);
    if (!match) throw new Error("Invalid dataUrl asset.");
    return { mimeType: match[1], bytes: Buffer.from(match[2], "base64") };
  }
  if (asset.dataBase64) {
    if (!asset.mimeType) throw new Error("Base64 assets need a mimeType.");
    return { mimeType: asset.mimeType, bytes: Buffer.from(asset.dataBase64, "base64") };
  }
  return null;
}

function assetFileName(asset: ParsedAsset, fallback: string): string {
  const raw = (asset.fileName || fallback).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return raw || fallback;
}

async function fetchAsset(asset: ParsedAsset, fallbackName: string): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
  const data = parseDataAsset(asset);
  if (data) return { ...data, fileName: assetFileName(asset, fallbackName) };

  const url = safeHttpAssetUrl(asset.url, fallbackName);
  if (!url) throw new Error(`${fallbackName} is missing.`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${fallbackName} (${res.status}).`);
  const mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim() || "application/octet-stream";
  return {
    mimeType,
    bytes: Buffer.from(await res.arrayBuffer()),
    fileName: assetFileName(asset, url.split("/").pop() || fallbackName),
  };
}

async function uploadBrandingAsset(
  tenantId: string,
  kind: BrandingAssetKind,
  asset: ParsedAsset | undefined,
): Promise<AssetUpload | null> {
  if (!asset) return null;
  const needsUpload = asset.upload !== false || Boolean(asset.dataUrl || asset.dataBase64);
  if (!needsUpload) {
    const url = safeHttpAssetUrl(asset.url, kind);
    return url ? { url } : null;
  }

  const file = await fetchAsset(asset, kind);
  const invalid = validateBrandingAssetFile(kind, { type: file.mimeType, size: file.bytes.byteLength });
  if (invalid) throw new Error(`${kind}: ${invalid}`);

  const uploaded = await uploadTenantMedia({
    tenantId,
    file: file.bytes,
    fileName: `${kind}-${file.fileName}`,
    tags: [`branding:${kind}`],
  });
  await forTenant(tenantId).mediaAsset.create({
    data: {
      tenantId,
      imagekitId: uploaded.fileId,
      url: uploaded.url,
      type: `branding:${kind}`,
    },
  });
  return { url: uploaded.url, fileId: uploaded.fileId };
}

async function resolveHeroImage(tenantId: string, asset: ParsedAsset | undefined): Promise<AssetUpload | null> {
  if (!asset) return null;
  const needsUpload = asset.upload !== false || Boolean(asset.dataUrl || asset.dataBase64);
  if (!needsUpload) {
    const url = safeImageSrc(asset.url);
    if (!url) throw new Error("hero image must be a safe http(s) image URL.");
    return { url };
  }

  const file = await fetchAsset(asset, "hero");
  if (!file.mimeType.startsWith("image/")) throw new Error(`hero: Unsupported type: ${file.mimeType || "unknown"}.`);
  const uploaded = await uploadTenantMedia({
    tenantId,
    file: file.bytes,
    fileName: `hero-${file.fileName}`,
    tags: ["branding:hero", "hero"],
  });
  await forTenant(tenantId).mediaAsset.create({
    data: { tenantId, imagekitId: uploaded.fileId, url: uploaded.url, type: "branding:hero" },
  });
  return { url: uploaded.url, fileId: uploaded.fileId };
}

function heroPayload(input: z.infer<typeof tenantSetupSchema>, heroImageUrl: string | null) {
  const hero = input.hero ?? {};
  const copy = normalizeHeroContent({
    heroChipLabel: hero.chip ?? input.industry ?? "Now open",
    heroLine1: hero.line1 ?? input.name,
    heroLine2: hero.line2 ?? "",
    heroSub: hero.sub ?? input.description ?? `Shop ${input.name} with a fast, branded checkout experience.`,
    heroCta1: hero.cta1 ?? "Shop Now",
    heroCta2: hero.cta2 ?? "Learn More",
  });
  const links = normalizeHeroLinks({
    heroCta1LinkType: hero.cta1LinkType ?? "page",
    heroCta1LinkPage: hero.cta1LinkPage ?? "catalog",
    heroCta1LinkUrl: hero.cta1LinkUrl ?? "",
    heroCta2LinkType: hero.cta2LinkType ?? "page",
    heroCta2LinkPage: hero.cta2LinkPage ?? "reviews",
    heroCta2LinkUrl: hero.cta2LinkUrl ?? "",
  });
  const media: HeroMedia = normalizeHeroMedia({
    heroMedia: {
      mode: heroImageUrl ? "image" : "text",
      url: heroImageUrl ?? "",
      alt: hero.imageAlt ?? `${input.name} hero image`,
      ratio: hero.imageRatio ?? "standard",
      focus: hero.imageFocus ?? "center",
      linkType: hero.imageLinkType ?? "page",
      linkPage: hero.imageLinkPage ?? "catalog",
      linkUrl: hero.imageLinkUrl ?? "",
      overlay: hero.imageOverlay ?? Boolean(heroImageUrl),
      scrim: hero.imageScrim ?? 30,
    },
  });
  return { ...copy, ...links, heroMedia: media };
}

/**
 * Operator/MCP-ready tenant provisioner. It creates the tenant first, then
 * uploads/attaches branding assets into that tenant's ImageKit folder and folds
 * hero/default-product-image fields into Branding.config.
 */
export async function createTenantWithSetup(rawInput: TenantSetupInput): Promise<TenantSetupResult> {
  const input = tenantSetupSchema.parse(rawInput);
  const plan = await prisma.plan.findUnique({ where: { key: input.planKey }, select: { id: true } });
  if (!plan) throw new Error(`Plan not seeded: ${input.planKey}`);

  const money = normalizeCurrency(input.currency);
  const initialConfig: Partial<Brand> = {
    name: input.name,
    industry: input.industry || "premium peptides",
    currency: money.symbol,
  };

  const tenant = await prisma.tenant.create({
    data: {
      name: input.name,
      slug: input.slug,
      status: input.status,
      planId: plan.id,
      orderNumberFormat: normalizeOrderNumberFormat(input.orderNumberFormat ?? {}, input.name),
      storeAdminEmail: input.storeAdminEmail ?? input.ownerEmail,
      branding: {
        create: {
          themeId: input.themeId,
          config: initialConfig as Prisma.InputJsonValue,
        },
      },
      settings: {
        create: {
          storeName: input.name,
          supportEmail: input.supportEmail ?? input.ownerEmail,
          currency: money.code || "PHP",
        },
      },
      members: {
        create: {
          userId: input.ownerUserId,
          email: input.ownerEmail,
          role: "owner",
        },
      },
    },
    select: { id: true, slug: true },
  });

  try {
    const [logo, favicon, defaultProductImage, heroImage] = await Promise.all([
      uploadBrandingAsset(tenant.id, "logo", input.logo),
      uploadBrandingAsset(tenant.id, "favicon", input.favicon),
      uploadBrandingAsset(tenant.id, "defaultProductImage", input.defaultProductImage),
      resolveHeroImage(tenant.id, input.hero?.image),
    ]);

    const config = {
      ...initialConfig,
      ...heroPayload(input, heroImage?.url ?? null),
    };
    const withDefaultImage = defaultProductImage?.url
      ? applyDefaultProductImage(config as Record<string, unknown>, defaultProductImage.url)
      : config;

    await prisma.branding.update({
      where: { tenantId: tenant.id },
      data: {
        ...(logo?.url ? { logoUrl: logo.url } : {}),
        ...(favicon?.url ? { faviconUrl: favicon.url } : {}),
        config: withDefaultImage as Prisma.InputJsonValue,
      },
    });

    revalidateTag(`tenant-host:${tenant.slug}.${ROOT}`);
    revalidateTag("admin:data");
    revalidateTenant(tenant.id, tenant.slug);

    return {
      id: tenant.id,
      slug: tenant.slug,
      url: `${tenant.slug}.${ROOT}`,
      assets: {
        logoUrl: logo?.url ?? null,
        faviconUrl: favicon?.url ?? null,
        defaultProductImageUrl: defaultProductImage?.url ?? null,
        heroImageUrl: heroImage?.url ?? null,
      },
    };
  } catch (e) {
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => undefined);
    throw e;
  }
}
