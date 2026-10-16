import "server-only";

import { createHash } from "node:crypto";
import type { CommunityUpload } from "@prisma/client";
import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import { isDemoMode } from "@/lib/demo/fixtures";
import { getImageKit, tenantMediaFolder, uploadTenantMedia } from "@/lib/imagekit/server";
import type { UploadResponse, VideoUploadTicket } from "@/lib/mobile/contract";
import type { CommunityActor } from "./actor.server";
import {
  FILE_MAX_BYTES,
  INLINE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  checkDirectVideo,
  classifyUpload,
  imageSize,
  sanitizeFileName,
} from "./upload-kind";

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
  // Videos are for the welcome messages, which the team and community admins run.
  const allowVideo = actor.isModerator === true;
  const cap = inline ? INLINE_MAX_BYTES : allowVideo ? VIDEO_MAX_BYTES : FILE_MAX_BYTES;
  if (file.size > cap) return { ok: false, message: inline ? "Files can be up to 2 MB here." : "Files can be up to 25 MB." };
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > cap) return { ok: false, message: "That file is too large." };
  const head = new Uint8Array(bytes.subarray(0, HEAD_BYTES));
  const verdict = classifyUpload({ name: file.name, declaredMime: file.type, head, size: bytes.length, allowVideo });
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
  kind: "image" | "video" | "file",
): Promise<CommunityUpload | null> {
  if (typeof url !== "string" || url.length === 0) return null;
  if (url.startsWith("data:") && !inlineMode()) return null;
  const row = await db.communityUpload.findFirst({
    where: { urlHash: urlHash(url), uploaderKey: actor.key, kind },
    orderBy: { createdAt: "desc" },
  });
  return row && row.url === url ? row : null;
}

/** findOwnUpload for many photos in ONE query (a saved reply has no photo limit). Keyed by url. */
export async function findOwnImageUploads(db: TenantTx, actor: { key: string }, urls: string[]): Promise<Map<string, CommunityUpload>> {
  const wanted = urls.filter((url) => url.length > 0 && (!url.startsWith("data:") || inlineMode()));
  if (wanted.length === 0) return new Map();
  const rows = await db.communityUpload.findMany({
    where: { urlHash: { in: wanted.map(urlHash) }, uploaderKey: actor.key, kind: "image" },
    orderBy: { createdAt: "desc" },
  });
  const found = new Map<string, CommunityUpload>();
  for (const row of rows) if (wanted.includes(row.url) && !found.has(row.url)) found.set(row.url, row);
  return found;
}

// ── Videos: straight from the phone to ImageKit ─────────────────────────────

const IMAGEKIT_UPLOAD_ENDPOINT = "https://upload.imagekit.io/api/v1/files/upload";
const FILE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * POST /community/uploads/video — store team only. A phone video is far
 * bigger than an API request may be, so the app uploads it to ImageKit itself
 * with this short-lived token, into the folder dictated here, then confirms.
 * No ImageKit (demo / dev) → "inline": send it to POST /community/uploads.
 */
export async function videoUploadTicket(actor: CommunityActor, name: unknown): Promise<VideoUploadTicket> {
  if (inlineMode()) return { mode: "inline" };
  const folder = await tenantMediaFolder(actor.tenantId);
  const auth = getImageKit().getAuthenticationParameters();
  return {
    mode: "direct",
    endpoint: IMAGEKIT_UPLOAD_ENDPOINT,
    publicKey: process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY!,
    token: auth.token,
    signature: auth.signature,
    expire: auth.expire,
    folder,
    fileName: `community-${sanitizeFileName(typeof name === "string" ? name : "", "mp4")}`,
  };
}

async function headBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` }, cache: "no-store" });
  if (!res.ok) return new Uint8Array();
  return new Uint8Array(await res.arrayBuffer()).subarray(0, HEAD_BYTES);
}

function clientDimension(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 20_000 ? v : null;
}

/**
 * POST /community/uploads/video/confirm { fileId } — records a direct upload
 * once ImageKit's own file details and the file's first bytes prove it is a
 * video in THIS tenant's folder. A file of ours that fails is deleted; one
 * outside our folder is never touched (it may be another store's).
 */
export async function confirmVideoUpload(actor: CommunityActor, body: unknown): Promise<UploadOutcome> {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof o.fileId !== "string" || !FILE_ID_RE.test(o.fileId)) return { ok: false, message: "That video didn't upload. Try again." };
  if (inlineMode()) return { ok: false, message: "Send the video through the regular upload here." };
  const fileId = o.fileId;
  const ik = getImageKit();
  const details = await ik.getFileDetails(fileId).catch(() => null);
  if (!details) return { ok: false, message: "That video didn't upload. Try again." };

  const folder = await tenantMediaFolder(actor.tenantId);
  const verdict = checkDirectVideo({ filePath: details.filePath, folder, size: details.size, head: await headBytes(details.url).catch(() => new Uint8Array()) });
  if (!verdict.ok) {
    if (verdict.inFolder) await ik.deleteFile(fileId).catch(() => undefined);
    return { ok: false, message: verdict.error };
  }

  const name = sanitizeFileName(details.name, verdict.ext);
  const width = clientDimension(details.width) ?? clientDimension(o.width);
  const height = clientDimension(details.height) ?? clientDimension(o.height);
  const url = details.url;
  await withTenant(actor.tenantId, async (db) => {
    const existing = await db.communityUpload.findFirst({ where: { urlHash: urlHash(url), uploaderKey: actor.key, kind: "video" }, select: { id: true } });
    if (existing) return;
    await db.communityUpload.create({
      data: {
        tenantId: actor.tenantId,
        uploaderKey: actor.key,
        authorKey: actor.authorKey,
        kind: "video",
        url,
        urlHash: urlHash(url),
        name,
        size: details.size,
        mime: verdict.mime,
        width,
        height,
      },
    });
    await db.mediaAsset.create({ data: { tenantId: actor.tenantId, imagekitId: fileId, url, type: "community" } });
  });

  return { ok: true, upload: { kind: "video", url, name, size: details.size, mime: verdict.mime, width, height } };
}
