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
  /** The old card's "Complete Set" toggle (The Peppy Lab's template); a set
   *  line resolves to the "Complete Set" option, a plain one to "Vial Only". */
  is_complete_set?: boolean | null;
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
  /** Only REST rows carry these (the COPY dump format predates them). */
  legacyOrderNumber?: string | null;
  courierName?: string | null;
  trackingNumber?: string | null;
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

function itemsFrom(parsed: unknown): LegacyOrderItem[] {
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
      ...(typeof x.is_complete_set === "boolean" ? { is_complete_set: x.is_complete_set } : {}),
    };
  });
}

function parseItems(raw: string | null): LegacyOrderItem[] {
  if (!raw) return [];
  return itemsFrom(JSON.parse(raw));
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

// ── REST (JSON) rows ─────────────────────────────────────────────────────────

const jsonText = (v: unknown): string => (typeof v === "string" ? v : "");
const jsonNullable = (v: unknown): string | null => (typeof v === "string" ? v : null);
const jsonNumber = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Decode one row of the old `orders` table as served by its PostgREST API — the
 * route for a legacy project that is still live (no dump needed). Yields the
 * same shape `parseLegacyOrders` does, plus the columns the newer template has.
 */
export function legacyOrderRowFromJson(raw: Record<string, unknown>): LegacyOrderRow {
  const discount = jsonNumber(raw.discount_amount) || jsonNumber(raw.discount_applied);
  return {
    id: jsonText(raw.id),
    customerName: jsonText(raw.customer_name),
    customerEmail: jsonText(raw.customer_email),
    customerPhone: jsonText(raw.customer_phone),
    shippingAddress: jsonText(raw.shipping_address),
    shippingCity: jsonText(raw.shipping_city),
    shippingState: jsonText(raw.shipping_state),
    shippingZipCode: jsonText(raw.shipping_zip_code),
    shippingCountry: jsonNullable(raw.shipping_country),
    shippingLocation: jsonNullable(raw.shipping_location),
    shippingFee: jsonNumber(raw.shipping_fee),
    orderItems: itemsFrom(raw.order_items),
    totalPrice: jsonNumber(raw.total_price),
    paymentMethodId: jsonNullable(raw.payment_method_id),
    paymentMethodName: jsonNullable(raw.payment_method_name),
    paymentProofUrl: jsonNullable(raw.payment_proof_url),
    paymentStatus: jsonNullable(raw.payment_status),
    contactMethod: jsonNullable(raw.contact_method),
    orderStatus: jsonNullable(raw.order_status),
    notes: jsonNullable(raw.notes),
    createdAt: jsonText(raw.created_at),
    updatedAt: jsonText(raw.updated_at),
    shippingBarangay: jsonText(raw.shipping_barangay),
    voucherCode: jsonNullable(raw.voucher_code) ?? jsonNullable(raw.promo_code),
    voucherDiscount: discount,
    legacyOrderNumber: jsonNullable(raw.order_number),
    courierName: jsonNullable(raw.courier_name),
    trackingNumber: jsonNullable(raw.tracking_number),
  };
}

// ── Resolving a legacy line against the live catalog ─────────────────────────

/** The minimal live-catalog shape the resolver needs. */
export interface LegacyCatalogProduct {
  id: string;
  name: string;
  variations?: { name: string }[];
  /** The product's uuid on the OLD system, when the catalog was imported from
   *  it (scripts/import-legacy-store.ts). Lets a line link by id, rename-proof. */
  legacyId?: string;
}

export interface CatalogIndex {
  /** Legacy uuid → the product (only for catalogs imported off the old app). */
  byLegacyId: Map<string, LegacyCatalogProduct>;
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
  const byLegacyId = new Map<string, LegacyCatalogProduct>();
  const byName = new Map<string, LegacyCatalogProduct>();
  const byNameAndDose = new Map<string, { product: LegacyCatalogProduct; variation: string }>();
  for (const product of products) {
    if (product.legacyId && !byLegacyId.has(product.legacyId)) {
      byLegacyId.set(product.legacyId, product);
    }
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
  return { byLegacyId, byName, byNameAndDose };
}

const COMPLETE_SET_OPTION = "Complete Set";
const VIAL_ONLY_OPTION = "Vial Only";

/** The option a line bought: its own variation name, else the set toggle mapped
 *  onto the product's "Complete Set" / "Vial Only" options when it has them. */
function lineDose(product: LegacyCatalogProduct | undefined, item: LegacyOrderItem): string {
  const named = (item.variation_name || "").trim();
  if (named || typeof item.is_complete_set !== "boolean") return named;
  const options = new Set((product?.variations ?? []).map((v) => v.name));
  const wanted = item.is_complete_set ? COMPLETE_SET_OPTION : VIAL_ONLY_OPTION;
  return options.has(wanted) ? wanted : "";
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
  const qty = Math.max(1, Math.round(item.quantity) || 1);
  const price = Math.max(0, Number(item.price) || 0);

  // The legacy id is rename-proof, so it wins whenever the catalog carries it.
  const byId = item.product_id ? index.byLegacyId.get(item.product_id) : undefined;
  const dose = lineDose(byId ?? index.byName.get(key(rawName)), item);
  if (byId) {
    return dose
      ? { name: variationLabel(byId.name, dose), qty, price, productId: byId.id, variation: dose }
      : { name: byId.name, qty, price, productId: byId.id };
  }

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
  /** Null unless the caller re-hosted the proof (`proofUrl` option). A dead
   *  legacy URL is never stored: the admin shows "no proof on file" instead of
   *  a permanently broken image. */
  paymentProofUrl: string | null;
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
  /** The buyer's own words. Kept off `shippingNote`, which is the owner's
   *  outbound note and renders on the public Track page. */
  customerNote: string;
  placedAt: string;
  updatedAt: string;
  imported: true;
}

export interface MapLegacyOrderOptions {
  index: CatalogIndex;
  orderNumber: string;
  /** The proof image already re-hosted onto the tenant's own storage. */
  proofUrl?: string | null;
  /** Where the old `notes` column lands. "shipping" is what the HP GLOW import
   *  did; "customer" is correct for a buyer-written note (keeps it private). */
  notesAs?: "shipping" | "customer";
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
    paymentProofUrl: opts.proofUrl || null,
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
    courier: row.courierName ?? "",
    trackingNumber: row.trackingNumber ?? "",
    // The old `notes` column is the customer's delivery instruction. The HP GLOW
    // import carried it as the shipping note (shown on the Track page); newer
    // imports keep it as the private customer note instead.
    shippingNote: opts.notesAs === "customer" ? "" : (row.notes ?? ""),
    customerNote: opts.notesAs === "customer" ? (row.notes ?? "") : "",
    placedAt,
    updatedAt,
    imported: true,
  };
}
