/**
 * Carry a store's order history over from the system it ran on BEFORE the
 * whitelabel — built for HP GLOW's Supabase app (487 orders, 2025-11 → 2026-08)
 * and kept generic enough for the next migration.
 *
 * Input is a `pg_dumpall` plain-text dump: a `COPY public.orders … FROM stdin;`
 * block of tab-separated rows. Output is the denormalized shape a
 * storefront_orders row wants (customer{}, shipping{}, items[], statusHistory[]).
 *
 * Three decisions are baked in, because getting any of them wrong is silent:
 *
 *  • MONEY. The old `total_price` is the ITEMS SUBTOTAL — it excludes both the
 *    shipping fee and the voucher. The whitelabel derives the total instead
 *    (items − discount + shipping + adminFee, see admin-dashboard/orderTotal),
 *    so we carry the parts, never the old total, and the derived number comes
 *    out as what the customer actually paid.
 *
 *  • LINKAGE. Lines resolve to live catalog productIds wherever the product
 *    survived, so eight months of demand feed Best Sellers and per-product
 *    reporting. Safe only because every imported order is flagged `imported`,
 *    which freezes stock movement (see storefront/order-status/inventoryMove) —
 *    those units were consumed on the old system and the live counts already
 *    exclude them.
 *
 *  • IDENTITY. The legacy row's uuid becomes `clientId`, which is unique per
 *    tenant, so re-running an import can never duplicate an order. Order numbers
 *    come from a dedicated namespace (HPG-IMP-0001…) so they never collide with
 *    the tenant's live orderSeq.
 *
 * Pure: no DB, no Next runtime. Covered by scripts/test-legacy-order-import.ts.
 */

import type { OrderItem, OrderStatus, OrderStatusEvent } from "@/storefront/types";
import { isOrderStatus } from "@/lib/storefront/order-status";

// ── The legacy row ───────────────────────────────────────────────────────────

/** One line of the old `orders.order_items` jsonb array. */
export interface LegacyOrderItem {
  product_name: string;
  variation_name?: string | null;
  quantity: number;
  price: number;
  product_id?: string | null;
  variation_id?: string | null;
  total?: number | null;
}

/** One row of the old flat `public.orders` table, typed and null-normalized. */
export interface LegacyOrderRow {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: string;
  shippingCity: string;
  shippingState: string;
  shippingZipCode: string;
  shippingCountry: string | null;
  /** The old app's coarse region bucket — "NCR" | "LUZON" | "VISAYAS_MINDANAO". */
  shippingLocation: string | null;
  shippingFee: number;
  orderItems: LegacyOrderItem[];
  /** Items subtotal ONLY — no shipping, no voucher. See the module header. */
  totalPrice: number;
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  paymentProofUrl: string | null;
  paymentStatus: string | null;
  contactMethod: string | null;
  orderStatus: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  shippingBarangay: string;
  voucherCode: string | null;
  voucherDiscount: number;
}

// ── COPY text-format parsing ─────────────────────────────────────────────────

const COPY_HEADER_RE = /^COPY public\.orders \([^)]*\) FROM stdin;$/;

/** Postgres COPY text escapes. A field that is exactly `\N` is NULL. */
const ESCAPES: Record<string, string> = {
  "\\": "\\",
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  v: "\v",
};

/** Decode one COPY field: `\N` → null, otherwise unescape in a single pass. */
function decodeField(raw: string): string | null {
  if (raw === "\\N") return null;
  if (!raw.includes("\\")) return raw;
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\" || i === raw.length - 1) {
      out += ch;
      continue;
    }
    const next = raw[++i];
    out += ESCAPES[next] ?? next;
  }
  return out;
}

/** A required text column — NULL collapses to "" so downstream stays string-typed. */
function text(fields: (string | null)[], index: number): string {
  return fields[index] ?? "";
}

function numeric(fields: (string | null)[], index: number): number {
  const n = Number(fields[index]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Postgres timestamptz (`2026-01-23 01:50:18.299906+00`) → ISO 8601.
 * Microseconds truncate to milliseconds, which is all a JS Date carries.
 */
function toIso(raw: string): string {
  const normalized = raw.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) throw new Error(`Unparseable timestamp: ${raw}`);
  return d.toISOString();
}

function parseItems(raw: string | null): LegacyOrderItem[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry) => {
    const x = (entry ?? {}) as Record<string, unknown>;
    return {
      product_name: typeof x.product_name === "string" ? x.product_name : "",
      variation_name: typeof x.variation_name === "string" ? x.variation_name : null,
      quantity: Number(x.quantity) || 0,
      price: Number(x.price) || 0,
      product_id: typeof x.product_id === "string" ? x.product_id : null,
      variation_id: typeof x.variation_id === "string" ? x.variation_id : null,
    };
  });
}

