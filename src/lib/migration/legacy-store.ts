/**
 * Map a store's catalog off the old Vite + Supabase peptide app (the template
 * HP GLOW and The Peppy Lab both ran on) into the whitelabel's storefront shapes.
 *
 * The old app exposes flat public tables — products, product_variations,
 * categories, payment_methods, vouchers. This module is the pure translation;
 * fetching and writing live in scripts/import-legacy-store.ts. Orders have their
 * own mapper (src/lib/orders/legacy-import.ts) because money there is subtle.
 *
 * Decisions baked in:
 *
 *  • COMPLETE SET. The old card toggled "Vial Only" ↔ "Complete Set" with a
 *    second price. That is exactly a two-option variation, so it becomes one.
 *    Variations carry no copy, so the set's inclusions are appended to the
 *    product description where the buyer still reads them.
 *  • REAL VARIATIONS WIN. A product with product_variations rows (e.g. pen
 *    colours) uses them verbatim — with their own stock — and ignores the set
 *    toggle, matching what the old storefront rendered.
 *  • IDENTITY. SKUs derive from the legacy uuid, so re-running the import
 *    upserts the same rows instead of duplicating the catalog.
 *
 * Pure: no DB, no network. Covered by scripts/test-legacy-store.ts.
 */

import type { Category, PaymentMethod, Product, PromoCode } from "@/storefront/types";

// ── Legacy rows ──────────────────────────────────────────────────────────────

export interface LegacyCategoryRow {
  id: string;
  name: string;
  sort_order: number | null;
  active: boolean | null;
}

export interface LegacyProductRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  base_price: number;
  discount_price: number | null;
  discount_active: boolean | null;
  purity_percentage: number | null;
  molecular_weight: string | null;
  cas_number: string | null;
  sequence: string | null;
  storage_conditions: string | null;
  stock_quantity: number | null;
  available: boolean | null;
  featured: boolean | null;
  image_url: string | null;
  is_complete_set: boolean | null;
  complete_set_price: number | null;
  complete_set_description: string | null;
}

export interface LegacyVariationRow {
  id: string;
  product_id: string;
  name: string;
  quantity_mg: number | null;
  price: number;
  discount_price: number | null;
  discount_active: boolean | null;
  stock_quantity: number | null;
}

export interface LegacyPaymentMethodRow {
  id: string;
  name: string;
  account_number: string | null;
  account_name: string | null;
  qr_code_url: string | null;
  active: boolean | null;
  sort_order: number | null;
}

export interface LegacyVoucherRow {
  id: string;
  code: string;
  discount_type: string;
  discount_value: number;
  min_spend: number | null;
  usage_limit: number | null;
  times_used: number | null;
  is_active: boolean | null;
  expires_at: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SKU_PREFIX = "leg-";
const SKU_HEX_LENGTH = 12;
const VIAL_ONLY_LABEL = "Vial Only";
const COMPLETE_SET_LABEL = "Complete Set";

const money = (n: unknown): number => Math.max(0, Number(n) || 0);
const text = (s: string | null | undefined): string => (s ?? "").trim();

function slugId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "category";
}

/** The price a legacy row actually sold at: the discount only when it is on AND lower. */
function effectivePrice(price: number, discount: number | null, active: boolean | null): number {
  const base = money(price);
  const cut = money(discount);
  return active && cut > 0 && cut < base ? cut : base;
}

/** Stable, upsert-safe SKU from a legacy uuid. */
export function legacySku(legacyId: string): string {
  const hex = legacyId.toLowerCase().replace(/[^0-9a-f]/g, "");
  return `${SKU_PREFIX}${hex.slice(0, SKU_HEX_LENGTH)}`;
}

// ── Categories ───────────────────────────────────────────────────────────────

export function mapLegacyCategories(rows: readonly LegacyCategoryRow[]): {
  categories: Category[];
  idMap: Map<string, string>;
} {
  const active = rows
    .filter((r) => r.active !== false && text(r.name))
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const taken = new Set<string>();
  const idMap = new Map<string, string>();
  const categories = active.map((r) => {
    const base = slugId(text(r.name));
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    idMap.set(r.id, id);
    return { id, label: text(r.name) };
  });
  return { categories, idMap };
}

