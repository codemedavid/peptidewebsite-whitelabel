// Pure half of the super-admin → store-admin push (admin-broadcast.ts): the
// operator form's rules and the one-push-per-phone dedupe. No server imports,
// so `npm run test:admin-broadcast` can load it.

type Recipient = { id: string; token: string; platform: string };

export const BROADCAST_LIMITS = { title: 65, body: 240 } as const;

export type BroadcastInput = { title: string; body: string; tenantIds: string[] };

/** Validate the operator's form. Pure. */
export function parseBroadcastInput(raw: unknown): BroadcastInput | { error: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const clean = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "");
  const title = clean(o.title);
  const body = clean(o.body);
  if (!title) return { error: "Add a title." };
  if (!body) return { error: "Add a message." };
  if (title.length > BROADCAST_LIMITS.title) return { error: `Keep the title to ${BROADCAST_LIMITS.title} characters.` };
  if (body.length > BROADCAST_LIMITS.body) return { error: `Keep the message to ${BROADCAST_LIMITS.body} characters.` };
  const tenantIds = Array.isArray(o.tenantIds)
    ? [...new Set(o.tenantIds.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim()))]
    : [];
  return { title, body, tenantIds };
}

/** One phone per push token — an admin of two stores shouldn't get it twice. */
export function dedupeRecipients<T extends Recipient>(list: readonly T[]): T[] {
  const seen = new Set<string>();
  return list.filter((r) => (seen.has(r.token) ? false : (seen.add(r.token), true)));
}

