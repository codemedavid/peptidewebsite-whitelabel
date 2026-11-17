import type { StoreContactChannelType } from "@contract";

/**
 * The store's order-contact channels on the phone: labels, looks and deep links.
 * Mirrors the website (src/lib/storefront/contact-channels.ts + checkout.ts
 * channelUrl). The server is the authority on what's valid
 * (src/lib/storefront/contact-methods.ts); the app only shapes links and hints.
 */

export type ContactChannelMeta = {
  type: StoreContactChannelType;
  label: string;
  /** Ionicons name. */
  icon: "logo-whatsapp" | "paper-plane" | "chatbubble-ellipses" | "call" | "mail" | "logo-instagram";
  /** The app's own colour, so people recognise it at a glance. */
  color: string;
  placeholder: string;
  hint: string;
  keyboard: "phone-pad" | "email-address" | "default";
};

export const CONTACT_CHANNELS: readonly ContactChannelMeta[] = [
  { type: "whatsapp", label: "WhatsApp", icon: "logo-whatsapp", color: "#128C4A", placeholder: "639171234567", hint: "Full number with country code.", keyboard: "phone-pad" },
  { type: "messenger", label: "Messenger", icon: "chatbubble-ellipses", color: "#0866FF", placeholder: "mystore", hint: "Your Facebook Page username.", keyboard: "default" },
  { type: "telegram", label: "Telegram", icon: "paper-plane", color: "#1B7FB8", placeholder: "mystore or 639171234567", hint: "Username or full phone number.", keyboard: "default" },
  { type: "viber", label: "Viber", icon: "call", color: "#7360F2", placeholder: "639171234567", hint: "Full number with country code.", keyboard: "phone-pad" },
  { type: "instagram", label: "Instagram", icon: "logo-instagram", color: "#C13584", placeholder: "mystore", hint: "Your Instagram username.", keyboard: "default" },
  { type: "gmail", label: "Email", icon: "mail", color: "#C5221F", placeholder: "store@gmail.com", hint: "The address you check for orders.", keyboard: "email-address" },
];

export const channelMeta = (type: StoreContactChannelType): ContactChannelMeta =>
  CONTACT_CHANNELS.find((c) => c.type === type) ?? CONTACT_CHANNELS[0];

/** Only WhatsApp and email carry the message in the link; the others get it via the clipboard. */
export const channelPrefills = (type: StoreContactChannelType): boolean => type === "whatsapp" || type === "gmail";

const digits = (s: string) => s.replace(/[^\d]/g, "");
const handle = (s: string) => s.trim().replace(/^@/, "");

/** The link that opens a chat with the store on this channel. */
export function channelLink(type: StoreContactChannelType, destination: string, message: string, subject = "Message from the app"): string {
  const dest = destination.trim();
  switch (type) {
    case "whatsapp":
      return `https://wa.me/${digits(dest)}?text=${encodeURIComponent(message)}`;
    case "telegram": {
      const h = handle(dest);
      return /^\+?[\d\s().-]+$/.test(h) ? `https://t.me/+${digits(h)}` : `https://t.me/${h}`;
    }
    case "messenger":
      return `https://m.me/${handle(dest)}`;
    case "instagram":
      return `https://ig.me/m/${handle(dest)}`;
    case "viber":
      return `viber://chat?number=${digits(dest)}`;
    case "gmail":
      return `mailto:${dest}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  }
}

/** Quick client check (the server re-checks): an enabled channel needs something plausible. */
export function channelHint(type: StoreContactChannelType, value: string): string | null {
  const v = value.trim();
  if (!v) return "Add it, or turn this off.";
  if ((type === "whatsapp" || type === "viber") && (digits(v).length < 7 || digits(v).length > 15)) return "Use the full number with country code, e.g. 639171234567.";
  if (type === "gmail" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "That email doesn't look right.";
  return null;
}