// ── Products ─────────────────────────────────────────────────────────────────

function setInclusions(description: string | null): string[] {
  return text(description)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function describe(row: LegacyProductRow, hasSetOption: boolean): string {
  const body = text(row.description);
  const items = hasSetOption ? setInclusions(row.complete_set_description) : [];
  if (!items.length) return body;
  const block = `${COMPLETE_SET_LABEL} includes:\n${items.map((i) => `• ${i}`).join("\n")}`;
  return body ? `${body}\n\n${block}` : block;
}

function mapVariations(
  row: LegacyProductRow,
  variations: readonly LegacyVariationRow[],
): Product["variations"] {
  if (variations.length) {
    return variations.map((v) => ({
      name: text(v.name),
      price: effectivePrice(v.price, v.discount_price, v.discount_active),
      ...(typeof v.stock_quantity === "number" ? { stock: Math.max(0, v.stock_quantity) } : {}),
    }));
  }
  if (row.is_complete_set && money(row.complete_set_price) > 0) {
    return [
      { name: VIAL_ONLY_LABEL, price: money(row.base_price) },
      { name: COMPLETE_SET_LABEL, price: money(row.complete_set_price) },
    ];
  }
  return undefined;
}

export function mapLegacyProduct(
  row: LegacyProductRow,
  variations: readonly LegacyVariationRow[],
  categoryIdMap: ReadonlyMap<string, string>,
  currencySymbol: string,
): Product {
  const mappedVariations = mapVariations(row, variations);
  const hasSetOption = !variations.length && !!mappedVariations;
  const base = money(row.base_price);
  const discount = money(row.discount_price);
  const discountEnabled = !!row.discount_active && discount > 0 && discount < base;

  return {
    id: legacySku(row.id),
    name: text(row.name),
    description: describe(row, hasSetOption),
    price: base,
    currency: currencySymbol,
    purity: row.purity_percentage ? `${row.purity_percentage}%` : undefined,
    category: (row.category && categoryIdMap.get(row.category)) || "",
    featured: !!row.featured,
    image: text(row.image_url) || null,
    stock: Math.max(0, Math.round(Number(row.stock_quantity) || 0)),
    available: row.available !== false,
    discountEnabled,
    discountPrice: discountEnabled ? discount : null,
    molecularWeight: text(row.molecular_weight) || undefined,
    cas: text(row.cas_number) || undefined,
    storage: text(row.storage_conditions) || undefined,
    sequence: text(row.sequence) || undefined,
    ...(mappedVariations ? { variations: mappedVariations } : {}),
  };
}

// ── Payment methods ──────────────────────────────────────────────────────────

export function mapLegacyPaymentMethods(rows: readonly LegacyPaymentMethodRow[]): PaymentMethod[] {
  return rows
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((r) => ({
      id: r.id,
      name: text(r.name),
      account: text(r.account_name),
      number: text(r.account_number),
      qrImage: text(r.qr_code_url),
      order: r.sort_order ?? 0,
      active: r.active !== false,
    }));
}

// ── Vouchers → promo codes ───────────────────────────────────────────────────

export function mapLegacyVouchers(rows: readonly LegacyVoucherRow[]): PromoCode[] {
  const seen = new Set<string>();
  const out: PromoCode[] = [];
  for (const r of rows) {
    const code = text(r.code).toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({
      id: r.id,
      code,
      type: r.discount_type === "fixed" ? "fixed" : "percent",
      value: money(r.discount_value),
      minPurchase: money(r.min_spend),
      usageLimit: typeof r.usage_limit === "number" ? r.usage_limit : null,
      used: Math.max(0, Number(r.times_used) || 0),
      expiry: r.expires_at || null,
      active: r.is_active !== false,
    });
  }
  return out;
}
