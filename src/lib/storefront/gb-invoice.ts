// Group-buy invoices — pay after the round closes.
//
// With the owner's "Invoice after close" switch on (branding.config
// .groupBuyInvoice), a group-buy order is placed WITHOUT paying: the checkout
// adds one flat shipping fee per customer per round, and a customer who orders
// again in the same round adds to the same invoice with no second fee. When the
// round closes, every customer gets ONE invoice in the store chat — all their
// orders in the round, rendered from the owner's template — followed by the
// payment-option images (QR codes) the owner attached.
//
// PURE and ZERO IMPORTS on purpose: the Expo app keeps a byte-identical copy at
// mobile/src/features/admin/group-buys/invoice.ts for the editor's live
// preview, and npm run test:gb-invoice fails when the two drift. Money is
// formatted by the caller (`money`), so this file never needs the currency lib.

export type InvoicePaymentMethod = {
  id: string;
  /** "GoTyme", "UnionBank"… */
  name: string;
  /** Free text under the name, e.g. "016793762828 - Niegel Belependio". */
  details: string;
  /** Hosted https image (a QR code), sent after the invoice text. "" = none. */
  imageUrl: string;
};

export type GroupBuyInvoiceConfig = {
  /** On = group-buy orders are paid on an invoice after the round closes. */
  enabled: boolean;
  /** Flat shipping fee, charged once per customer per round. */
  shippingFee: number;
  /** The invoice message. Blank = DEFAULT_INVOICE_TEMPLATE. */
  template: string;
  paymentMethods: InvoicePaymentMethod[];
  /** Word after a quantity ("2 vials"). Blank = just the number. */
  unit: string;
  /** When the switch was last turned on (ISO). Rounds that closed BEFORE it are
   *  never invoiced automatically, so turning the feature on can't message
   *  every customer of every old round. Stamped by the server, never the app. */
  enabledAt: string | null;
};

/**
 * The payment method a pay-on-invoice order is stored with. Both what the
 * owner sees on the order ("how will this be paid?") and the marker the
 * invoice sender selects on, so an order paid the ordinary way is never billed
 * again on an invoice.
 */
export const INVOICE_PAYMENT_METHOD = "Pay on invoice (group buy)";

export const GB_INVOICE_LIMITS = {
  template: 4000,
  methods: 8,
  methodName: 60,
  methodDetails: 300,
  unit: 20,
  maxFee: 100_000,
} as const;

export const DEFAULT_INVOICE_TEMPLATE = [
  "{orderNumber}",
  "👤 Name: {name}",
  "🏠 Address: {address}",
  "💬 WhatsApp #: {phone}",
  "📞 Delivery Contact #: {phone}",
  "🚚 Mode of Delivery: {courier}",
  "💸 Shipping Fee: {shippingFee}",
  "🗓 GB Date: {gbName}",
  "",
  "📦 List of Orders",
  "{items}",
  "💵 Breakdown of Cost",
  "{breakdown}",
  "Total w/ SF: {total}",
  "📝 ORDER & PAYMENT",
  "",
  "✅ All orders received are FINAL.",
  "",
  "⚠️ Payment should be settled within 24 hours after we send the invoice.",
  "",
  "⚠️ Payment confirmation will be done within 24–48 hours after the invoice settlement schedule is completed.",
  "",
  "💳 PAYMENT OPTIONS:",
  "",
  "{paymentMethods}",
  "",
  "🙏 Thank you for prompt payments.",
  "",
  "NOTE: Send your proof of payment here in this chat.",
].join("\n");

/** Every placeholder the template understands — the editor shows these as chips. */
export const INVOICE_PLACEHOLDERS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "orderNumber", label: "Order no." },
  { key: "orderNumbers", label: "All order nos." },
  { key: "name", label: "Name" },
  { key: "address", label: "Address" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "courier", label: "Courier" },
  { key: "shippingFee", label: "Shipping fee" },
  { key: "gbName", label: "Round name" },
  { key: "gbDate", label: "Close date" },
  { key: "items", label: "Order list" },
  { key: "breakdown", label: "Breakdown" },
  { key: "subtotal", label: "Subtotal" },
  { key: "total", label: "Total" },
  { key: "paymentMethods", label: "Payment options" },
];

const DEFAULTS: GroupBuyInvoiceConfig = {
  enabled: false,
  shippingFee: 0,
  template: "",
  paymentMethods: [],
  unit: "vial",
  enabledAt: null,
};

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const oneLine = (v: unknown, max: number): string => text(v, max * 2).replace(/\s+/g, " ").trim().slice(0, max);

function fee(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.min(n, GB_INVOICE_LIMITS.maxFee) * 100) / 100;
}

/** Only hosted images reach a chat message — never an inline data URL. */
function imageUrl(v: unknown): string {
  const s = text(v, 2000);
  return /^https:\/\/\S+$/.test(s) ? s : "";
}

