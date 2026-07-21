// Shared helpers for the storefront's order-contact channels. Used by the admin
// settings editor, its server action, and the admin data layer so the channel
// set is always normalized to the same canonical order and shape regardless of
// what's stored in branding.config.

import type { ContactChannel, ContactChannelType } from "@/storefront/types";

/** Build Instagram's click-to-DM link (`https://ig.me/m/<handle>`, Meta's
 *  official format — the IG analog of Messenger's m.me) from whatever the
 *  operator typed. Tolerates the common shapes: a bare username, a leading "@",
 *  or a pasted profile URL (`instagram.com/x`, `https://www.instagram.com/x/`).
 *  Instagram can't carry a prefilled DM, so callers still copy the order text.
 *  Shared by the storefront checkout hand-off (channelUrl) and the email
 *  support link (analytics/events) so the two never drift. */
export function instagramDmUrl(dest: string): string {
  const handle = dest
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(?:www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, ""); // drop any trailing path / query / hash
  return `https://ig.me/m/${handle}`;
}

/** Link-preview / SEO descriptions stay short — search + social truncate past this. */
export const META_DESCRIPTION_MAX = 200;

export const CONTACT_CHANNEL_META: {
  type: ContactChannelType;
  label: string;
  placeholder: string;
  hint: string;
}[] = [
  { type: "whatsapp", label: "WhatsApp", placeholder: "e.g. 639171234567", hint: "International number, digits only." },
  { type: "telegram", label: "Telegram", placeholder: "e.g. mystore or 639171234567", hint: "Username (with or without @) or an international phone number." },
  { type: "messenger", label: "Messenger", placeholder: "e.g. mystore", hint: "Page username." },
  { type: "viber", label: "Viber", placeholder: "e.g. 639171234567", hint: "International number, digits only." },
  { type: "gmail", label: "Gmail", placeholder: "e.g. store@gmail.com", hint: "Email address orders are sent to." },
  { type: "instagram", label: "Instagram", placeholder: "e.g. mystore", hint: "Username (with or without @) — opens a DM." },
];

/** Coerce whatever is stored in config into the full canonical channel set
 *  (CONTACT_CHANNEL_META), in a fixed order, with safe defaults for
 *  missing/garbage entries. */
export function normalizeContactChannels(raw: unknown): ContactChannel[] {
  const arr: unknown[] = Array.isArray(raw) ? raw : [];
  return CONTACT_CHANNEL_META.map(({ type }) => {
    const found = arr.find(
      (c): c is Partial<ContactChannel> =>
        !!c && typeof c === "object" && (c as { type?: unknown }).type === type,
    );
    return {
      type,
      destination: typeof found?.destination === "string" ? found.destination.trim() : "",
      enabled: !!found?.enabled,
    };
  });
}
