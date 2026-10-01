import "server-only";

import { withTenant } from "@/lib/db/tenant-client";
import { isDemoMode } from "@/lib/demo/fixtures";
import { uploadTenantMedia } from "@/lib/imagekit/server";
import { imageUrl } from "@/lib/media/image-url";
import { imageKitConfigured } from "@/lib/community/uploads.server";
import { classifyUpload, INLINE_MAX_BYTES, IMAGE_MAX_BYTES, sanitizeFileName } from "@/lib/community/upload-kind";
import type { Principal } from "./auth";
import type { AccountProfileView } from "./contract";
import { parseAccountProfileUpdate, profileSubject, viewProfile, type ProfileSubjectRef } from "./account-profile";

/**
 * Load and save the signed-in account's own profile (name, nickname, photo).
 * The subject is always derived from the server-side session, never the app,
 * so an account can only ever edit itself.
 *
 * Customers: the name and bio are mirrored onto their CommunityMember row so
 * chats keep reading one place (participants.server.ts adds nickname + photo).
 */

const HEAD_BYTES = 512;
const AVATAR_PX = 512;

function subjectRef(principal: Principal): ProfileSubjectRef {
  if (principal.kind === "customer") return { kind: "customer", id: principal.ctx.customer.id };
  const actor = principal.ctx.actor;
  return actor.kind === "staff" ? { kind: "staff", id: actor.id } : { kind: "owner" };
}

/** The account's own name when it has never set one. */
function fallbackName(principal: Principal): string {
  return principal.ctx.actorInfo.displayName;
}

export async function loadAccountProfile(principal: Principal): Promise<AccountProfileView> {
  const { tenantId } = principal.ctx;
  const subject = profileSubject(subjectRef(principal));
  const row = await withTenant(tenantId, (db) =>
    db.accountProfile.findFirst({ where: { subject }, select: { name: true, nickname: true, avatarUrl: true } }),
  );
  return viewProfile(row, fallbackName(principal));
}

/**
 * For /me: a profile read must never take the whole app down (e.g. the
 * account_profiles table not pushed yet) — fall back to the account's own name.
 */
export async function loadAccountProfileSafe(principal: Principal): Promise<AccountProfileView> {
  try {
    return await loadAccountProfile(principal);
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    console.error(`[account-profile] load failed: ${e instanceof Error ? e.name : "Error"}${code ? ` (${code})` : ""}`);
    return viewProfile(null, fallbackName(principal));
  }
}

export type SaveOutcome = { ok: true; profile: AccountProfileView } | { ok: false; message: string };

export async function saveAccountProfile(principal: Principal, body: unknown): Promise<SaveOutcome> {
  const parsed = parseAccountProfileUpdate(body);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  const { name, nickname, bio } = parsed.value;
  const { tenantId } = principal.ctx;
  const subject = profileSubject(subjectRef(principal));

  await withTenant(tenantId, async (db) => {
    await db.accountProfile.upsert({
      where: { tenantId_subject: { tenantId, subject } },
      update: { name, nickname },
      create: { tenantId, subject, name, nickname },
    });
    if (principal.kind === "customer") {
      await db.communityMember.updateMany({
        where: { customerId: principal.ctx.customer.id },
        data: bio === undefined ? { displayName: name } : { displayName: name, bio },
      });
    }
  });
  return { ok: true, profile: await loadAccountProfile(principal) };
}

/** Upload a new profile photo (images only, sniffed from the bytes) and set it. */
export async function setAccountPhoto(principal: Principal, file: unknown): Promise<SaveOutcome> {
  if (!(file instanceof File)) return { ok: false, message: "Choose a photo." };
  const inline = isDemoMode() || !imageKitConfigured();
  const cap = inline ? INLINE_MAX_BYTES : IMAGE_MAX_BYTES;
  if (file.size > cap) return { ok: false, message: inline ? "Photos can be up to 2 MB here." : "Photos can be up to 10 MB." };
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > cap) return { ok: false, message: "That photo is too large." };
  const verdict = classifyUpload({
    name: file.name,
    declaredMime: file.type,
    head: new Uint8Array(bytes.subarray(0, HEAD_BYTES)),
    size: bytes.length,
  });
  if (!verdict.ok) return { ok: false, message: verdict.error };
  if (verdict.kind !== "image") return { ok: false, message: "Profile photos must be a JPG, PNG, WEBP or GIF." };

  const { tenantId } = principal.ctx;
  let avatarUrl: string;
  if (inline) {
    avatarUrl = `data:${verdict.mime};base64,${bytes.toString("base64")}`;
  } else {
    const uploaded = await uploadTenantMedia({
      tenantId,
      file: bytes,
      fileName: `avatar-${sanitizeFileName(file.name, verdict.ext)}`,
      tags: ["avatar"],
    });
    avatarUrl = imageUrl(uploaded.url, { width: AVATAR_PX, height: AVATAR_PX });
  }
  await writeAvatar(principal, avatarUrl);
  return { ok: true, profile: await loadAccountProfile(principal) };
}

export async function removeAccountPhoto(principal: Principal): Promise<AccountProfileView> {
  await writeAvatar(principal, null);
  return loadAccountProfile(principal);
}

async function writeAvatar(principal: Principal, avatarUrl: string | null): Promise<void> {
  const { tenantId } = principal.ctx;
  const subject = profileSubject(subjectRef(principal));
  await withTenant(tenantId, (db) =>
    db.accountProfile.upsert({
      where: { tenantId_subject: { tenantId, subject } },
      update: { avatarUrl },
      create: { tenantId, subject, name: fallbackName(principal), avatarUrl },
    }),
  );
}