/**
 * Pull the `public.orders` COPY block out of a plain-text pg dump and decode it.
 * A dump with no such block yields `[]` — the caller reports that, rather than
 * this throwing halfway through a migration.
 */
export function parseLegacyOrders(dump: string): LegacyOrderRow[] {
  const lines = dump.split("\n");
  const start = lines.findIndex((line) => COPY_HEADER_RE.test(line));
  if (start === -1) return [];

  const rows: LegacyOrderRow[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === "\\.") break;
    if (line === "") continue;

    const f = line.split("\t").map(decodeField);
    rows.push({
      id: text(f, 0),
      customerName: text(f, 1),
      customerEmail: text(f, 2),
      customerPhone: text(f, 3),
      shippingAddress: text(f, 4),
      shippingCity: text(f, 5),
      shippingState: text(f, 6),
      shippingZipCode: text(f, 7),
      shippingCountry: f[8],
      shippingLocation: f[9],
      shippingFee: numeric(f, 10),
      orderItems: parseItems(f[11]),
      totalPrice: numeric(f, 12),
      paymentMethodId: f[13],
      paymentMethodName: f[14],
      paymentProofUrl: f[15],
      paymentStatus: f[16],
      contactMethod: f[17],
      orderStatus: f[18],
      notes: f[19],
      createdAt: text(f, 20),
      updatedAt: text(f, 21),
      shippingBarangay: text(f, 22),
      voucherCode: f[23],
      voucherDiscount: numeric(f, 24),
    });
  }
  return rows;
}

// ── Resolving a legacy line against the live catalog ─────────────────────────

/** The minimal live-catalog shape the resolver needs. */
export interface LegacyCatalogProduct {
  id: string;
  name: string;
  variations?: { name: string }[];
}

export interface CatalogIndex {
  /** Normalized product name → the product. */
  byName: Map<string, LegacyCatalogProduct>;
  /** Normalized "product name + dose" → the product and the dose it belongs to. */
  byNameAndDose: Map<string, { product: LegacyCatalogProduct; variation: string }>;
}

