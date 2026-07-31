// Footer links — the shared rule that a link nobody can follow doesn't render.
//
// Both footer link surfaces used to ship placeholders that pointed at "#":
// a stock "Legal → Privacy / Terms / Disclaimer" column, and three social
// icons (Instagram / Facebook / Twitter) that every store drew whether or not
// the owner had those accounts. This module is the single place that decides
// what actually reaches the page.
//
// Everything here reads untrusted branding.config JSON, so it fails closed:
//   - a social href that isn't http(s) after normalization resolves to "" and
//     therefore renders nothing (which also keeps `javascript:` / `data:` out
//     of an href attribute — the config blob is operator-editable);
//   - a missing / malformed collection resolves to an empty list rather than
//     throwing during a storefront render.
//
// Both editing surfaces — the platform BrandingEditor's "Storefront" tab and
// the store-admin Tweaks panel — share FooterEditor, so the per-platform link
// fields land in both from one implementation.

import type { Brand, FooterColumn, FooterSocial } from "@/storefront/types";
import { isLinkHidden } from "@/storefront/visibility";

/** The generic glyph SocialIcon falls back to for anything unrecognized. */
export const GENERIC_SOCIAL_ICON = "circle";

export type SocialPlatform = {
  /** Matches the glyph names SocialIcon draws; also the FooterSocial.icon value. */
  icon: string;
  label: string;
  /** Shown in the branding editor's empty URL field. */
  placeholder: string;
  hint: string;
};

/**
 * The platforms the branding editor offers a link field for, in display order.
 * Deliberately limited to the glyphs Footer's SocialIcon can actually draw —
 * an entry with no icon would render the generic circle and read as a bug.
 */
export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  {
    icon: "facebook",
    label: "Facebook",
    placeholder: "facebook.com/yourpage",
    hint: "Page or profile URL.",
  },
  {
    icon: "instagram",
    label: "Instagram",
    placeholder: "instagram.com/yourstore",
    hint: "Profile URL.",
  },
  {
    icon: "tiktok",
    label: "TikTok",
    placeholder: "tiktok.com/@yourstore",
    hint: "Profile URL.",
  },
  {
    icon: "viber",
    label: "Viber",
    placeholder: "invite.viber.com/…",
    hint: "Community or invite link. For a chat button use Contact channels.",
  },
  {
    icon: "whatsapp",
    label: "WhatsApp",
    placeholder: "wa.me/639171234567",
    hint: "wa.me link or group invite.",
  },
  {
    icon: "telegram",
    label: "Telegram",
    placeholder: "t.me/yourchannel",
    hint: "Channel or group link.",
  },
  {
    icon: "twitter",
    label: "Twitter / X",
    placeholder: "x.com/yourstore",
    hint: "Profile URL.",
  },
];

/** Is this platform one the editor renders a dedicated row for? */
export function isKnownSocialIcon(icon: unknown): boolean {
  return typeof icon === "string" && SOCIAL_PLATFORMS.some((p) => p.icon === icon);
}

/** Placeholder hrefs the seed data and the old editor left behind. */
const DEAD_HREFS = new Set(["", "#", "#!", "/", "http://", "https://", "https:///"]);

/**
 * A footer href with no destination. In-page routes ("#catalog", "#faq") are
 * real links and stay alive — only the empty placeholders are dead.
 */
export function isDeadHref(href: unknown): boolean {
  if (typeof href !== "string") return true;
  return DEAD_HREFS.has(href.trim().toLowerCase());
}

/**
 * A social link the browser can safely open, or "" when there isn't one.
 * Accepts what an operator actually pastes — a full URL, or a bare domain
 * ("instagram.com/x", "www.facebook.com/x") which is upgraded to https — and
 * rejects everything else, including active schemes (javascript:, data:) and
 * non-web ones (mailto:, viber:); a bare handle has no domain to open.
 */
export function normalizeSocialHref(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (isDeadHref(value)) return "";

  // A scheme-less domain is the common paste. Requiring a dot keeps handles
  // ("@mystore") and stray words out, and keeps "javascript:alert(1)" — which
  // has a scheme — on the strict path below.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  const candidate = hasScheme ? value : /^[^\s/]+\.[^\s/]+/.test(value) ? `https://${value}` : "";
  if (!candidate) return "";

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname) return "";
    return candidate;
  } catch {
    return "";
  }
}

/** Does this social entry have a link, i.e. is it configured at all? */
export function hasSocialLink(social: Pick<FooterSocial, "href">): boolean {
  return normalizeSocialHref(social.href) !== "";
}

/**
 * The social icons the footer renders, in config order. A usable link is the
 * switch: no link, no icon — so a store that never configured a profile shows
 * nothing instead of icons pointing at "#". `show: false` is hide-only; it can
 * suppress a linked social but can never surface a linkless one. Hrefs come
 * back normalized, so the anchor always gets an http(s) URL.
 */
export function buildFooterSocials(brand: Brand): FooterSocial[] {
  if (brand.footerShowSocials === false) return [];
  return (brand.footerSocials || []).flatMap((social) => {
    if (social?.show === false) return [];
    const href = normalizeSocialHref(social?.href);
    if (!href) return [];
    return [
      {
        ...social,
        href,
        icon: isKnownSocialIcon(social.icon) ? social.icon : GENERIC_SOCIAL_ICON,
      },
    ];
  });
}

/** Title of the stock legal column, matched case- and whitespace-insensitively. */
const LEGAL_TITLE = "legal";

function isLegalColumn(col: FooterColumn): boolean {
  return (col.title || "").trim().toLowerCase() === LEGAL_TITLE;
}

/**
 * The link columns the footer renders. In order:
 *
 *  1. The stock "Legal" column (Privacy / Terms / Disclaimer, all "#") is
 *     dropped — it shipped as a default nobody filled in. The rule is narrow
 *     on purpose: it only fires while EVERY link in the column is dead, so an
 *     operator who pastes real policy URLs gets their column back, and no
 *     other column is subject to the sweep.
 *  2. `footerShowLegal: false` keeps its existing meaning — one switch governs
 *     everything legal, so the column goes even with real links.
 *  3. Links to toggled-off pages are stripped (a hidden page must not leak a
 *     footer link), then any column left with nothing is dropped.
 *  4. The gated reseller page is surfaced as its own column when enabled and
 *     not already linked, mirroring the nav.
 */
export function buildFooterColumns(brand: Brand): FooterColumn[] {
  if (brand.footerShowColumns === false) return [];
  const legalHidden = brand.footerShowLegal === false;

  const cols = (brand.footerColumns || [])
    .filter((col) => {
      if (!isLegalColumn(col)) return true;
      if (legalHidden) return false;
      return (col.links || []).some((link) => !isDeadHref(link.href));
    })
    .map((col) => ({
      ...col,
      links: (col.links || []).filter((link) => !isLinkHidden(brand, link.href)),
    }))
    .filter((col) => col.links.length > 0);

  if (
    brand.showPageMerchant === true &&
    !cols.some((col) => col.links.some((link) => link.href === "#merchant"))
  ) {
    return [
      ...cols,
      { title: "Wholesale", links: [{ label: "Reseller pricing", href: "#merchant" }] },
    ];
  }
  return cols;
}
