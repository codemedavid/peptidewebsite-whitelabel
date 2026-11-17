/**
 * App promo & event notifications — the rules, pure (no server imports), so
 * they're unit-tested directly (scripts/test-promo-push.ts).
 *
 *   - The store team writes a headline + message; it goes ONLY to app
 *     customers who opted in (StorefrontCustomer.promoPushOptIn). App Store
 *     4.5.4: promotional pushes need the customer's explicit consent and a way
 *     to turn them off — the opt-in is off until they say yes.
 *   - The notification's title is the store's name ("VR Jonina"), the body is
 *     "<headline> — <message>", like every other push the store sends.
 *   - At most PROMO_DAILY_CAP sends per store in any rolling 24 hours, so an
 *     opt-in never turns into spam.
 */

import { FEATURES, type FeatureKey } from "@/lib/features/catalog";

export const PROMO_HEADLINE_MAX = 60;
export const PROMO_MESSAGE_MAX = 180;
export const PROMO_DAILY_CAP = 3;
export const PROMO_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Staff need this module (Promo Codes) to send; the owner always may. */
export const PROMO_STAFF_MODULE = "promo";

export type PromoInput = { headline: string; message: string };

export type PromoParse = { ok: true; value: PromoInput } | { ok: false; message: string };

const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export function parsePromoInput(body: unknown): PromoParse {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const headline = clean(b.headline);
  const message = clean(b.message);
  if (!headline) return { ok: false, message: "Add a headline, like “11.11 Mega Sale”." };
  if (!message) return { ok: false, message: "Add a short message for your customers." };
  if (headline.length > PROMO_HEADLINE_MAX) return { ok: false, message: `Keep the headline under ${PROMO_HEADLINE_MAX} characters.` };
  if (message.length > PROMO_MESSAGE_MAX) return { ok: false, message: `Keep the message under ${PROMO_MESSAGE_MAX} characters.` };
  return { ok: true, value: { headline, message } };
}

/** What the phone shows: the store's name as the title, then the promo. */
export function promoNotification(storeName: string, p: PromoInput): { title: string; body: string } {
  return { title: storeName, body: `${p.headline} — ${p.message}` };
}

/** Sends left in the rolling window, given the send times already logged. */
export function promoSendsLeft(sentAt: readonly Date[], now: Date): number {
  const since = now.getTime() - PROMO_WINDOW_MS;
  const used = sentAt.filter((d) => d.getTime() > since).length;
  return Math.max(0, PROMO_DAILY_CAP - used);
}

/** When the next send frees up (the oldest send in the window ages out), or null if one is free now. */
export function promoNextFreeAt(sentAt: readonly Date[], now: Date): Date | null {
  if (promoSendsLeft(sentAt, now) > 0) return null;
  const since = now.getTime() - PROMO_WINDOW_MS;
  const inWindow = sentAt.filter((d) => d.getTime() > since).map((d) => d.getTime());
  return new Date(Math.min(...inWindow) + PROMO_WINDOW_MS);
}

/** The store offers promo notifications: granted AND its customer app is open. */
export function promoPushEnabled(has: (key: FeatureKey) => boolean): boolean {
  return has(FEATURES.MOBILE_PROMO_PUSH) && (has(FEATURES.MOBILE_SHOP) || has(FEATURES.MOBILE_COMMUNITY));
}