/** Case- and whitespace-insensitive key, so "Aqualyx " matches "Aqualyx". */
function key(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Index the live catalog for both lookup shapes the old data uses: some rows
 * name the product and carry the dose separately ("Tirzepatide" + "30mg"),
 * others bake the dose into the name ("Glutathione 1500mg").
 */
export function buildCatalogIndex(products: readonly LegacyCatalogProduct[]): CatalogIndex {
  const byName = new Map<string, LegacyCatalogProduct>();
  const byNameAndDose = new Map<string, { product: LegacyCatalogProduct; variation: string }>();
  for (const product of products) {
    const name = key(product.name);
    // First write wins: a catalog with duplicate rows (a known hazard — see the
    // group-buy assignment drift) resolves deterministically instead of by order.
    if (!byName.has(name)) byName.set(name, product);
    for (const variation of product.variations ?? []) {
      const composite = key(`${product.name} ${variation.name}`);
      if (!byNameAndDose.has(composite)) {
        byNameAndDose.set(composite, { product, variation: variation.name });
      }
    }
  }
  return { byName, byNameAndDose };
}

/** The whitelabel names a variation line "Product — Dose" (see makeVariationEntry),
 *  so an imported order reads identically to one placed through checkout. */
function variationLabel(productName: string, variation: string): string {
  return `${productName.trim()} — ${variation}`;
}

/**
 * Map one legacy line onto the live catalog. A product that no longer exists
 * still imports — with its historical name, quantity and unit price intact —
 * it just carries no productId, exactly like a pre-productId legacy order.
 */
export function resolveLegacyLine(index: CatalogIndex, item: LegacyOrderItem): OrderItem {
  const rawName = (item.product_name || "").trim();
  const dose = (item.variation_name || "").trim();
  const qty = Math.max(1, Math.round(item.quantity) || 1);
  const price = Math.max(0, Number(item.price) || 0);

  if (dose) {
    const product = index.byName.get(key(rawName));
    return product
      ? {
          name: variationLabel(product.name, dose),
          qty,
          price,
          productId: product.id,
          variation: dose,
        }
      : { name: variationLabel(rawName, dose), qty, price, variation: dose };
  }

  // Exact name first: a product whose dose IS its name ("Tirzepatide 60mg (Free
  // Shipping Nationwide)") must win over a same-reading name+dose composite.
  const exact = index.byName.get(key(rawName));
  if (exact) return { name: exact.name, qty, price, productId: exact.id };

  const folded = index.byNameAndDose.get(key(rawName));
  if (folded) {
    return {
      name: variationLabel(folded.product.name, folded.variation),
      qty,
      price,
      productId: folded.product.id,
      variation: folded.variation,
    };
  }

  return { name: rawName, qty, price };
}

// ── Mapping a whole order ────────────────────────────────────────────────────

/** A legacy order in the shape the importer writes to storefront_orders. */
export interface ImportedOrder {
  /** The legacy uuid — unique per tenant, so a re-run is idempotent. */
  clientId: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: "pending" | "paid";
  paymentMethod: string;
  /** Always null — the old proof images are unrecoverable, so the admin shows
   *  "no proof on file" rather than a permanently broken image. */
  paymentProofUrl: null;
  customer: { name: string; email: string; phone: string; contactMethod: string };
  shipping: {
    address: string;
    barangay: string;
    city: string;
    province: string;
    postal: string;
    country: string;
    region: string;
    fee: number;
  };
  items: OrderItem[];
  statusHistory: OrderStatusEvent[];
  discount?: { code: string; label: string; amount: number };
  courier: string;
  trackingNumber: string;
  shippingNote: string;
  placedAt: string;
  updatedAt: string;
  imported: true;
}

export interface MapLegacyOrderOptions {
  index: CatalogIndex;
  orderNumber: string;
}

/** `importOrderNumber("HPG-IMP", 7)` → "HPG-IMP-0007". A namespace of its own,
 *  so an imported number can never collide with the tenant's live orderSeq. */
export function importOrderNumber(prefix: string, n: number, digits = 4): string {
  return `${prefix}-${String(n).padStart(digits, "0")}`;
}

/**
 * Replay the journey we can actually evidence: the order was placed, and — if it
 * did not stay "new" — it reached its final status when the row was last touched.
 * The intermediate steps were never recorded, so inventing them would be fiction.
 */
function buildStatusHistory(
  status: OrderStatus,
  placedAt: string,
  updatedAt: string,
): OrderStatusEvent[] {
  const history: OrderStatusEvent[] = [{ status: "new", at: placedAt }];
  if (status === "new") return history;
  // Keep the journey monotonic even if the old row's timestamps disagree.
  history.push({ status, at: updatedAt >= placedAt ? updatedAt : placedAt });
  return history;
}

/** Map one decoded legacy row into the order we store. */
export function mapLegacyOrder(row: LegacyOrderRow, opts: MapLegacyOrderOptions): ImportedOrder {
  const status: OrderStatus = isOrderStatus(row.orderStatus) ? row.orderStatus : "new";
  const placedAt = toIso(row.createdAt);
  const updatedAt = toIso(row.updatedAt);
  const discountAmount = Math.max(0, row.voucherDiscount);

  return {
    clientId: row.id,
    orderNumber: opts.orderNumber,
    status,
    paymentStatus: row.paymentStatus === "paid" ? "paid" : "pending",
    paymentMethod: row.paymentMethodName ?? "",
    paymentProofUrl: null,
    customer: {
      name: row.customerName,
      email: row.customerEmail,
      phone: row.customerPhone,
      contactMethod: row.contactMethod ?? "",
    },
    shipping: {
      address: row.shippingAddress,
      barangay: row.shippingBarangay,
      city: row.shippingCity,
      province: row.shippingState,
      postal: row.shippingZipCode,
      country: row.shippingCountry ?? "",
      region: row.shippingLocation ?? "",
      fee: Math.max(0, row.shippingFee),
    },
    items: row.orderItems.map((item) => resolveLegacyLine(opts.index, item)),
    statusHistory: buildStatusHistory(status, placedAt, updatedAt),
    // The old table has no label for a voucher, only its code — so the code is
    // the label. Amount 0 means no real discount, not an empty one.
    ...(row.voucherCode && discountAmount > 0
      ? { discount: { code: row.voucherCode, label: row.voucherCode, amount: discountAmount } }
      : {}),
    courier: "",
    trackingNumber: "",
    // The old `notes` column is the customer's delivery instruction, which is
    // exactly what shippingNote carries (and shows on the Track page).
    shippingNote: row.notes ?? "",
    placedAt,
    updatedAt,
    imported: true,
  };
}
