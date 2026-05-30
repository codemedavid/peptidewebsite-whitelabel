// Shared helpers for the storefront's order-contact channels (WhatsApp /
// Telegram / Messenger). Used by the admin settings editor, its server action,
// and the admin data layer so the channel set is always normalized to the same
// canonical order and shape regardless of what's stored in branding.config.

import type { ContactChannel, ContactChannelType } from "@/storefront/types";

/** Link-preview / SEO descriptions stay short — search + social truncate past this. */
export const META_DESCRIPTION_MAX = 200;

export const CONTACT_CHANNEL_META: {
  type: ContactChannelType;
  label: string;
  placeholder: string;
  hint: string;
}[] = [
  { type: "whatsapp", label: "WhatsApp", placeholder: "e.g. 639171234567", hint: "International number, digits only." },
  { type: "telegram", label: "Telegram", placeholder: "e.g. mystore", hint: "Username, with or without @." },
  { type: "messenger", label: "Messenger", placeholder: "e.g. mystore", hint: "Page username." },
];

/** Coerce whatever is stored in config into the three canonical channels, in a
 *  fixed order, with safe defaults for missing/garbage entries. */
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
