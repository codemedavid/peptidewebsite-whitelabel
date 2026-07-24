// Footer style — the "columns" (default) vs "compact" storefront footer.
//
// HP Glow asked for a dark, compact footer (reference screenshot): logo + name
// + tagline on the left, a row of pill quick-links on the right (Lab Reports ·
// FAQ · Viber), and a centered "Made with ♥ …" line. Rather than invent new
// content fields, the compact footer is derived from EXISTING brand config —
// the COA page, the FAQ page, and the active contact channels — so any tenant
// can opt in by setting footerStyle: "compact".
//
// The stored value lives on branding.config (untrusted JSON), so
// normalizeFooterStyle fails closed to "columns": an unknown value keeps the
// current, pre-feature footer for every existing tenant.

import type { Brand, ContactChannelType } from "@/storefront/types";
import { activeChannels, channelUrl, CHANNEL_LABELS } from "@/storefront/checkout";
import { isLinkHidden } from "@/storefront/visibility";

export type FooterStyle = "columns" | "compact";

export function normalizeFooterStyle(value: unknown): FooterStyle {
  return value === "compact" ? "compact" : "columns";
}

export type FooterQuickIcon = "shield" | "chat" | "phone";

export type FooterQuickLink = {
  /** Stable key for React lists and tests. */
  key: string;
  label: string;
  href: string;
  icon: FooterQuickIcon;
  /** "outline" = tinted-border pill; "accent" = filled contact button. */
  variant: "outline" | "accent";
  /** External links (contact deep-links) open in a new tab. */
  external: boolean;
};

/** Contact channels reachable "by phone" get the phone glyph; the rest chat. */
function channelIcon(type: ContactChannelType): FooterQuickIcon {
  return type === "viber" || type === "whatsapp" ? "phone" : "chat";
}

/**
 * The pill quick-links rendered in the compact footer, in display order:
 * the page shortcuts first (Lab Reports, FAQ), then one filled accent button
 * per active contact channel (Viber, WhatsApp, …). Everything respects the
 * same page-visibility toggles the nav uses, so a hidden page never leaks a
 * footer link.
 */
export function buildFooterQuickLinks(brand: Brand): FooterQuickLink[] {
  const links: FooterQuickLink[] = [];

  if (brand.showPageCOA !== false && !isLinkHidden(brand, "#coa")) {
    links.push({
      key: "coa",
      label: "Lab Reports",
      href: "#coa",
      icon: "shield",
      variant: "outline",
      external: false,
    });
  }

  if (brand.showPageFAQ !== false && !isLinkHidden(brand, "#faq")) {
    links.push({
      key: "faq",
      label: "FAQ",
      href: "#faq",
      icon: "chat",
      variant: "outline",
      external: false,
    });
  }

  for (const channel of activeChannels(brand)) {
    links.push({
      key: `contact-${channel.type}`,
      label: `${CHANNEL_LABELS[channel.type]}: ${channel.destination.trim()}`,
      href: channelUrl(channel, ""),
      icon: channelIcon(channel.type),
      variant: "accent",
      external: true,
    });
  }

  return links;
}
