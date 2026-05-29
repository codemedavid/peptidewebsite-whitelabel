"use server";

// Generic storefront-admin image upload → the tenant's own ImageKit folder.
// One place for every "upload an image in the store admin" path that isn't a
// product image (which has its own action): payment-method QR codes, lab/COA
// result images, review photos, live-branding images, etc. Gated on a real
// `sf_admin_session` for the current tenant (resolved from the request host,
// never the client). In demo mode (or when ImageKit isn't configured) the bytes
// round-trip as a data URL so the editor still works locally.

import { requireStorefrontAdmin } from "@/lib/auth/storefront-admin";
import { withTenant } from "@/lib/db/tenant-client";
import { uploadTenantMedia } from "@/lib/imagekit/server";
import { isDemoMode } from "@/lib/demo/fixtures";

export type UploadImageResult = { url: string } | { error: string };

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Whether real ImageKit credentials are present (not blank / not placeholders). */
function imageKitConfigured(): boolean {
  const bad = (v?: string) => !v || v.trim() === "" || v.toLowerCase().includes("placeholder");
  return (
    !bad(process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY) &&
    !bad(process.env.IMAGEKIT_PRIVATE_KEY) &&
    !bad(process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT)
  );
}

// Allowed `kind` values become the ImageKit tag + MediaAsset.type, so they stay
// a short known set rather than arbitrary client strings.
const KINDS = new Set(["payment-qr", "lab-result", "review", "branding", "storefront"]);

/**
 * Upload an admin-supplied image to the tenant's ImageKit folder and return its
 * hosted URL. `kind` (form field) labels the asset; the folder is always forced
 * from the server-derived tenantId, so one store can't write into another's.
 */
export async function uploadStorefrontImageAction(formData: FormData): Promise<UploadImageResult> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Not signed in to the store admin." };

  const file = formData.get("file");
  const kindRaw = String(formData.get("kind") || "storefront");
  const kind = KINDS.has(kindRaw) ? kindRaw : "storefront";

  if (!(file instanceof File) || file.size === 0) return { error: "No file provided." };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Image too large (max 10 MB)." };
  if (!file.type.startsWith("image/")) {
    return { error: `Unsupported type: ${file.type || "unknown"}.` };
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Demo, or ImageKit not configured → inline so the editor still works.
  if (isDemoMode() || !imageKitConfigured()) {
    return { url: `data:${file.type};base64,${bytes.toString("base64")}` };
  }

  let uploaded;
  try {
    uploaded = await uploadTenantMedia({
      tenantId,
      file: bytes,
      fileName: `${kind}-${file.name || "image"}`,
      tags: [kind],
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }

  // Best-effort media-library audit row — the image is already hosted.
  try {
    await withTenant(tenantId, (db) =>
      db.mediaAsset.create({
        data: { tenantId, imagekitId: uploaded.fileId, url: uploaded.url, type: kind },
      }),
    );
  } catch {
    /* non-fatal */
  }

  return { url: uploaded.url };
}
