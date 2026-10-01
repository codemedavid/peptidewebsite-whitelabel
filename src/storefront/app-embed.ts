/**
 * The Pepweb app opens this storefront's `#admin` inside a WebView
 * (mobile/src/app/(app)/web-admin.tsx) and, before any page script runs,
 * injects `window.__PEPWEB_APP__`:
 *
 *   handoff  — a 60s token redeemAppHandoffAction trades for the admin cookie
 *              (consumed once, then deleted)
 *   view     — the admin view to open first (validated by AdminPage)
 *   embedded — the app draws its own chrome, so the admin hides Log out and
 *              "View website"
 *
 * Nothing here is trusted: the token is verified server-side, the view goes
 * through the same visibility/permission guard as a click.
 */

export type PepwebAppEmbed = {
  handoff?: unknown;
  view?: unknown;
  embedded?: unknown;
};

declare global {
  interface Window {
    __PEPWEB_APP__?: PepwebAppEmbed;
  }
}

function embed(): PepwebAppEmbed | null {
  if (typeof window === "undefined") return null;
  const v = window.__PEPWEB_APP__;
  return v && typeof v === "object" ? v : null;
}

/** The pending handoff token, removed on read so it is redeemed at most once. */
export function takeAppHandoff(): string | null {
  const e = embed();
  if (!e || typeof e.handoff !== "string" || !e.handoff) return null;
  const token = e.handoff;
  delete e.handoff;
  return token;
}

/** The admin view the app asked for, as an unvalidated string. */
export function appInitialView(): string | null {
  const v = embed()?.view;
  return typeof v === "string" && v ? v : null;
}

export function isAppEmbedded(): boolean {
  return embed()?.embedded === true;
}
