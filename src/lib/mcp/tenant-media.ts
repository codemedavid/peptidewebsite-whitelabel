// Rehosting an MCP-supplied image into a tenant's own ImageKit folder.
//
// ./image-assets.ts stops at the network edge: it parses data URLs, blocks
// private-network fetches and validates bytes. This module is the step after —
// the ImageKit upload plus the MediaAsset audit row — and it lives apart from
// the route because two tools now need it: the hero-image upload and the
// branding update. Duplicating it would mean one of them could quietly drift
// on SSRF or media-library behavior.

import { withTenant } from "@/lib/db/tenant-client";
import { uploadTenantMedia } from "@/lib/imagekit/server";
import {
  fetchMcpImageAsset,
  validatePublicMcpImageUrl,
  type McpImageAsset,
} from "@/lib/mcp/image-assets";

export type McpMediaKind = "hero" | "product";
export type McpMediaUpload = { url: string; fileId?: string };

/**
 * The JSON Schema every image-accepting MCP tool advertises. Shared so the
 * upload contract a tool DESCRIBES can't drift from the one resolveMcpImage
 * below actually implements.
 */
export const MCP_ASSET_SCHEMA = {
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

/**
 * Resolve an MCP asset to a URL the storefront can render. Uploads by default;
 * `upload: false` keeps an already-hosted URL, which is still validated as a
 * public http(s) target. Raw base64 always uploads — there is nothing to link.
 */
export async function resolveMcpImage(
  tenantId: string,
  asset: McpImageAsset,
  kind: McpMediaKind,
): Promise<McpMediaUpload> {
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
