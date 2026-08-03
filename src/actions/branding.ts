"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { isDemoMode, saveDemoBranding, getDemoBranding } from "@/lib/demo/fixtures";
import { uploadTenantMedia } from "@/lib/imagekit/server";
import { getPlatformUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { forTenant } from "@/lib/db/tenant-client";
import { normalizeContactChannels, META_DESCRIPTION_MAX } from "@/lib/storefront/contact-channels";
import { normalizeAdminFee, type AdminFeeConfig } from "@/lib/storefront/admin-fee";
import { normalizeNoticeModal } from "@/lib/storefront/notice-modal";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { STOREFRONT_IMAGE_MAX_BYTES } from "@/lib/upload/limits";
import {
  applyDefaultProductImage,
  isBrandingAssetKind,
  validateBrandingAssetFile,
  type BrandingAssetKind,
} from "@/lib/upload/branding-assets";
import { hashPassword } from "@/lib/auth/password-hash";
import { validateStoreAdminCredentialInput } from "@/lib/auth/store-admin-credential";

export type { BrandingAssetKind };
export type UploadAssetResult = { url: string | null } | { error: string };

/**
 * Upload one of a tenant's branding assets. The upload is forced into the
 * tenant's own ImageKit folder server-side (see `uploadTenantMedia`) and a
 * `MediaAsset` row records it. Where the URL is stored depends on the kind:
 * the logo and favicon own their `Branding` columns, while the default product
 * image — the fallback photo for products with no image of their own — is a
 * key inside the shared `branding.config` blob, merged read-modify-write.
 *
 * In demo mode (no DB / no ImageKit creds) the image is persisted as a data
 * URL so the storefront still round-trips locally. A data URL is deliberately
 * refused by `normalizeDefaultProductImage`, so a demo default product image
 * shows in this editor but not on the storefront — demo has nowhere to host it.
 */
export async function uploadBrandingAssetAction(
  slug: string,
  kind: BrandingAssetKind,
  formData: FormData,
): Promise<UploadAssetResult> {
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Invalid tenant slug." };
  if (!isBrandingAssetKind(kind)) return { error: "Invalid asset kind." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file provided." };
  // Per-kind: a product photo gets the 10 MB budget and photographic types
  // only; a logo/favicon stays at 2 MB but may be a vector or an .ico.
  const invalid = validateBrandingAssetFile(kind, { type: file.type, size: file.size });
  if (invalid) return { error: invalid };

  const bytes = Buffer.from(await file.arrayBuffer());

  // ── Demo mode: no DB / no ImageKit — store a data URL so it renders locally.
  if (isDemoMode()) {
    const dataUrl = `data:${file.type};base64,${bytes.toString("base64")}`;
    if (kind === "defaultProductImage") {
      const current = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
      saveDemoBranding(slug, { config: applyDefaultProductImage(current, dataUrl) });
    } else {
      saveDemoBranding(slug, kind === "logo" ? { logoUrl: dataUrl } : { faviconUrl: dataUrl });
    }
    revalidatePath("/admin");
    revalidateTenant(slug, slug); // storefronts re-read branding (demo: id = slug)
    return { url: dataUrl };
  }

  // ── Production: platform-operator only; resolve the tenant by slug. ──
  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, branding: { select: { config: true } } },
  });
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
    // tenantId, so these single-row writes are already tenant-scoped. The
    // default product image is a key in the config blob rather than a column,
    // so it merges instead of overwriting (upsert: a tenant may have no row).
    if (kind === "defaultProductImage") {
      const current = (tenant.branding?.config ?? {}) as Record<string, unknown>;
      const config = applyDefaultProductImage(current, uploaded.url) as Prisma.InputJsonValue;
      await prisma.branding.upsert({
        where: { tenantId: tenant.id },
        update: { config },
        create: { tenantId: tenant.id, config },
      });
    } else {
      await prisma.branding.update({
        where: { tenantId: tenant.id },
        data: kind === "logo" ? { logoUrl: uploaded.url } : { faviconUrl: uploaded.url },
      });
    }

    revalidatePath("/admin");
    revalidateTenant(tenant.id, slug);
    return { url: uploaded.url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }
}

export type UploadImageResult = { url: string } | { error: string };

const MAX_IMAGE_BYTES = STOREFRONT_IMAGE_MAX_BYTES; // 10 MB

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

/**
 * Clear a branding asset override: the storefront falls back to the monogram
 * (logo), the generated tile (favicon), or the card's SVG placeholder (default
 * product image). The hosted file is left in ImageKit — same as before, the
 * media library keeps the audit row.
 */
export async function removeBrandingAssetAction(
  slug: string,
  kind: BrandingAssetKind,
): Promise<UploadAssetResult> {
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Invalid tenant slug." };
  if (!isBrandingAssetKind(kind)) return { error: "Invalid asset kind." };

  if (isDemoMode()) {
    if (kind === "defaultProductImage") {
      const current = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
      saveDemoBranding(slug, { config: applyDefaultProductImage(current, null) });
    } else {
      saveDemoBranding(slug, kind === "logo" ? { logoUrl: null } : { faviconUrl: null });
    }
    revalidatePath("/admin");
    revalidateTenant(slug, slug);
    return { url: null };
  }

  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, branding: { select: { config: true } } },
  });
  if (!tenant) return { error: "Tenant not found." };

  if (kind === "defaultProductImage") {
    const current = (tenant.branding?.config ?? {}) as Record<string, unknown>;
    const config = applyDefaultProductImage(current, null) as Prisma.InputJsonValue;
    await prisma.branding.upsert({
      where: { tenantId: tenant.id },
      update: { config },
      create: { tenantId: tenant.id, config },
    });
  } else {
    await prisma.branding.update({
      where: { tenantId: tenant.id },
      data: kind === "logo" ? { logoUrl: null } : { faviconUrl: null },
    });
  }
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
 * Toggle whether the tenant's storefront checkout requires a proof-of-payment
 * upload. Stored in the shared `branding.config` blob as `requireProofOfPayment`
 * (read-modify-write, so it never clobbers the rest of the storefront config).
 * Absent/true → required (historical default); false → the upload is optional.
 */
