import { Alert } from "react-native";
import * as Haptics from "expo-haptics";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap, type AdminBrand } from "../bridge";
import type { Row } from "./rules";

/**
 * Data layer for the Store setup editors. Everything is read from the same
 * `brand` the website admin renders from and written through the website's own
 * save actions — the app never decides what is valid, it only sends what the web
 * form would send and shows the server's `{ error }` word for word.
 */

export const setupKeys = {
  /** Every admin-bridge read for this session — invalidated after any save. */
  all: (scope: string) => [scope, "admin"] as const,
  brand: (scope: string) => [scope, "admin", "brand"] as const,
};

export function useAdminBrand() {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: setupKeys.brand(scope),
    queryFn: async () => (await adminBridge.brand()).brand,
  });
}

export const success = () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);

function useAfterSave() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: setupKeys.all(scope) });
    // The Home tab's open/closed card and fee-aware totals read the dashboard.
    void qc.invalidateQueries({ queryKey: qk.dashboard(scope) });
  };
}

/**
 * Save one settings blob (store status, checkout fee, banner, hero) through
 * `fn`. Those actions replace their own key only, so the payload is the whole
 * editor state — built by the screen exactly as the web editor builds it.
 */
export function useSetupSave(fn: string) {
  const afterSave = useAfterSave();
  return useMutation({
    mutationFn: async (payload: unknown) => unwrap(await adminBridge.call<{ ok: true } | { error: string }>(fn, payload)),
    onSuccess: () => {
      success();
      afterSave();
    },
  });
}

/** A saved collection, or the website's starter list when the store never saved one. */
export function listFrom(brand: AdminBrand | undefined, key: string, seed: Row[]): Row[] {
  const value = brand?.[key];
  if (value === undefined || value === null) return seed;
  return Array.isArray(value) ? value.filter((r): r is Row => !!r && typeof r === "object") : [];
}

export type ListOp = (list: Row[]) => Row[];

/**
 * A list the website saves WHOLE on every change (payment methods, couriers,
 * shipping locations, promo codes — the web store's setX → saveXAction).
 *
 * Each change is applied to the server's CURRENT list, fetched right before the
 * save, so an edit made on the website a minute ago is never overwritten by this
 * phone's stale copy. Ops only touch the row they target and spread every other
 * key through, so fields the app doesn't edit survive the round trip.
 */
/**
 * Where a collection lives in the brand and how it is saved. The default is a
 * top-level `brand[key]` list saved as `fn(list)`; a nested list (e.g. the
 * International shipping rates in `brand.intlMarket`) supplies its own.
 */
export type CollectionAccess = {
  read: (brand: AdminBrand | undefined) => Row[];
  write: (brand: AdminBrand, list: Row[]) => AdminBrand;
  args: (list: Row[]) => unknown[];
};

export function useCollection(key: string, fn: string, seed: Row[], noun: string, access?: CollectionAccess) {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const brand = useAdminBrand();
  const afterSave = useAfterSave();
  const brandKey = setupKeys.brand(scope);
  const read = access?.read ?? ((b: AdminBrand | undefined) => listFrom(b, key, seed));
  const write = access?.write ?? ((b: AdminBrand, list: Row[]) => ({ ...b, [key]: list }));
  const args = access?.args ?? ((list: Row[]) => [list]);

  const m = useMutation({
    mutationFn: async (op: ListOp) => {
      const fresh = (await adminBridge.brand()).brand;
      const next = op(read(fresh));
      unwrap(await adminBridge.call<{ ok: true } | { error: string }>(fn, ...args(next)));
      return next;
    },
    onMutate: async (op) => {
      await qc.cancelQueries({ queryKey: brandKey });
      const previous = qc.getQueryData<AdminBrand>(brandKey);
      if (previous) qc.setQueryData<AdminBrand>(brandKey, write(previous, op(read(previous))));
      return { previous };
    },
    onError: (e, _op, ctx) => {
      if (ctx?.previous) qc.setQueryData(brandKey, ctx.previous);
      // The website's wording: "Couldn't save payment methods: <reason>".
      Alert.alert(`Couldn't save ${noun}`, e.message);
    },
    onSuccess: (next) => {
      const current = qc.getQueryData<AdminBrand>(brandKey);
      if (current) qc.setQueryData<AdminBrand>(brandKey, write(current, next));
      afterSave();
    },
  });

  return {
    brand,
    items: read(brand.data),
    saving: m.isPending,
    /** Apply `op` to the server's current list and save it. Resolves true on success. */
    apply: (op: ListOp) =>
      m.mutateAsync(op).then(
        () => true,
        () => false,
      ),
  };
}

// ── row ops (immutable; unknown keys on every row are carried through) ──────

export const upsertRow =
  (row: Row): ListOp =>
  (list) =>
    list.some((r) => r.id === row.id) ? list.map((r) => (r.id === row.id ? { ...r, ...row } : r)) : [...list, row];

export const removeRows =
  (ids: ReadonlySet<unknown>): ListOp =>
  (list) =>
    list.filter((r) => !ids.has(r.id));

export const toggleActive =
  (id: unknown): ListOp =>
  (list) =>
    list.map((r) => (r.id === id ? { ...r, active: !(r.active !== false) } : r));

/**
 * The International (USD) shipping rates of a dual-currency store
 * (brand.intlMarket.shippingLocations) — saved through saveIntlMarketAction,
 * which writes only the shipping half so the market switch is never touched.
 */
export const INTL_SHIPPING_ACCESS: CollectionAccess = {
  read: (b) => {
    const market = (b?.intlMarket ?? {}) as { shippingLocations?: unknown };
    return Array.isArray(market.shippingLocations) ? market.shippingLocations.filter((r): r is Row => !!r && typeof r === "object") : [];
  },
  write: (b, list) => ({ ...b, intlMarket: { ...((b.intlMarket ?? {}) as object), shippingLocations: list } }),
  args: (list) => [{ shippingLocations: list }],
};