function method(v: unknown, i: number): InvoicePaymentMethod | null {
  if (!isRow(v)) return null;
  const name = oneLine(v.name, GB_INVOICE_LIMITS.methodName);
  const details = text(v.details, GB_INVOICE_LIMITS.methodDetails);
  const image = imageUrl(v.imageUrl);
  if (!name && !details && !image) return null;
  const id = oneLine(v.id, 40) || `pm-${i + 1}`;
  return { id, name, details, imageUrl: image };
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Untrusted JSON → a complete config. Never throws; missing = defaults (off). */
export function normalizeGroupBuyInvoice(raw: unknown): GroupBuyInvoiceConfig {
  if (!isRow(raw)) return { ...DEFAULTS, paymentMethods: [] };
  const methods = Array.isArray(raw.paymentMethods) ? raw.paymentMethods : [];
  const seen = new Set<string>();
  const paymentMethods = methods
    .map(method)
    .filter((m): m is InvoicePaymentMethod => m !== null)
    .map((m, i) => {
      const id = seen.has(m.id) ? `${m.id}-${i + 1}` : m.id;
      seen.add(id);
      return { ...m, id };
    })
    .slice(0, GB_INVOICE_LIMITS.methods);
  const template = text(raw.template, GB_INVOICE_LIMITS.template);
  return {
    enabled: raw.enabled === true,
    shippingFee: fee(raw.shippingFee),
    template: template === DEFAULT_INVOICE_TEMPLATE ? "" : template,
    paymentMethods,
    unit: typeof raw.unit === "string" ? oneLine(raw.unit, GB_INVOICE_LIMITS.unit) : DEFAULTS.unit,
    enabledAt: isoOrNull(raw.enabledAt),
  };
}

/**
 * The owner's save, merged onto what is stored: enabledAt is the server's — it
 * is stamped when the switch goes off → on and otherwise carried over, so a
 * client can never back-date it into old rounds.
 */
export function mergeGroupBuyInvoiceSave(
  stored: unknown,
  input: unknown,
  now: Date = new Date(),
): GroupBuyInvoiceConfig {
  const prev = normalizeGroupBuyInvoice(stored);
  const next = normalizeGroupBuyInvoice(input);
  const enabledAt = next.enabled ? (prev.enabled && prev.enabledAt ? prev.enabledAt : now.toISOString()) : prev.enabledAt;
  return { ...next, enabledAt };
}

/** The shipping fee a group-buy order carries: the flat fee, or 0 on an add-on. */
export function invoiceShippingFee(config: GroupBuyInvoiceConfig, isAddOn: boolean): number {
  return isAddOn ? 0 : config.shippingFee;
}

/**
 * Should a round that closed at `closedAt` be invoiced automatically? Only when
 * the switch is on and the round closed after it was turned on. The owner's
 * "Send invoices" button does not ask — that is an explicit request.
 */
export function shouldAutoInvoice(config: GroupBuyInvoiceConfig, closedAt: string | null): boolean {
  if (!config.enabled || !config.enabledAt || !closedAt) return false;
  const closed = Date.parse(closedAt);
  return Number.isFinite(closed) && closed >= Date.parse(config.enabledAt);
}

// ── Rendering ────────────────────────────────────────────────────────────────

export type InvoiceFee = { label: string; amount: number };

export type InvoiceOrder = {
  id: string;
  orderNumber: string;
  placedAt: string;
  customer: { name: string; phone: string; email: string };
  shipping: { address: string; barangay: string; city: string; province: string; postal: string; fee: number };
  courier: string;
  items: ReadonlyArray<{ name: string; qty: number; price: number }>;
  adminFee: InvoiceFee | null;
  paymentFee: InvoiceFee | null;
  discount: (InvoiceFee & { code: string }) | null;
};

export type GroupBuyInvoice = {
  text: string;
  /** Payment-option images, in the owner's order, sent after the text. */
  images: string[];
  /** The first order's number — the invoice's own number. */
  orderNumber: string;
  orderIds: string[];
  shippingFee: number;
  total: number;
};

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Fill `{key}` placeholders. A line whose placeholders ALL came out empty is
 * dropped (no "📞 Delivery Contact #: " with nothing after it); unknown keys
 * are left as typed so a typo is visible in the preview rather than vanishing.
 */
export function renderInvoiceTemplate(template: string, values: Readonly<Record<string, string>>): string {
  const out: string[] = [];
  for (const line of template.split("\n")) {
    const keys = [...line.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((k) => k in values);
    if (keys.length > 0 && keys.every((k) => !values[k].trim())) continue;
    out.push(line.replace(PLACEHOLDER, (whole, k: string) => (k in values ? values[k] : whole)));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** "MICABLEND 2.0 - … (TMB 2.0)" → "TMB 2.0": the short code in a trailing (…), else the name. */
export function invoiceShortName(name: string): string {
  const m = /\(([^()]{1,40})\)\s*$/.exec(name.trim());
  return m ? m[1].trim() : name.trim();
}

function units(qty: number, unit: string): string {
  if (!unit) return String(qty);
  const plural = qty === 1 || /s$/i.test(unit) ? unit : `${unit}s`;
  return `${qty} ${plural}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function joinAddress(s: InvoiceOrder["shipping"]): string {
  return [s.address, s.barangay, s.city, s.province, s.postal]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(", ");
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function paymentText(methods: readonly InvoicePaymentMethod[]): string {
  return methods
    .map((m) => [m.name ? `🏦 ${m.name}` : "", m.details].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");
}

/**
 * One customer's invoice for one round: every order they placed in it, lines
 * merged by product, ONE shipping fee. The fee is the largest any of their
 * orders carried (so two racing first checkouts can't double it), falling back
 * to the configured fee when none carried one (the fee-bearing order was
 * cancelled, leaving only add-ons).
 */
export function buildGroupBuyInvoice(input: {
  orders: readonly InvoiceOrder[];
  roundName: string;
  closedAt: string | null;
  config: GroupBuyInvoiceConfig;
  money: (amount: number) => string;
}): GroupBuyInvoice | null {
  const orders = [...input.orders].sort((a, b) => a.placedAt.localeCompare(b.placedAt));
  if (orders.length === 0) return null;
  const { config, money } = input;
  const latest = orders[orders.length - 1];

  const lines = new Map<string, { name: string; qty: number; amount: number }>();
  for (const o of orders) {
    for (const it of o.items) {
      const name = it.name.trim();
      const qty = Math.max(0, Math.floor(it.qty || 0));
      if (!name || qty === 0) continue;
      const cur = lines.get(name) ?? { name, qty: 0, amount: 0 };
      lines.set(name, { name, qty: cur.qty + qty, amount: round2(cur.amount + qty * (it.price || 0)) });
    }
  }
  const merged = [...lines.values()];
  const subtotal = round2(merged.reduce((s, l) => s + l.amount, 0));

  const extras: { label: string; amount: number }[] = [];
  const sumFee = (pick: (o: InvoiceOrder) => InvoiceFee | null, fallback: string) => {
    const amount = round2(orders.reduce((s, o) => s + (pick(o)?.amount || 0), 0));
    const label = orders.map((o) => pick(o)?.label.trim()).find(Boolean) || fallback;
    if (amount > 0) extras.push({ label, amount });
    return amount;
  };
  const adminFee = sumFee((o) => o.adminFee, "Admin fee");
  const paymentFee = sumFee((o) => o.paymentFee, "Payment fee");
  const discount = round2(orders.reduce((s, o) => s + (o.discount?.amount || 0), 0));

  const carried = Math.max(0, ...orders.map((o) => o.shipping.fee || 0));
  const shippingFee = carried > 0 ? carried : config.shippingFee;
  const total = round2(Math.max(0, subtotal + adminFee + paymentFee - discount) + shippingFee);

  const breakdown = [
    ...merged.map((l) => `${invoiceShortName(l.name)} - ${units(l.qty, config.unit)} = ${money(l.amount)}`),
    ...extras.map((e) => `${e.label} = ${money(e.amount)}`),
    ...(discount > 0 ? [`Discount = -${money(discount)}`] : []),
  ].join("\n");

  const values: Record<string, string> = {
    orderNumber: orders[0].orderNumber,
    orderNumbers: orders.map((o) => o.orderNumber).join(", "),
    name: latest.customer.name.trim(),
    address: joinAddress(latest.shipping),
    phone: latest.customer.phone.trim(),
    email: latest.customer.email.trim(),
    courier: latest.courier.trim(),
    shippingFee: money(shippingFee),
    gbName: input.roundName.trim(),
    gbDate: shortDate(input.closedAt),
    items: merged.map((l) => `${l.name} - ${units(l.qty, config.unit)}`).join("\n"),
    breakdown,
    subtotal: money(subtotal),
    total: money(total),
    paymentMethods: paymentText(config.paymentMethods),
  };

  return {
    text: renderInvoiceTemplate(config.template || DEFAULT_INVOICE_TEMPLATE, values),
    images: config.paymentMethods.map((m) => m.imageUrl).filter(Boolean),
    orderNumber: orders[0].orderNumber,
    orderIds: orders.map((o) => o.id),
    shippingFee,
    total,
  };
}

// ── Chat idempotency ─────────────────────────────────────────────────────────
// The invoice rides the order bot's message shape (kind "order", authorKey
// "bot"), so its clientId keeps the bot's `bot:order:<orderId>:` prefix — the
// chat then links "View order" to the invoice's first order for free. The
// `inv:<round>` segment marks it as this round's invoice; the trailing content
// hash makes an identical re-send a no-op while an edited invoice goes out anew.

export function fnv32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The `bot:order:<firstOrderId>:inv:<round>:` prefix every send of this invoice shares. */
export function invoiceClientPrefix(firstOrderId: string, groupBuyId: string): string {
  return `bot:order:${firstOrderId}:inv:${fnv32(groupBuyId)}:`;
}

export function invoiceClientId(firstOrderId: string, groupBuyId: string, invoiceText: string): string {
  return `${invoiceClientPrefix(firstOrderId, groupBuyId)}${fnv32(invoiceText)}`;
}

export function invoiceImageClientId(textClientId: string, index: number): string {
  return `bot:inv-img:${fnv32(textClientId)}:${index}`;
}
