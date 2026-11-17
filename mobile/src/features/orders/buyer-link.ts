import type { BuyerChannelApp } from "@contract";

/**
 * The app's copy of the website's buyerChannelLink + buildWaLink
 * (src/lib/orders/buyer-contact.ts, src/lib/admin/whatsapp.ts) — Metro can't
 * bundle the website's modules. Used when the owner edits the update message,
 * so the WhatsApp link carries the EDITED text, not the server's draft.
 * `handle` is the server's canonical form: "+639171234567" or "@username".
 */
export function buyerChannelLink(channel: { app: BuyerChannelApp; handle: string }, text = ""): string {
  if (channel.app === "whatsapp") {
    const base = `https://wa.me/${channel.handle.replace(/\D/g, "")}`;
    const message = text.trim();
    return message ? `${base}?text=${encodeURIComponent(message)}` : base;
  }
  return channel.handle.startsWith("@")
    ? `https://t.me/${channel.handle.slice(1)}`
    : `https://t.me/+${channel.handle.replace(/\D/g, "")}`;
}

/** Does opening the link deliver the text, or must it be pasted (Telegram)? */
export function linkCarriesText(app: BuyerChannelApp): boolean {
  return app === "whatsapp";
}
