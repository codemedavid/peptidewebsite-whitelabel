import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Href } from "expo-router";
import { useSession } from "@/auth/SessionProvider";
import { GUEST_BROWSING } from "@/config";
import { useStoreLink } from "@/store-link/StoreLinkProvider";
import type { ShopWho } from "./api";
import { addLine, parseStoredCart, removeLine, serializeCart, setLineQty, type AddResult, type CartLine } from "./lib/cart";

/**
 * Who is shopping, where, and their cart.
 *
 *   customer — signed in with a store customer account (the session's store)
 *   guest    — signed out on a phone linked to a store that runs the customer
 *              app: browse + cart, checkout sends them to sign in
 *   off      — nobody who can shop (an admin, or no linked store)
 *   preview  — the store team viewing their own shop (ShopPreviewProvider):
 *              browse only, no cart
 *
 * The cart is saved per STORE SLUG (not per session), so a guest's cart is
 * still there after they sign in to that same store.
 */

export type ShopMode = "customer" | "guest" | "off" | "preview";

type ShopApi = {
  mode: ShopMode;
  slug: string | null;
  /** React Query scope for shop data (never shared between guest and account). */
  scope: string;
  who: ShopWho;
  lines: CartLine[];
  /** The saved cart has been read (don't show "empty" before it has). */
  hydrated: boolean;
  add: (line: CartLine, max: number) => AddResult;
  setQty: (key: string, qty: number, max: number) => void;
  remove: (key: string) => void;
  replace: (lines: CartLine[]) => void;
  clear: () => void;
  /** Screen paths for this mode (guest screens live under /guest). */
  paths: { home: Href; cart: Href; product: (id: string) => Href; groupBuy: Href };
  /** Guest tapped Checkout: continue to the cart once they're signed in. */
  markResume: () => void;
  takeResume: () => boolean;
};

const ShopContext = createContext<ShopApi | null>(null);
const cartKey = (slug: string) => `pepweb.cart.v1.${slug.toLowerCase()}`;

const GUEST_PATHS = {
  home: "/guest" as Href,
  cart: "/guest/cart" as Href,
  product: (id: string) => ({ pathname: "/guest/product/[id]", params: { id } }) as Href,
  groupBuy: "/guest/group-buy" as Href,
};
const CUSTOMER_PATHS = {
  home: "/shop" as Href,
  cart: "/cart" as Href,
  product: (id: string) => ({ pathname: "/product/[id]", params: { id } }) as Href,
  groupBuy: "/group-buy" as Href,
};

function useShopIdentity(): { mode: ShopMode; slug: string | null; scope: string } {
  const { state } = useSession();
  const { linked } = useStoreLink();
  if (state.status === "signedIn") {
    return state.me.mode === "customer"
      ? { mode: "customer", slug: state.me.store.slug, scope: state.scope }
      : { mode: "off", slug: null, scope: state.scope };
  }
  if (GUEST_BROWSING && linked?.customerSignIn) return { mode: "guest", slug: linked.slug, scope: `guest:${linked.slug}` };
  return { mode: "off", slug: null, scope: "guest:none" };
}

type CartState = { slug: string | null; lines: CartLine[] };
const EMPTY: CartLine[] = [];

export function ShopProvider({ children }: { children: ReactNode }) {
  const { mode, slug, scope } = useShopIdentity();
  // The cart belongs to ONE store: state for another slug reads as not loaded yet.
  const [cart, setCart] = useState<CartState>({ slug: null, lines: EMPTY });
  const cartRef = useRef<CartState>(cart);
  const resume = useRef(false);
  const hydrated = !!slug && cart.slug === slug;
  const lines = hydrated ? cart.lines : EMPTY;

  // Load the saved cart whenever the store changes.
  useEffect(() => {
    if (!slug) return;
    let alive = true;
    void AsyncStorage.getItem(cartKey(slug))
      .catch(() => null)
      .then((raw) => {
        if (!alive) return;
        const next = { slug, lines: parseStoredCart(raw) };
        cartRef.current = next;
        setCart(next);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  /** The current store's lines (never another store's, mid-switch). */
  const current = useCallback(() => (slug && cartRef.current.slug === slug ? cartRef.current.lines : null), [slug]);

  const commit = useCallback(
    (next: CartLine[]) => {
      if (!slug || cartRef.current.slug !== slug || next === cartRef.current.lines) return;
      const state = { slug, lines: next };
      cartRef.current = state;
      setCart(state);
      void AsyncStorage.setItem(cartKey(slug), serializeCart(next)).catch(() => undefined);
    },
    [slug],
  );

  const add = useCallback(
    (line: CartLine, max: number): AddResult => {
      const base = current();
      if (!base) return { lines: EMPTY, added: 0, capped: false };
      const r = addLine(base, line, max);
      commit(r.lines);
      return r;
    },
    [commit, current],
  );
  const setQty = useCallback(
    (key: string, qty: number, max: number) => {
      const base = current();
      if (base) commit(setLineQty(base, key, qty, max));
    },
    [commit, current],
  );
  const remove = useCallback(
    (key: string) => {
      const base = current();
      if (base) commit(removeLine(base, key));
    },
    [commit, current],
  );
  const clear = useCallback(() => commit([]), [commit]);

  const value = useMemo<ShopApi>(
    () => ({
      mode,
      slug,
      scope,
      who: mode === "guest" && slug ? { guest: true, store: slug } : { guest: false },
      lines,
      hydrated,
      add,
      setQty,
      remove,
      replace: commit,
      clear,
      paths: mode === "guest" ? GUEST_PATHS : CUSTOMER_PATHS,
      markResume: () => {
        resume.current = true;
      },
      takeResume: () => {
        const r = resume.current;
        resume.current = false;
        return r;
      },
    }),
    [mode, slug, scope, lines, hydrated, add, setQty, remove, commit, clear],
  );
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

const PREVIEW_PATHS = {
  home: "/storefront" as Href,
  cart: "/storefront" as Href,
  product: (id: string) => ({ pathname: "/storefront-product/[id]", params: { id } }) as Href,
  groupBuy: "/storefront-group-buy" as Href,
};
const NO_ADD: AddResult = { lines: EMPTY, added: 0, capped: false };

/**
 * The shop, as the signed-in store team's native "View your store": the
 * shoppers' catalog and screens, read-only (no cart, no checkout).
 */
export function ShopPreviewProvider({ slug, scope, children }: { slug: string; scope: string; children: ReactNode }) {
  const value = useMemo<ShopApi>(
    () => ({
      mode: "preview",
      slug,
      scope: `${scope}:preview`,
      who: { guest: false, preview: true },
      lines: EMPTY,
      hydrated: true,
      add: () => NO_ADD,
      setQty: () => undefined,
      remove: () => undefined,
      replace: () => undefined,
      clear: () => undefined,
      paths: PREVIEW_PATHS,
      markResume: () => undefined,
      takeResume: () => false,
    }),
    [slug, scope],
  );
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopApi {
  const v = useContext(ShopContext);
  if (!v) throw new Error("useShop must be used inside <ShopProvider>");
  return v;
}
