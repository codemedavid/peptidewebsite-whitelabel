import type { AccountProfileView } from "./contract";

/**
 * Personal profiles for every app account — the store owner, each staff member
 * and each customer — keyed per tenant by a subject string that mirrors the
 * session subject. Pure (no DB): account-profile.server.ts does the I/O.
 *
 * What people see is the nickname when one is set, else the name, else the
 * account's existing name (staff full name, customer name, "Store owner").
 */

export const NAME_MIN = 2;
export const NAME_MAX = 40;
export const NICKNAME_MAX = 24;
export const BIO_MAX = 160;

export type ProfileSubjectRef = { kind: "owner" } | { kind: "staff"; id: string } | { kind: "customer"; id: string };

export function profileSubject(ref: ProfileSubjectRef): string {
  return ref.kind === "owner" ? "owner" : `${ref.kind}:${ref.id}`;
}

export type AccountProfileUpdate = { name: string; nickname: string | null; bio?: string };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function clean(v: string): string {
  return v.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
}

export function parseAccountProfileUpdate(input: unknown): Parsed<AccountProfileUpdate> {
  if (!input || typeof input !== "object") return { ok: false, error: "Nothing to save." };
  const o = input as Record<string, unknown>;
  if (typeof o.name !== "string") return { ok: false, error: "Enter your name." };
  if (o.nickname != null && typeof o.nickname !== "string") return { ok: false, error: "Nicknames are text." };
  if (o.bio != null && typeof o.bio !== "string") return { ok: false, error: "Your bio is text." };

  const name = clean(o.name);
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return { ok: false, error: `Names are ${NAME_MIN}–${NAME_MAX} characters.` };
  }
  const nickname = typeof o.nickname === "string" ? clean(o.nickname) : "";
  if (nickname.length > NICKNAME_MAX) return { ok: false, error: `Nicknames are up to ${NICKNAME_MAX} characters.` };

  const value: AccountProfileUpdate = { name, nickname: nickname || null };
  if (typeof o.bio === "string") {
    const bio = o.bio.trim();
    if (bio.length > BIO_MAX) return { ok: false, error: `Keep your bio under ${BIO_MAX} characters.` };
    value.bio = bio;
  }
  return { ok: true, value };
}

export type StoredProfile = { name: string; nickname: string | null; avatarUrl?: string | null };

/** The name other people see: nickname → name → the account's own name. */
export function shownName(profile: Pick<StoredProfile, "name" | "nickname"> | null, fallback: string): string {
  return profile?.nickname?.trim() || profile?.name?.trim() || fallback;
}

export function viewProfile(profile: StoredProfile | null, fallbackName: string): AccountProfileView {
  return {
    name: profile?.name?.trim() || fallbackName,
    nickname: profile?.nickname?.trim() || null,
    avatarUrl: profile?.avatarUrl ?? null,
    displayName: shownName(profile, fallbackName),
  };
}
