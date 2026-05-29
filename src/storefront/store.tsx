"use client";

// Single source of truth for the storefront + admin. Mirrors the design
// prototype's mutable window.PRODUCTS/CATEGORIES/… globals, but as reactive
// React state so admin edits flow through to the public pages live.
//
// Editable collections are persisted to localStorage (per the prototype, which
// "persists to disk"). The brand config is treated as static tenant defaults.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BRAND,
  SEED_CATEGORIES,
  SEED_COA_REPORTS,
  SEED_FAQ_GROUPS,
  SEED_ORDERS,
  SEED_PAYMENT_METHODS,
  SEED_PRODUCTS,
  SEED_PROMO_CODES,
  SEED_PROTOCOLS,
  SEED_REVIEWS,
  SEED_SHIPPING_LOCATIONS,
} from "./data";
import { savePaymentMethodsAction } from "@/actions/storefront-admin";
import type {
  Brand,
  Category,
  CoaReport,
  FaqGroup,
  Order,
  PaymentMethod,
  Product,
  PromoCode,
  Protocol,
  Review,
  ShippingLocation,
} from "./types";

type Updater<T> = T | ((prev: T) => T);

export type Store = {
  brand: Brand;
  /** Live branding editor write path — setTweak('key', value) or setTweak({ … }). */
  setTweak: (keyOrEdits: keyof Brand | Partial<Brand>, val?: unknown) => void;

  products: Product[];
  setProducts: (next: Updater<Product[]>) => void;
  categories: Category[];
  setCategories: (next: Updater<Category[]>) => void;
  orders: Order[];
  setOrders: (next: Updater<Order[]>) => void;
  /** Orders the CUSTOMER placed in THIS browser — drives the public Track page's
   *  "your recent orders" one-tap list. Distinct from `orders` (the admin's full
   *  list, seeded with sample data), so a visitor only ever sees their own. */
  myOrders: Order[];
  setMyOrders: (next: Updater<Order[]>) => void;
  shippingLocations: ShippingLocation[];
  setShippingLocations: (next: Updater<ShippingLocation[]>) => void;
  coaReports: CoaReport[];
  setCoaReports: (next: Updater<CoaReport[]>) => void;
  promoCodes: PromoCode[];
  setPromoCodes: (next: Updater<PromoCode[]>) => void;
  paymentMethods: PaymentMethod[];
  setPaymentMethods: (next: Updater<PaymentMethod[]>) => void;
  faqGroups: FaqGroup[];
  setFaqGroups: (next: Updater<FaqGroup[]>) => void;
  protocols: Protocol[];
  setProtocols: (next: Updater<Protocol[]>) => void;
  reviews: Review[];
  setReviews: (next: Updater<Review[]>) => void;

  cart: Product[];
  addToCart: (product: Product) => void;
  /** Remove one unit of the product from the cart. */
  decrementCart: (productId: string) => void;
  /** Remove every unit of the product (delete the line). */
  removeLine: (productId: string) => void;
  /** Empty the cart (after a successful checkout hand-off). */
  clearCart: () => void;

  toast: (msg: string) => void;
  toastMsg: string;
};

const StoreContext = createContext<Store | null>(null);

/** Read a JSON collection from localStorage, falling back to the seed. */
function load<T>(key: string, seed: T): T {
  if (typeof window === "undefined") return seed;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : seed;
  } catch {
    return seed;
  }
}

// Base prefix for this storefront's localStorage keys. The real namespace is
// tenant-qualified per StoreProvider instance (see `NS` below) so two tenants
// served from the SAME browser origin (shared staging/preview hosts, a
// re-pointed custom domain, apex serving a default tenant) can never read or
// overwrite each other's cached collections — especially the optimistic orders
// mirror, which carries customer PII.
const NS_BASE = "sf_v1__";

/** Apply the brand palette to --brand-* custom properties (per applyBrandStyle). */
function applyBrandStyle(b: Brand) {
  if (typeof document === "undefined") return;
  const r = document.documentElement.style;
  r.setProperty("--brand-main", b.main);
  r.setProperty("--brand-accent", b.accent);
  r.setProperty("--brand-button", b.button);
  r.setProperty("--brand-button-2", b.button2);
  r.setProperty("--brand-button-text", b.buttonText);
  r.setProperty("--brand-background", b.background);
  r.setProperty("--brand-surface", b.surface);
  r.setProperty("--brand-text", b.text);
  r.setProperty("--brand-heading-font", `"${b.headingFont}", Georgia, serif`);
  r.setProperty("--brand-body-font", `"${b.bodyFont}", system-ui, sans-serif`);
}

