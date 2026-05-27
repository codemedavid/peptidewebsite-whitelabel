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

const NS = "sf_v1__";

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
}: {
  children: ReactNode;
  brand?: Brand;
}) {
  const [brand, setBrandState] = useState<Brand>(brandSeed);
  const [products, setProductsState] = useState<Product[]>(SEED_PRODUCTS);
  const [categories, setCategoriesState] = useState<Category[]>(SEED_CATEGORIES);
  const [orders, setOrdersState] = useState<Order[]>(SEED_ORDERS);
  const [shippingLocations, setShippingState] = useState<ShippingLocation[]>(SEED_SHIPPING_LOCATIONS);
  const [coaReports, setCoaState] = useState<CoaReport[]>(SEED_COA_REPORTS);
  const [promoCodes, setPromoState] = useState<PromoCode[]>(SEED_PROMO_CODES);
  const [paymentMethods, setPaymentsState] = useState<PaymentMethod[]>(SEED_PAYMENT_METHODS);
  const [faqGroups, setFaqState] = useState<FaqGroup[]>(SEED_FAQ_GROUPS);
  const [protocols, setProtocolsState] = useState<Protocol[]>(SEED_PROTOCOLS);
  const [reviews, setReviewsState] = useState<Review[]>(SEED_REVIEWS);
  const [cart, setCart] = useState<Product[]>([]);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from localStorage after mount (avoids SSR/client mismatch).
  useEffect(() => {
    // Brand overrides merge on top of the tenant-seeded defaults.
    const savedBrand = load<Partial<Brand> | null>(NS + "brand", null);
    if (savedBrand) setBrandState((b) => ({ ...b, ...savedBrand }));
    setProductsState(load(NS + "products", SEED_PRODUCTS));
    setCategoriesState(load(NS + "categories", SEED_CATEGORIES));
    setOrdersState(load(NS + "orders", SEED_ORDERS));
    setShippingState(load(NS + "shipping", SEED_SHIPPING_LOCATIONS));
    setCoaState(load(NS + "coa", SEED_COA_REPORTS));
    setPromoState(load(NS + "promo", SEED_PROMO_CODES));
    setPaymentsState(load(NS + "payments", SEED_PAYMENT_METHODS));
    setFaqState(load(NS + "faq", SEED_FAQ_GROUPS));
    setProtocolsState(load(NS + "protocols", SEED_PROTOCOLS));
    setReviewsState(load(NS + "reviews", SEED_REVIEWS));
  }, []);

  useEffect(() => applyBrandStyle(brand), [brand]);

  // Live branding edits: merge, persist, re-apply palette.
  const setTweak = useCallback(
    (keyOrEdits: keyof Brand | Partial<Brand>, val?: unknown) => {
      const edits: Partial<Brand> =
        typeof keyOrEdits === "object" && keyOrEdits !== null
          ? keyOrEdits
          : ({ [keyOrEdits]: val } as Partial<Brand>);
      setBrandState((prev) => {
        const next = { ...prev, ...edits };
        try {
          window.localStorage.setItem(NS + "brand", JSON.stringify(next));
        } catch {
          /* quota — non-fatal */
        }
        return next;
      });
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

  const setProducts = useMemo(() => makeSetter<Product[]>("products", "PRODUCTS", setProductsState), []);
  const setCategories = useMemo(() => makeSetter<Category[]>("categories", "CATEGORIES", setCategoriesState), []);
  const setOrders = useMemo(() => makeSetter<Order[]>("orders", "ORDERS", setOrdersState), []);
  const setShippingLocations = useMemo(() => makeSetter<ShippingLocation[]>("shipping", "SHIPPING_LOCATIONS", setShippingState), []);
  const setCoaReports = useMemo(() => makeSetter<CoaReport[]>("coa", "COA_REPORTS", setCoaState), []);
  const setPromoCodes = useMemo(() => makeSetter<PromoCode[]>("promo", "PROMO_CODES", setPromoState), []);
  const setPaymentMethods = useMemo(() => makeSetter<PaymentMethod[]>("payments", "PAYMENT_METHODS", setPaymentsState), []);
  const setFaqGroups = useMemo(() => makeSetter<FaqGroup[]>("faq", "FAQ_GROUPS", setFaqState), []);
  const setProtocols = useMemo(() => makeSetter<Protocol[]>("protocols", "PROTOCOLS", setProtocolsState), []);
  const setReviews = useMemo(() => makeSetter<Review[]>("reviews", "REVIEWS", setReviewsState), []);

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

  const value: Store = {
    brand, setTweak,
    products, setProducts,
    categories, setCategories,
    orders, setOrders,
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
