import type { StorePreview } from "@contract";
import { storeFromInput } from "../../../store-link/parse";

/**
 * The store code step — pure rules, shared by the screen and covered by
 * npm run test:mobile-core.
 *
 * A shopper whose app was installed straight from the App Store has no store
 * linked yet, so before they can create an account they say which seller
 * they shop at: the store code from the seller's /app page, or the link itself.
 */

/** Where the code step hands over once a store is picked. */
export type FindStoreNext = "create-account" | "sign-in";

export type StoreCodeRead = { ok: true; id: string } | { ok: false; message: string };

/** What the shopper typed → the id to look up, or why it can't be one. */
export function readStoreCode(text: string): StoreCodeRead {
  if (!text.trim()) return { ok: false, message: "Type your seller's store code." };
  const id = storeFromInput(text);
  if (!id) {
    return {
      ok: false,
      message: "A store code is letters, numbers and dashes, like vrjonina. Check it with your seller.",
    };
  }
  return { ok: true, id };
}

/** Can a shopper make an account here, or does only the store team get in? */
export function storeDoor(store: Pick<StorePreview, "customerSignIn">): "shopper" | "team-only" {
  return store.customerSignIn ? "shopper" : "team-only";
}

/** The lookup failed → the line the shopper reads. */
export function lookupFailureMessage(code: string | undefined, message: string | undefined): string {
  if (code === "not_found") return "No store uses that code. Check the spelling with your seller.";
  return message?.trim() || "We couldn't check that code. Check your connection and try again.";
}

/** The `next` route param, accepted only when it names a known screen. */
export function findStoreNext(value: unknown): FindStoreNext | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "create-account" || v === "sign-in" ? v : null;
}