export function StoreProvider({
  children,
  brand: brandSeed = BRAND,
  products: productsSeed,
  tenantKey,
}: {
  children: ReactNode;
  brand?: Brand;
  /** Products loaded server-side from the DB (source of truth). Falls back to
   *  the design seeds only when none were provided. */
  products?: Product[];
  /** Stable per-tenant id/slug used to namespace this storefront's localStorage
   *  keys. Omitted only by the admin live-preview (single-tenant, isolation
   *  irrelevant), which falls back to the shared base prefix. */
  tenantKey?: string;
}) {
  // Tenant-qualified localStorage namespace (stable for the life of this mount).
  const NS = tenantKey ? `${NS_BASE}${tenantKey}__` : NS_BASE;
  const [brand, setBrandState] = useState<Brand>(brandSeed);
  const [products, setProductsState] = useState<Product[]>(productsSeed ?? SEED_PRODUCTS);
  const [categories, setCategoriesState] = useState<Category[]>(SEED_CATEGORIES);
  const [orders, setOrdersState] = useState<Order[]>(SEED_ORDERS);
  // Customer's own placed orders — NOT seeded (a visitor must only see orders
  // they actually placed in this browser, never the sample/admin data).
  const [myOrders, setMyOrdersState] = useState<Order[]>([]);
  const [shippingLocations, setShippingState] = useState<ShippingLocation[]>(SEED_SHIPPING_LOCATIONS);
  const [coaReports, setCoaState] = useState<CoaReport[]>(SEED_COA_REPORTS);
  const [promoCodes, setPromoState] = useState<PromoCode[]>(SEED_PROMO_CODES);
  // Payment methods load from the DB server-side (page.tsx spreads
  // branding.config into the brand prop), so they're identical on every device.
  // Seed defaults apply only until the owner saves the first time.
  const [paymentMethods, setPaymentsState] = useState<PaymentMethod[]>(
    brandSeed.paymentMethods ?? SEED_PAYMENT_METHODS,
  );
  const [faqGroups, setFaqState] = useState<FaqGroup[]>(SEED_FAQ_GROUPS);
  const [protocols, setProtocolsState] = useState<Protocol[]>(SEED_PROTOCOLS);
  const [reviews, setReviewsState] = useState<Review[]>(SEED_REVIEWS);
  const [cart, setCart] = useState<Product[]>([]);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from localStorage after mount (avoids SSR/client mismatch).
  useEffect(() => {
    // NOTE: brand is intentionally NOT hydrated from localStorage — it comes
    // from the DB via the server-provided `brand` prop (branding.config). A
    // stale local copy would otherwise mask what the operator saved in the
    // platform admin (e.g. a "Show legal row" toggle turned off would reappear
    // because an old cached brand still had footerShowLegal: true). Same class
    // of cross-device bug as products / payment methods below.
    // NOTE: products are intentionally NOT hydrated from localStorage — they're
    // the DB's source of truth, loaded server-side and passed in as `productsSeed`
    // (mirroring payment methods). A stale local copy would otherwise mask what
    // the owner saved / shadow another device. Writes persist via actions/products.
    setCategoriesState(load(NS + "categories", SEED_CATEGORIES));
    setOrdersState(load(NS + "orders", SEED_ORDERS));
    setMyOrdersState(load(NS + "myorders", [] as Order[]));
    setShippingState(load(NS + "shipping", SEED_SHIPPING_LOCATIONS));
    setCoaState(load(NS + "coa", SEED_COA_REPORTS));
    setPromoState(load(NS + "promo", SEED_PROMO_CODES));
    // NOTE: payment methods are intentionally NOT hydrated from localStorage —
    // they come from the DB via the server-provided brand prop, so a stale local
    // copy can't override what the owner configured (this was the cross-device
    // checkout bug). They persist through savePaymentMethodsAction instead.
    setFaqState(load(NS + "faq", SEED_FAQ_GROUPS));
    setProtocolsState(load(NS + "protocols", SEED_PROTOCOLS));
    setReviewsState(load(NS + "reviews", SEED_REVIEWS));
  }, [NS]);

  useEffect(() => applyBrandStyle(brand), [brand]);

  // Live branding edits: merge in-memory and re-apply palette. NOT persisted to
  // localStorage — brand is DB-sourced (branding.config via the server prop), so
  // a cached copy would mask later operator saves (see hydration note above).
  const setTweak = useCallback(
    (keyOrEdits: keyof Brand | Partial<Brand>, val?: unknown) => {
      const edits: Partial<Brand> =
        typeof keyOrEdits === "object" && keyOrEdits !== null
          ? keyOrEdits
          : ({ [keyOrEdits]: val } as Partial<Brand>);
      setBrandState((prev) => ({ ...prev, ...edits }));
    },
    [],
  );

  // Build a setter that resolves the updater, persists, and mirrors to window.
  function makeSetter<T>(
    key: string,
    winKey: string,
    setState: React.Dispatch<React.SetStateAction<T>>,
  ) {
    return (next: Updater<T>) => {
      setState((prev) => {
        const value =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(NS + key, JSON.stringify(value));
        } catch {
          /* quota — non-fatal */
        }
        (window as unknown as Record<string, unknown>)[winKey] = value;
        return value;
      });
    };
  }

  // Products persist to the DB through actions/products (the admin calls them
  // directly), so this setter only updates local state + the window mirror for
  // optimistic UI — it deliberately skips localStorage so a stale local copy
  // can never shadow the server's set on the next load.
  const setProducts = useMemo<Store["setProducts"]>(
    () => (next) =>
      setProductsState((prev) => {
        const value = typeof next === "function" ? (next as (p: Product[]) => Product[])(prev) : next;
        (window as unknown as Record<string, unknown>).PRODUCTS = value;
        return value;
      }),
    [],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- makeSetter closes over the stable per-mount NS
  const setCategories = useMemo(() => makeSetter<Category[]>("categories", "CATEGORIES", setCategoriesState), [NS]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setOrders = useMemo(() => makeSetter<Order[]>("orders", "ORDERS", setOrdersState), [NS]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setMyOrders = useMemo(() => makeSetter<Order[]>("myorders", "MY_ORDERS", setMyOrdersState), [NS]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setShippingLocations = useMemo(() => makeSetter<ShippingLocation[]>("shipping", "SHIPPING_LOCATIONS", setShippingState), [NS]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setCoaReports = useMemo(() => makeSetter<CoaReport[]>("coa", "COA_REPORTS", setCoaState), [NS]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setPromoCodes = useMemo(() => makeSetter<PromoCode[]>("promo", "PROMO_CODES", setPromoState), [NS]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setFaqGroups = useMemo(() => makeSetter<FaqGroup[]>("faq", "FAQ_GROUPS", setFaqState), [NS]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setProtocols = useMemo(() => makeSetter<Protocol[]>("protocols", "PROTOCOLS", setProtocolsState), [NS]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setReviews = useMemo(() => makeSetter<Review[]>("reviews", "REVIEWS", setReviewsState), [NS]);

  // Keep window mirrors fresh on every render so any global readers stay in sync.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.PRODUCTS = products;
    w.CATEGORIES = categories;
    w.ORDERS = orders;
    w.SHIPPING_LOCATIONS = shippingLocations;
    w.COA_REPORTS = coaReports;
    w.PROMO_CODES = promoCodes;
    w.PAYMENT_METHODS = paymentMethods;
    w.FAQ_GROUPS = faqGroups;
    w.PROTOCOLS = protocols;
    w.REVIEWS = reviews;
  });

  const addToCart = useCallback((product: Product) => {
    setCart((c) => [...c, product]);
  }, []);

  const decrementCart = useCallback((productId: string) => {
    setCart((c) => {
      const i = c.findIndex((p) => p.id === productId);
      if (i === -1) return c;
      const next = [...c];
      next.splice(i, 1);
      return next;
    });
  }, []);

  const removeLine = useCallback((productId: string) => {
    setCart((c) => c.filter((p) => p.id !== productId));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 1600);
  }, []);

  // Payment methods persist to the DB (not localStorage) so every device sees
  // the owner's configured set. The server action gates on the storefront-admin
  // session; the local state updates optimistically and we only surface failures.
  const setPaymentMethods = useCallback(
    (next: Updater<PaymentMethod[]>) => {
      // Resolve once OUTSIDE the state updater so the save fires exactly once
      // (a side effect inside the updater would double-fire under StrictMode).
      const value =
        typeof next === "function"
          ? (next as (p: PaymentMethod[]) => PaymentMethod[])(paymentMethods)
          : next;
      setPaymentsState(value);
      // Surface failures loudly — a rejected save (e.g. no admin session) would
      // otherwise leave the UI looking saved while the DB never changed.
      savePaymentMethodsAction(value)
        .then((r) => {
          if (r && "error" in r) {
            toast(`Couldn't save payment methods: ${r.error}`);
          }
        })
        .catch(() => {
          toast("Couldn't save payment methods — please sign in again and retry.");
        });
    },
    [toast, paymentMethods],
  );

  const value: Store = {
    brand, setTweak,
    products, setProducts,
    categories, setCategories,
    orders, setOrders,
    myOrders, setMyOrders,
    shippingLocations, setShippingLocations,
    coaReports, setCoaReports,
    promoCodes, setPromoCodes,
    paymentMethods, setPaymentMethods,
    faqGroups, setFaqGroups,
    protocols, setProtocols,
    reviews, setReviews,
    cart, addToCart, decrementCart, removeLine, clearCart,
    toast, toastMsg,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within <StoreProvider>");
  return ctx;
}
