// PostHog event catalog + payload builders (PURE — no IO, no SDK).
//
// These turn a storefront Order into the exact shape we hand to posthog-node:
// an event name, a stable distinctId, event `properties`, and `personProperties`
// (PostHog's `$set`) so the buyer becomes an IDENTIFIED person carrying an email —
// which is what PostHog Messaging targets when it sends checkout/delivery emails.
//
// Kept side-effect-free so it's unit-testable (scripts/test-posthog.ts) and so
// the capture layer can decide gating/flush separately from payload shape.

import type { Order } from "@/storefront/types";
import { instagramDmUrl } from "@/lib/storefront/contact-channels";

export const POSTHOG_EVENTS = {
  ORDER_PLACED: "order_placed",
  ORDER_STATUS_CHANGED: "order_status_changed",
  // Admin-targeted "you received an order" alert. Same checkout moment as
  // ORDER_PLACED, but the PERSON is the store owner (see buildAdminOrderPayload),
  // so the tenant's PostHog Messaging workflow emails the ADMIN, not the buyer.
  ORDER_PLACED_ADMIN: "admin_order_placed",
} as const;

export type PostHogEventName = (typeof POSTHOG_EVENTS)[keyof typeof POSTHOG_EVENTS];

/** The vendor-neutral payload the capture layer forwards to posthog-node. */
export interface CapturePayload {
  event: PostHogEventName;
  distinctId: string;
  properties: Record<string, unknown>;
  /** Mapped to PostHog `$set` so the person profile carries email/name/phone. */
  personProperties?: Record<string, unknown>;
}

/**
 * Tenant branding stamped onto every capture so PostHog Messaging templates can
 * render the store's own name/logo/colors via Liquid ({{ event.properties.brandName }})
 * — one generic email template then serves every tenant. Only keys the tenant
 * actually configured are present, so templates can `| default:` the rest.
 */
export interface EmailBrand {
  brandName?: string;
  brandLogoUrl?: string;
  /** The storefront CTA color — used for email buttons/badges. */
  brandAccent?: string;
  /** Text color that sits on brandAccent (the storefront's buttonText). */
  brandAccentText?: string;
  brandCurrency?: string;
  /** Absolute storefront origin, e.g. https://shop.jonina.store (no trailing slash). */
  storeUrl?: string;
  /** Where "Questions?" in emails points: the tenant's first enabled contact
   *  channel (WhatsApp/Telegram/Messenger/email), else the storefront itself. */
  supportUrl?: string;
  /** Human name for that channel ("WhatsApp", "email", "our website"). */
  supportLabel?: string;
}

