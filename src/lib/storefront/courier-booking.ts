// The courier booking link — an external delivery form the customer fills in
// before placing the order (a Lalamove booking form, a Maxim link, a rider's
// Google Form). This is NOT an API integration: the store owner pastes a URL,
// the checkout shows it while that courier is selected, and the customer opens
// it in a new tab. Nothing is booked, quoted or tracked programmatically.
//
// The URL lives on the COURIER itself (Courier.bookingUrl, beside the existing
// trackingUrl) rather than in a settings blob of its own. That gets three
// things for free: it is per-tenant by construction (the couriers array lives
// inside that tenant's branding.config row, so two stores can share a courier
// id and never see each other's link), it is edited where an owner already goes
// to manage couriers, and it keys off the SELECTED COURIER rather than a
// courier NAME — so it serves Lalamove, Maxim or a same-day rider equally, and
// survives a rename.

import type { Courier } from "@/storefront/types";

/** What the checkout card needs: whose form it is, and where it lives. */
export type CourierBooking = { name: string; url: string };

/** Schemes safe to put in an href a customer will click. */
const WEB_SCHEMES = ["http://", "https://"];

/**
 * An external URL that is safe to render as a link, or "" when it isn't.
 *
 * `trackingUrl`, the field this one sits beside, has only ever been rendered as
 * TEXT — so it was never scheme-checked. `bookingUrl` becomes an `<a href>` on
 * the storefront, which turns a `javascript:` URL saved by anyone with courier
 * permission into stored XSS against every customer who reaches checkout.
 * Validated on save AND at render: either alone would leave a hole (rows
 * written before the check, or a config edited by another path).
 *
 * A bare "example.com/form" is rejected rather than silently prefixed —
 * guessing a scheme for a value that will be clicked is how "//evil.example.com"
 * becomes a protocol-relative redirect off the store.
 */
export function safeExternalUrl(input: unknown): string {
  if (typeof input !== "string") return "";
  const url = input.trim();
  if (!url) return "";
  const lower = url.toLowerCase();
  return WEB_SCHEMES.some((scheme) => lower.startsWith(scheme)) ? url : "";
}

/** The tenant's configured couriers, defensively. */
function courierList(input: unknown): Courier[] {
  return Array.isArray(input)
    ? (input.filter((c) => c && typeof c === "object") as Courier[])
    : [];
}

/**
 * The booking card to show for the courier the customer picked, or null when
 * there is nothing to show — no courier selected, that courier has no link, the
 * saved link isn't a safe web URL, or the tenant isn't entitled.
 *
 * Null is the graceful path, not an error: a store that never configures a link
 * simply never sees the card, and checkout is unaffected.
 */
export function resolveCourierBooking(
  couriers: unknown,
  courierId: string,
  entitled: boolean,
): CourierBooking | null {
  if (!entitled || !courierId) return null;
  const courier = courierList(couriers).find((c) => String(c?.id ?? "") === courierId);
  if (!courier) return null;
  const url = safeExternalUrl(courier.bookingUrl);
  if (!url) return null;
  return { name: String(courier.name ?? "").trim(), url };
}
