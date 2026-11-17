// Store-owner editing of the order-contact channels (branding.config.contactChannels).
//
// The operator's BrandingEditor writes the same field (saveContactChannelsAction);
// this module is the OWNER path, shared by the website's Contact Methods view and
// the Pepweb app (both run saveStoreContactMethodsAction). It is stricter than the
// operator path: every enabled destination must look like what its app expects,
// so a typo can't silently break the checkout hand-off or the app's
// "Forgot password?" screen. Pure and client-safe (no DB, no server-only).

import type { ContactChannel, ContactChannelType } from "@/storefront/types";
import { CONTACT_CHANNEL_META, normalizeContactChannels } from "./contact-channels";

/** Longest destination accepted — far above any handle, number or email. */
export const CONTACT_DESTINATION_MAX = 120;

const LABEL: Record<ContactChannelType, string> = Object.fromEntries(
  CONTACT_CHANNEL_META.map((m) => [m.type, m.label]),
) as Record<ContactChannelType, string>;

export function contactChannelLabel(type: ContactChannelType): string {
  return LABEL[type];
}

const PHONE_RE = /^\+?[\d\s().-]+$/;
const HANDLE_RE = /^[a-z0-9._]{1,64}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;

/** Strip a pasted profile URL / leading "@" down to the bare handle. */
function bareHandle(raw: string, hosts: RegExp): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(hosts, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
}

function phoneDigits(raw: string): string | null {
  if (!PHONE_RE.test(raw.trim())) return null;
  const digits = raw.replace(/[^\d]/g, "");
  return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS ? digits : null;
}

/**
 * Canonical destination for one channel, or an error the owner can act on.
 * Phones become bare international digits; handles lose "@" and URL wrapping.
 */
export function cleanContactDestination(
  type: ContactChannelType,
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  const label = LABEL[type];
  if (!value) return { ok: false, error: `Add your ${label} details, or turn ${label} off.` };
  if (value.length > CONTACT_DESTINATION_MAX) return { ok: false, error: `${label} is too long.` };

  switch (type) {
    case "whatsapp":
    case "viber": {
      const digits = phoneDigits(value);
      return digits
        ? { ok: true, value: digits }
        : { ok: false, error: `${label} needs a full phone number with country code, e.g. 639171234567.` };
    }
    case "telegram": {
      const handle = bareHandle(value, /^(?:www\.)?t\.me\//i);
      if (PHONE_RE.test(handle)) {
        const digits = phoneDigits(handle);
        return digits ? { ok: true, value: `+${digits}` } : { ok: false, error: "Telegram needs a username or a full phone number." };
      }
      return HANDLE_RE.test(handle) ? { ok: true, value: handle } : { ok: false, error: "Telegram needs a username like mystore." };
    }
    case "messenger": {
      const handle = bareHandle(value, /^(?:www\.|m\.)?(?:facebook\.com|fb\.com|m\.me)\//i);
      return HANDLE_RE.test(handle) ? { ok: true, value: handle } : { ok: false, error: "Messenger needs your Page username, like mystore." };
    }
    case "instagram": {
      const handle = bareHandle(value, /^(?:www\.)?(?:instagram\.com|ig\.me\/m)\//i);
      return HANDLE_RE.test(handle) ? { ok: true, value: handle } : { ok: false, error: "Instagram needs a username like mystore." };
    }
    case "gmail":
      return EMAIL_RE.test(value) ? { ok: true, value: value.toLowerCase() } : { ok: false, error: "Email needs a valid address, like store@gmail.com." };
  }
}

/**
 * Validate the owner's edit into the full canonical channel set. Disabled
 * channels keep whatever was typed (so turning one back on is one tap), but an
 * enabled channel must have a valid destination.
 */
export function parseOwnerContactChannels(
  raw: unknown,
): { ok: true; channels: ContactChannel[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Invalid contact methods." };
  const channels: ContactChannel[] = [];
  for (const c of normalizeContactChannels(raw)) {
    const destination = c.destination.slice(0, CONTACT_DESTINATION_MAX);
    if (!c.enabled) {
      channels.push({ ...c, destination });
      continue;
    }
    const cleaned = cleanContactDestination(c.type, destination);
    if (!cleaned.ok) return { ok: false, error: cleaned.error };
    channels.push({ ...c, destination: cleaned.value });
  }
  return { ok: true, channels };
}

/** A channel a stranger can use: enabled, with somewhere to send to. */
export type PublicContactChannel = { type: ContactChannelType; label: string; destination: string };

/** The store's live contact channels, in canonical order — what checkout and the app show. */
export function publicContactChannels(raw: unknown): PublicContactChannel[] {
  return normalizeContactChannels(raw)
    .filter((c) => c.enabled && c.destination)
    .map((c) => ({ type: c.type, label: LABEL[c.type], destination: c.destination }));
}