function strOf(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * The tenant's support link for email footers — the first enabled
 * branding.config.contactChannels entry that yields a link Gmail will honor
 * (https/mailto; viber:// is skipped because Gmail strips custom schemes).
 * URL rules mirror the storefront's checkout hand-off (storefront/checkout.ts
 * channelUrl), minus the prefilled message.
 */
function supportLink(
  channels: unknown,
): { supportUrl: string; supportLabel: string } | undefined {
  if (!Array.isArray(channels)) return undefined;
  for (const c of channels as Array<Record<string, unknown>>) {
    if (!c || c.enabled !== true) continue;
    const dest = strOf(c.destination);
    if (!dest) continue;
    switch (c.type) {
      case "whatsapp":
        return { supportUrl: `https://wa.me/${dest.replace(/[^\d]/g, "")}`, supportLabel: "WhatsApp" };
      case "telegram": {
        const handle = dest.replace(/^@/, "");
        const url = /^\+?[\d\s().-]+$/.test(handle)
          ? `https://t.me/+${handle.replace(/[^\d]/g, "")}`
          : `https://t.me/${handle}`;
        return { supportUrl: url, supportLabel: "Telegram" };
      }
      case "messenger":
        return { supportUrl: `https://m.me/${dest.replace(/^@/, "")}`, supportLabel: "Messenger" };
      case "instagram":
        return { supportUrl: instagramDmUrl(dest), supportLabel: "Instagram" };
      case "gmail":
        return { supportUrl: `mailto:${dest}`, supportLabel: "email" };
      default:
        continue; // viber (no https link) or unknown → try the next channel
    }
  }
  return undefined;
}

/**
 * Extract the email-relevant slice of a tenant's branding.config (a Partial<Brand>).
 * Pure — callers derive storeUrl (slug + root domain) themselves. Returns
 * undefined when there is nothing brandable at all, so payload builders can
 * skip the merge entirely.
 */
export function buildEmailBrand(
  config: Record<string, unknown>,
  storeUrl?: string,
): EmailBrand | undefined {
  const brand: EmailBrand = {};
  const name = strOf(config.name);
  if (name) brand.brandName = name;
  const logo = strOf(config.logoUrl);
  if (logo) brand.brandLogoUrl = logo;
  // The storefront renders CTAs with `button`; fall back through the palette so
  // an older config still yields a usable accent.
  const accent = strOf(config.button) || strOf(config.accent) || strOf(config.main);
  if (accent) brand.brandAccent = accent;
  const accentText = strOf(config.buttonText);
  if (accentText) brand.brandAccentText = accentText;
  const currency = strOf(config.currency);
  if (currency) brand.brandCurrency = currency;
  const url = strOf(storeUrl);
  if (url) brand.storeUrl = url.replace(/\/+$/, "");
  // Support link: first usable contact channel, else the storefront itself so
  // "Questions?" always lands somewhere the tenant actually answers.
  const support = supportLink(config.contactChannels);
  if (support) {
    brand.supportUrl = support.supportUrl;
    brand.supportLabel = support.supportLabel;
  } else if (brand.storeUrl) {
    brand.supportUrl = brand.storeUrl;
    brand.supportLabel = "our website";
  }
  return Object.keys(brand).length ? brand : undefined;
}

/** The buyer's email, trimmed + lowercased ("" when none was given). */
function emailOf(order: Order): string {
  return (order.customer?.email ?? "").trim().toLowerCase();
}

/**
 * A pragmatic email check: one local part, one @, and a dotted domain with a
 * ≥2-char TLD (so "a@b" and "owner@" are rejected). Deliberately not RFC-5322
 * exhaustive — it guards against typos/blanks, the real proof is the admin
 * receiving the test alert.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isValidEmail(value: unknown): boolean {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

/**
 * The admin's order-notification recipient, read from
 * `branding.config.orderNotifications = { enabled, email }`. Returns the trimmed
 * address (case preserved for display) ONLY when the toggle is on AND the email
 * is valid; otherwise null so the notify orchestrator cleanly no-ops. Defensive
 * against any shape — the config blob is untrusted JSON.
 */
export function resolveAdminNotifyEmail(config: Record<string, unknown>): string | null {
  const slice = (config?.orderNotifications ?? null) as Record<string, unknown> | null;
  if (!slice || typeof slice !== "object") return null;
  if (slice.enabled !== true) return null;
  const email = typeof slice.email === "string" ? slice.email.trim() : "";
  return isValidEmail(email) ? email : null;
}

/**
 * The PostHog distinctId for this order's buyer. Prefer the email (so the same
 * person is recognised across orders and is reachable by PostHog Messaging),
 * then the order number, then the draft id — never empty (PostHog requires one).
 */
export function resolveDistinctId(order: Order): string {
  const email = emailOf(order);
  if (email) return email;
  const number = (order.orderNumber ?? "").trim();
  if (number) return number;
  return order.id;
}

/** Order grand total, mirroring every storefront total surface:
 *  items subtotal + shipping fee + admin fee − discount, clamped at zero. */
export function orderTotal(order: Order): number {
  const subtotal = (order.items ?? []).reduce((s, it) => s + (it.price || 0) * (it.qty || 0), 0);
  const shipping = order.shipping?.fee ?? 0;
  const fee = order.adminFee?.amount ?? 0;
  const discount = order.discount?.amount ?? 0;
  return Math.max(0, subtotal + shipping + fee - discount);
}

/**
 * PostHog `$set` person properties — only the keys the buyer actually provided,
 * so we never overwrite a known email/name with a blank. Returns undefined when
 * the buyer is fully anonymous (nothing to identify).
 */
function personProps(order: Order): Record<string, unknown> | undefined {
  const email = emailOf(order);
  const name = (order.customer?.name ?? "").trim();
  const phone = (order.customer?.phone ?? "").trim();
  const set: Record<string, unknown> = {};
  if (email) set.email = email;
  if (name) set.name = name;
  if (phone) set.phone = phone;
  return Object.keys(set).length ? set : undefined;
}

/** `order_placed` — the authoritative checkout event PostHog workflows trigger on. */
export function buildOrderPlacedPayload(order: Order, brand?: EmailBrand): CapturePayload {
  const items = order.items ?? [];
  return {
    event: POSTHOG_EVENTS.ORDER_PLACED,
    distinctId: resolveDistinctId(order),
    properties: {
      ...brand,
      orderNumber: order.orderNumber ?? order.id,
      total: orderTotal(order),
      itemsCount: items.reduce((s, it) => s + (it.qty || 0), 0),
      itemNames: items.map((it) => it.name),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      shippingFee: order.shipping?.fee ?? 0,
      adminFee: order.adminFee?.amount ?? 0,
      discountCode: order.discount?.code ?? null,
      discountAmount: order.discount?.amount ?? 0,
      courier: order.courier,
      city: order.shipping?.city ?? "",
      province: order.shipping?.province ?? "",
      groupBuyName: order.groupBuyName ?? null,
    },
    personProperties: personProps(order),
  };
}

/**
 * `admin_order_placed` — the store owner's "you received an order" alert.
 *
 * Critically, the PERSON here is the ADMIN, not the buyer: distinctId and the
 * `$set` email are the admin's own address, so the tenant's PostHog Messaging
 * workflow delivers the email to the store owner. The buyer's details ride in
 * event `properties` (buyerName/buyerEmail) purely so the admin can read who
 * ordered — they never identify the messaged person. `adminEmail` is trimmed +
 * lowercased to match the buyer distinctId convention (stable person key).
 */
export function buildAdminOrderPayload(
  order: Order,
  brand: EmailBrand | undefined,
  adminEmail: string,
): CapturePayload {
  const admin = (adminEmail ?? "").trim().toLowerCase();
  const items = order.items ?? [];
  const buyerName = (order.customer?.name ?? "").trim();
  const buyerEmail = emailOf(order);
  return {
    event: POSTHOG_EVENTS.ORDER_PLACED_ADMIN,
    distinctId: admin,
    properties: {
      ...brand,
      orderNumber: order.orderNumber ?? order.id,
      total: orderTotal(order),
      itemsCount: items.reduce((s, it) => s + (it.qty || 0), 0),
      itemNames: items.map((it) => it.name),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      shippingFee: order.shipping?.fee ?? 0,
      adminFee: order.adminFee?.amount ?? 0,
      discountCode: order.discount?.code ?? null,
      discountAmount: order.discount?.amount ?? 0,
      courier: order.courier,
      city: order.shipping?.city ?? "",
      province: order.shipping?.province ?? "",
      groupBuyName: order.groupBuyName ?? null,
      // Buyer identity for the admin to READ — never $set as the person.
      buyerName,
      buyerEmail,
    },
    // $set the ADMIN as the person so Messaging can reach the store owner.
    personProperties: { email: admin },
  };
}

/** `order_status_changed` — fired on every fulfillment transition; PostHog
 *  workflows branch on `toStatus` (e.g. shipped/delivered) to send the email. */
export function buildStatusChangedPayload(
  order: Order,
  fromStatus: string,
  toStatus: string,
  brand?: EmailBrand,
): CapturePayload {
  return {
    event: POSTHOG_EVENTS.ORDER_STATUS_CHANGED,
    distinctId: resolveDistinctId(order),
    properties: {
      ...brand,
      orderNumber: order.orderNumber ?? order.id,
      fromStatus,
      toStatus,
      courier: order.courier,
      trackingNumber: order.trackingNumber,
    },
    personProperties: personProps(order),
  };
}

/**
 * A representative TEST order for the super-admin "send sample events" tool. It
 * feeds the SAME payload builders as real checkout, so a one-click test exercises
 * exactly what production emits. The given email (optional) becomes the person's
 * email so PostHog Messaging routes the test workflow emails somewhere checkable.
 */
export function buildSampleOrder(email?: string): Order {
  const e = (email ?? "").trim();
  return {
    id: "sample-order",
    orderNumber: "TEST-0001",
    status: "new",
    paymentStatus: "paid",
    paymentMethod: "Test payment",
    date: new Date().toISOString(),
    customer: { name: "Test Customer", email: e, phone: "", contactMethod: "" },
    shipping: {
      address: "123 Sample St",
      barangay: "",
      city: "Sampleville",
      province: "Test Province",
      postal: "",
      country: "",
      region: "",
      fee: 50,
    },
    courier: "Test Courier",
    trackingNumber: "TEST-TRACK-0001",
    shippingNote: "",
    items: [
      { name: "Sample Product A", qty: 1, price: 100 },
      { name: "Sample Product B", qty: 2, price: 75 },
    ],
    statusHistory: [],
    paymentProof: null,
  };
}
