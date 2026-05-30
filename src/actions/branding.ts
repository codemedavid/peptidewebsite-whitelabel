"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { isDemoMode, saveDemoBranding, getDemoBranding } from "@/lib/demo/fixtures";
import { uploadTenantMedia } from "@/lib/imagekit/server";
import { getPlatformUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { forTenant } from "@/lib/db/tenant-client";
import { normalizeContactChannels, META_DESCRIPTION_MAX } from "@/lib/storefront/contact-channels";
import { revalidateTenant } from "@/lib/tenant/revalidate";

export type BrandingAssetKind = "logo" | "favicon";
export type UploadAssetResult = { url: string | null } | { error: string };

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — logos/favicons are small
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

/**
 * Upload a tenant's logo or favicon. The upload is forced into the tenant's
 * own ImageKit folder server-side (see `uploadTenantMedia`), the URL is stored
 * on `Branding.logoUrl` / `Branding.faviconUrl`, and a `MediaAsset` row records
 * it. In demo mode (no DB / no ImageKit creds) the image is persisted as a data
 * URL so the storefront still round-trips locally.
 */
export async function uploadBrandingAssetAction(
  slug: string,
  kind: BrandingAssetKind,
  formData: FormData,
): Promise<UploadAssetResult> {
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Invalid tenant slug." };
  if (kind !== "logo" && kind !== "favicon") return { error: "Invalid asset kind." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file provided." };
  if (file.size > MAX_BYTES) return { error: "File too large (max 2 MB)." };
  if (!ALLOWED_TYPES.has(file.type)) {
    return { error: `Unsupported type: ${file.type || "unknown"}.` };
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // ── Demo mode: no DB / no ImageKit — store a data URL so it renders locally.
  if (isDemoMode()) {
    const dataUrl = `data:${file.type};base64,${bytes.toString("base64")}`;
    saveDemoBranding(slug, kind === "logo" ? { logoUrl: dataUrl } : { faviconUrl: dataUrl });
    revalidatePath("/admin");
    revalidateTenant(slug, slug); // storefronts re-read branding (demo: id = slug)
    return { url: dataUrl };
  }

  // ── Production: platform-operator only; resolve the tenant by slug. ──
  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) return { error: "Tenant not found." };

  try {
    const uploaded = await uploadTenantMedia({
      tenantId: tenant.id,
      file: bytes,
      fileName: `${kind}-${file.name || kind}`,
      tags: [`branding:${kind}`],
    });

    // Record the asset. forTenant also stamps tenantId at runtime; we pass it
    // explicitly so the create is statically typed (it re-stamps the same id).
    await forTenant(tenant.id).mediaAsset.create({
      data: {
        tenantId: tenant.id,
        imagekitId: uploaded.fileId,
        url: uploaded.url,
        type: `branding:${kind}`,
      },
    });
    // ... and point the branding row at it. Branding is keyed by the unique
    // tenantId, so this single-row update is already tenant-scoped.
    await prisma.branding.update({
      where: { tenantId: tenant.id },
      data: kind === "logo" ? { logoUrl: uploaded.url } : { faviconUrl: uploaded.url },
    });

    revalidatePath("/admin");
    revalidateTenant(tenant.id, slug);
    return { url: uploaded.url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }
}

export type UploadImageResult = { url: string } | { error: string };

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Upload an arbitrary storefront image (e.g. the logo picked in the Storefront
 * tab of the branding editor) as a PLATFORM OPERATOR editing tenant `slug`.
 *
 * The storefront's own `uploadStorefrontImageAction` is gated on an
 * `sf_admin_session` cookie for the tenant resolved from the request host — that
 * never holds in the platform admin console (different auth, platform host), so
 * uploads there failed with "Not signed in to the store admin." This is the
 * operator-side equivalent: it authorizes via the platform session and resolves
 * the tenant from the route `slug`, forcing the file into that tenant's own
 * ImageKit folder. It returns just the hosted URL; the caller persists it onto
 * the branding config via Save branding (it does NOT touch the DB itself).
 */
export async function uploadStorefrontImageAsAdminAction(
  slug: string,
  formData: FormData,
): Promise<UploadImageResult> {
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Invalid tenant slug." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file provided." };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Image too large (max 10 MB)." };
  if (!file.type.startsWith("image/")) {
    return { error: `Unsupported type: ${file.type || "unknown"}.` };
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Demo mode: no DB / no ImageKit — round-trip the bytes as a data URL.
  if (isDemoMode()) {
    return { url: `data:${file.type};base64,${bytes.toString("base64")}` };
  }

  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) return { error: "Tenant not found." };

  try {
    const uploaded = await uploadTenantMedia({
      tenantId: tenant.id,
      file: bytes,
      fileName: `branding-${file.name || "image"}`,
      tags: ["branding"],
    });
    // Best-effort media-library audit row — the image is already hosted.
    try {
      await forTenant(tenant.id).mediaAsset.create({
        data: {
          tenantId: tenant.id,
          imagekitId: uploaded.fileId,
          url: uploaded.url,
          type: "branding",
        },
      });
    } catch {
      /* non-fatal */
    }
    return { url: uploaded.url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }
}

/** Clear a logo/favicon override (storefront falls back to the monogram). */
export async function removeBrandingAssetAction(
  slug: string,
  kind: BrandingAssetKind,
): Promise<UploadAssetResult> {
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Invalid tenant slug." };
  if (kind !== "logo" && kind !== "favicon") return { error: "Invalid asset kind." };

  if (isDemoMode()) {
    saveDemoBranding(slug, kind === "logo" ? { logoUrl: null } : { faviconUrl: null });
    revalidatePath("/admin");
    revalidateTenant(slug, slug);
    return { url: null };
  }

  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) return { error: "Tenant not found." };

  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: kind === "logo" ? { logoUrl: null } : { faviconUrl: null },
  });
  revalidatePath("/admin");
  revalidateTenant(tenant.id, slug);
  return { url: null };
}

