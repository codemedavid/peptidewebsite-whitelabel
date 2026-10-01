import "server-only";

import { createHash } from "node:crypto";
import type { CommunityUpload } from "@prisma/client";
import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import { isDemoMode } from "@/lib/demo/fixtures";
import { uploadTenantMedia } from "@/lib/imagekit/server";
import type { UploadResponse } from "@/lib/mobile/contract";
import type { CommunityActor } from "./actor.server";
import { FILE_MAX_BYTES, INLINE_MAX_BYTES, classifyUpload, imageSize, sanitizeFileName } from "./upload-kind";

/**
 * POST /community/uploads — a photo or document for a message (or a channel /
 * topic picture), into the tenant's own ImageKit folder (forced from the
 * session's tenant, never the client). The type is decided from the bytes
 * (upload-kind.ts). Demo mode, or ImageKit not configured → the bytes come back
 * as a data URL (≤ 2 MB), the same local fallback the admin uploads use.
 *
 * Every upload is recorded (CommunityUpload). Anything that later REFERENCES a
 * file — a message attachment, a channel or topic picture — must match a
 * record of this tenant uploaded by this participant, and the file's name,
 * size, type and dimensions are read from that record, never from the request.
 */

const HEAD_BYTES = 512;

/** Real ImageKit credentials present (not blank / not placeholders). */
export function imageKitConfigured(): boolean {
  const bad = (v?: string) => !v || v.trim() === "" || v.toLowerCase().includes("placeholder");
  return (
    !bad(process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY) &&
    !bad(process.env.IMAGEKIT_PRIVATE_KEY) &&
    !bad(process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT)
  );
}

function inlineMode(): boolean {
  return isDemoMode() || !imageKitConfigured();
}

export function urlHash(url: string): string {
  return createHash("sha256").update(url, "utf8").digest("hex");
}

export type UploadOutcome = { ok: true; upload: UploadResponse } | { ok: false; message: string };

export async function uploadCommunityFile(actor: CommunityActor, file: unknown): Promise<UploadOutcome> {
  if (!(file instanceof File)) return { ok: false, message: "Choose a photo or file to send." };
  const inline = inlineMode();
  const cap = inline ? INLINE_MAX_BYTES : FILE_MAX_BYTES;
  if (file.size > cap) return { ok: false, message: inline ? "Files can be up to 2 MB here." : "Files can be up to 25 MB." };
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > cap) return { ok: false, message: "That file is too large." };
  const head = new Uint8Array(bytes.subarray(0, HEAD_BYTES));
  const verdict = classifyUpload({ name: file.name, declaredMime: file.type, head, size: bytes.length });
  if (!verdict.ok) return { ok: false, message: verdict.error };

  const name = sanitizeFileName(file.name, verdict.ext);
  const dims = verdict.kind === "image" ? imageSize(head) : null;
  let url: string;
  let imagekitId: string | null = null;
  if (inline) {
    url = `data:${verdict.mime};base64,${bytes.toString("base64")}`;
  } else {
    const uploaded = await uploadTenantMedia({
      tenantId: actor.tenantId,
      file: bytes,
      fileName: `community-${name}`,
      tags: ["community"],
    });
    url = uploaded.url;
    imagekitId = uploaded.fileId;
  }

  await withTenant(actor.tenantId, async (db) => {
    await db.communityUpload.create({
      data: {
        tenantId: actor.tenantId,
        uploaderKey: actor.key,
        authorKey: actor.authorKey,
        kind: verdict.kind,
        url,
        urlHash: urlHash(url),
        name,
        size: bytes.length,
        mime: verdict.mime,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
      },
    });
    // Media-library row, as the admin uploads do (hosted files only).
    if (imagekitId) {
      await db.mediaAsset.create({ data: { tenantId: actor.tenantId, imagekitId, url, type: "community" } });
    }
  });

  return {
    ok: true,
    upload: {
      kind: verdict.kind,
      url,
      name,
      size: bytes.length,
      mime: verdict.mime,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
    },
  };
}

/**
 * The upload record behind `url`, if THIS participant uploaded it to THIS
 * tenant (the store team shares the `store` key) and it is of `kind`.
 * Inline data URLs only count while the inline fallback is actually in use.
 */
export async function findOwnUpload(
  db: TenantTx,
  actor: { key: string },
  url: unknown,
  kind: "image" | "file",
): Promise<CommunityUpload | null> {
  if (typeof url !== "string" || url.length === 0) return null;
  if (url.startsWith("data:") && !inlineMode()) return null;
  const row = await db.communityUpload.findFirst({
    where: { urlHash: urlHash(url), uploaderKey: actor.key, kind },
    orderBy: { createdAt: "desc" },
  });
  return row && row.url === url ? row : null;
}
