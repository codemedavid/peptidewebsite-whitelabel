/**
 * How a store hands a placed order over to its owner.
 *
 * There are two regimes, and this module is the ONE place that decides which
 * one a store is in:
 *
 *   "channels" — the historical flow. The owner has at least one contact channel
 *                enabled with a destination, so the checkout renders a button per
 *                channel and the confirmation screen fires the chat hand-off.
 *
 *   "direct"   — the owner has none. The order is placed ON THE SITE and the
 *                confirmation screen becomes a thank-you: we have your order,
 *                wait for our confirmation, track it by number.
 *
 * Before this existed the drawer simply refused: with no channel there was no
 * place-order button at all, so a customer could fill in their details, pay, and
 * then find "Online checkout isn't set up yet". Nothing on the SERVER required a
 * channel — placeStorefrontOrderAction has always taken `contactMethod` as a
 * free string — so the store was turning away orders it could have stored.
 *
 * Both screens read this predicate rather than counting channels themselves, so
 * the drawer's footer and the confirmation's hand-off section can never end up
 * in different regimes for the same store.
 *
 * Pure (no DB, no React) — npm run test:channelless-checkout.
 */

import type { Brand } from "@/storefront/types";
import { activeChannels } from "@/storefront/checkout";

export type HandoffMode = "channels" | "direct";

/**
 * Which hand-off this store is in. Delegates to `activeChannels` — the same
 * "enabled AND a non-blank destination" rule the channel buttons are built from
 * — so a channel that is enabled but never given a number counts as absent here
 * exactly as it does there.
 */
export function resolveHandoffMode(brand: Brand): HandoffMode {
  return activeChannels(brand).length === 0 ? "direct" : "channels";
}

/** Sugar for the common branch. */
export function isDirectHandoff(brand: Brand): boolean {
  return resolveHandoffMode(brand) === "direct";
}

/** What `customer.contactMethod` records for an order placed with no channel.
 *  A real word rather than "" so the owner's order detail says where the order
 *  came from instead of rendering an em-dash. */
export const DIRECT_CONTACT_METHOD = "Website";