export async function saveRequirePaymentProofAction(
  slug: string,
  require: boolean,
): Promise<SaveResult> {
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Invalid tenant slug." };

  const requireProofOfPayment = require !== false;

  if (isDemoMode()) {
    const current = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
    saveDemoBranding(slug, { config: { ...current, requireProofOfPayment } });
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
  const config = { ...current, requireProofOfPayment } as Prisma.InputJsonValue;

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
 * Grant/revoke the Storefront Notice Modal for a tenant. Super-admin only. This
 * is the OPERATOR half of the two-flag gate: it flips
 * `branding.config.noticeModal.operatorEnabled` (read-modify-write, preserving
 * the owner's copy + their own `enabled` toggle). Default OFF for every tenant —
 * nothing is auto-enabled. The store owner's editor (saveNoticeModalAction) can
 * never touch this flag; the modal shows only when this AND the owner toggle are on.
 */
export async function saveNoticeModalGrantAction(
  slug: string,
  granted: boolean,
): Promise<SaveResult> {
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Invalid tenant slug." };

  const operatorEnabled = granted === true;
  const merge = (config: Record<string, unknown>): Record<string, unknown> => {
    const prev =
      config.noticeModal && typeof config.noticeModal === "object" ? config.noticeModal : {};
    // Normalize the whole blob so a legacy/absent config becomes valid, then
    // force the operator flag — the owner's content + `enabled` are preserved.
    const noticeModal = normalizeNoticeModal({ ...(prev as Record<string, unknown>), operatorEnabled });
    return { ...config, noticeModal };
  };

  if (isDemoMode()) {
    const current = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
    saveDemoBranding(slug, { config: merge(current) });
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
  const config = merge(current) as Prisma.InputJsonValue;

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
 * Configure the tenant's checkout admin fee: whether one is charged, what it's
 * for (the line label customers see), and the flat amount added on top of the
 * order total. Super-admin only. Stored in the shared `branding.config` blob as
 * `adminFee` (read-modify-write, so it never clobbers the rest of the config).
 * The label/amount persist even while the toggle is off, so flipping it back on
 * restores the previous fee.
 */
export async function saveAdminFeeAction(
  slug: string,
  input: AdminFeeConfig,
): Promise<SaveResult> {
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Invalid tenant slug." };

  const adminFee = normalizeAdminFee(input);
  // An enabled fee of zero would render a confusing "+ ₱0" line at checkout —
  // require a real amount or an explicit off.
  if (adminFee.enabled && adminFee.amount <= 0) {
    return { error: "Set a fee amount above zero, or turn the fee off." };
  }

  if (isDemoMode()) {
    const current = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
    saveDemoBranding(slug, { config: { ...current, adminFee } });
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
  const config = { ...current, adminFee } as Prisma.InputJsonValue;

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
 * Set the STORE-ADMIN credential for a tenant's storefront admin
 * (`<slug>.<root>/#admin`): the owner's sign-in email and/or their password.
 *
 * Both live on the Tenant row — `storeAdminEmail` and `storeAdminPasswordHash`
 * — NOT in branding.config, because that blob is spread wholesale into the
 * client `brand` object and would ship the credential to every visitor.
 *
 * The password is stored as a scrypt hash and can never be read back: the
 * operator can only SET a new one and tell the owner what it is. A blank
 * password means "leave the current one alone" (so the email can be edited on
 * its own); it does NOT clear the password or restore any default — there is no
 * default any more, and a tenant with no credential simply cannot sign in.
 */
export async function saveAdminPasswordAction(
  slug: string,
  password: string,
  email: string,
): Promise<SaveResult> {
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Invalid tenant slug." };

  if (isDemoMode()) {
    const current = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
    const checked = validateStoreAdminCredentialInput({
      email,
      password,
      hasExistingPassword: typeof current.adminPasswordHash === "string",
    });
    if (!checked.ok) return { error: checked.error };

    const config: Record<string, unknown> = { ...current, adminEmail: checked.email };
    if (checked.password) config.adminPasswordHash = hashPassword(checked.password);
    saveDemoBranding(slug, { config });
    revalidatePath("/admin");
    revalidateTenant(slug, slug);
    return { ok: true };
  }

  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, storeAdminPasswordHash: true },
  });
  if (!tenant) return { error: "Tenant not found." };

  // Whether a password already exists decides if a blank one is allowed — so it
  // has to be read from the row, never trusted from the client.
  const checked = validateStoreAdminCredentialInput({
    email,
    password,
    hasExistingPassword: Boolean(tenant.storeAdminPasswordHash),
  });
  if (!checked.ok) return { error: checked.error };

  const data: { storeAdminEmail: string; storeAdminPasswordHash?: string } = {
    storeAdminEmail: checked.email,
  };
  if (checked.password) data.storeAdminPasswordHash = hashPassword(checked.password);

  await prisma.tenant.update({ where: { id: tenant.id }, data });

  revalidatePath("/admin");
  revalidateTenant(tenant.id, slug);
  return { ok: true };
}


