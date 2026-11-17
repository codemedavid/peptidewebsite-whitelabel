import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-client";
import { updateBrandingConfig } from "@/lib/tenant/branding-config-write";
import type { SavedRepliesResponse, SavedReply } from "@/lib/mobile/contract";
import type { CommunityActor } from "./actor.server";
import type { Outcome } from "./messages.server";
import { findOwnImageUploads } from "./uploads.server";
import {
  addSavedReply,
  parseSavedReplyInput,
  removeSavedReply,
  savedReplies,
  updateSavedReply,
  type ListResult,
  type ParsedSavedReply,
  type SavedReplyAuthor,
  type SavedReplyInput,
} from "./saved-replies";

/**
 * The store team's saved replies (branding.config.communitySavedReplies).
 * Read straight from the branding row, never the cached tenant context, so an
 * admin sees a teammate's new reply at once.
 */

function authorOf(actor: CommunityActor): SavedReplyAuthor {
  const info = actor.principal.ctx.actorInfo;
  return { key: actor.authorKey ?? "store", name: info.displayName };
}

export async function listSavedReplies(actor: CommunityActor): Promise<SavedRepliesResponse> {
  const row = await prisma.branding.findUnique({ where: { tenantId: actor.tenantId }, select: { config: true } });
  return { replies: savedReplies(row?.config) };
}

/**
 * Read-modify-write of the list under a row lock: two admins saving at the
 * same moment each see the other's write instead of overwriting it.
 */
async function changeList(actor: CommunityActor, change: (list: SavedReply[]) => ListResult): Promise<Outcome<SavedRepliesResponse>> {
  const out: { result?: ListResult } = {};
  await updateBrandingConfig(actor.tenantId, (current) => {
    const result = change(savedReplies(current));
    out.result = result;
    return result.ok ? { ...current, communitySavedReplies: result.value } : null;
  });
  const result = out.result;
  if (!result) return { kind: "invalid", message: "Couldn't save the reply." };
  if (!result.ok) return result.notFound ? { kind: "not_found" } : { kind: "invalid", message: result.error };
  return { kind: "ok", value: { replies: result.value } };
}

/**
 * Photos must be the store team's own uploads to this tenant (the team shares
 * the `store` key, so any admin can re-send them), and their sizes come from
 * the upload records — never from the request.
 */
async function resolveInput(actor: CommunityActor, body: unknown): Promise<{ ok: true; value: SavedReplyInput } | { ok: false; error: string }> {
  const parsed = parseSavedReplyInput(body);
  if (!parsed.ok) return parsed;
  const { imageUrls, ...rest }: ParsedSavedReply = parsed.value;
  if (imageUrls.length === 0) return { ok: true, value: { ...rest, images: [] } };
  const found = await withTenant(actor.tenantId, (db) => findOwnImageUploads(db, actor, imageUrls));
  const images = imageUrls.map((url) => found.get(url)).filter((u) => u !== undefined);
  if (images.length !== imageUrls.length) return { ok: false, error: "A photo didn't finish uploading. Remove it and add it again." };
  return { ok: true, value: { ...rest, images: images.map((u) => ({ url: u.url, width: u.width, height: u.height })) } };
}

export async function createSavedReply(actor: CommunityActor, body: unknown): Promise<Outcome<SavedRepliesResponse>> {
  const input = await resolveInput(actor, body);
  if (!input.ok) return { kind: "invalid", message: input.error };
  const meta = { id: randomUUID(), by: authorOf(actor), now: new Date() };
  return changeList(actor, (list) => addSavedReply(list, input.value, meta));
}

export async function editSavedReply(actor: CommunityActor, id: string, body: unknown): Promise<Outcome<SavedRepliesResponse>> {
  const input = await resolveInput(actor, body);
  if (!input.ok) return { kind: "invalid", message: input.error };
  const meta = { by: authorOf(actor), now: new Date() };
  return changeList(actor, (list) => updateSavedReply(list, id, input.value, meta));
}

export async function deleteSavedReply(actor: CommunityActor, id: string): Promise<Outcome<SavedRepliesResponse>> {
  return changeList(actor, (list) => removeSavedReply(list, id));
}