export type ContactChannelsInput = {
  contactChannels: { type: string; destination: string; enabled: boolean }[];
  checkoutTitle: string;
  checkoutNote: string;
  metaDescription: string;
};

export type SaveResult = { ok: true } | { error: string };

/**
 * Persist the storefront's order-contact channels + checkout copy. These live
 * inside the `branding.config` blob (alongside the rest of the storefront Brand
 * config), so this does a read-modify-write to merge the contact fields without
 * clobbering the copy/colors the Branding editor manages.
 */
export async function saveContactChannelsAction(
  slug: string,
  input: ContactChannelsInput,
): Promise<SaveResult> {
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Invalid tenant slug." };

  const contactChannels = normalizeContactChannels(input.contactChannels);
  const checkoutTitle = (input.checkoutTitle ?? "").trim();
  const checkoutNote = (input.checkoutNote ?? "").trim();
  const metaDescription = (input.metaDescription ?? "").trim().slice(0, META_DESCRIPTION_MAX);

  // A channel marked enabled but with no destination can't be used — reject so
  // the storefront never shows a dead button.
  const broken = contactChannels.find((c) => c.enabled && !c.destination);
  if (broken) return { error: `Add a destination for ${broken.type}, or turn it off.` };

  const contactFields = { contactChannels, checkoutTitle, checkoutNote, metaDescription };

  if (isDemoMode()) {
    const current = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
    saveDemoBranding(slug, { config: { ...current, ...contactFields } });
    revalidatePath("/admin");
    revalidateTenant(slug, slug);
    return { ok: true };
  }

  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, branding: { select: { config: true } } },
  });
  if (!tenant) return { error: "Tenant not found." };

  const current = (tenant.branding?.config ?? {}) as Record<string, unknown>;
  const config = { ...current, ...contactFields } as Prisma.InputJsonValue;

  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: { config },
    create: { tenantId: tenant.id, config },
  });

  revalidatePath("/admin");
  revalidateTenant(tenant.id, slug);
  return { ok: true };
}

/**
 * Set the password that gates the tenant's storefront admin (`<slug>.<root>/#admin`).
 * Stored in the shared `branding.config` blob as `adminPassword`; a blank value
 * clears the override and the gate falls back to the built-in default ("admin").
 * Read-modify-write so it never clobbers the rest of the storefront Brand config.
 */
export async function saveAdminPasswordAction(
  slug: string,
  password: string,
): Promise<SaveResult> {
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Invalid tenant slug." };

  const adminPassword = (password ?? "").trim();
  if (adminPassword.length > 0 && adminPassword.length < 4) {
    return { error: "Use at least 4 characters, or leave blank for the default." };
  }

  if (isDemoMode()) {
    const current = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
    saveDemoBranding(slug, { config: { ...current, adminPassword } });
    revalidatePath("/admin");
    revalidateTenant(slug, slug);
    return { ok: true };
  }

  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, branding: { select: { config: true } } },
  });
  if (!tenant) return { error: "Tenant not found." };

  const current = (tenant.branding?.config ?? {}) as Record<string, unknown>;
  const config = { ...current, adminPassword } as Prisma.InputJsonValue;

  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: { config },
    create: { tenantId: tenant.id, config },
  });

  revalidatePath("/admin");
  revalidateTenant(tenant.id, slug);
  return { ok: true };
}
