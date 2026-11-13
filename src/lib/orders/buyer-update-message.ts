// The message the store sends the buyer when an order moves — one per status.
//
// Generated, not stored: the admin sees it pre-written for the order's current
// status, can tweak it, and sends it on the chat the buyer reached them on
// (see buyer-contact.ts). A shipped order always carries the courier and the
// tracking number, because that is the one thing every buyer asks for.
//
// Pure (npm run test:buyer-contact). Used by the website admin (client) and the
// app's order endpoint (server), so both say exactly the same thing.

import type { OrderStatus } from "../../storefront/types";

export type BuyerUpdateFacts = {
  status: OrderStatus | string;
  orderNumber: string;
  buyerName: string;
  storeName: string;
  courier: string;
  trackingNumber: string;
};

/** "Maria Santos" → "Maria"; blank → "there" ("Hi there!"). */
export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first || "there";
}

function shippedLines(courier: string, tracking: string): string[] {
  if (!tracking) {
    return [
      courier ? `It's been handed to ${courier}.` : "",
      "We'll send you the tracking number as soon as we have it.",
    ];
  }
  return [
    "",
    courier ? `Courier: ${courier}` : "",
    `Tracking number: ${tracking}`,
    "",
    "You can follow your parcel with this tracking number on the courier's website or app.",
  ];
}

type Lines = (f: BuyerUpdateFacts, hi: string, order: string) => string[];

const BODY: Record<OrderStatus, Lines> = {
  new: (f, hi, order) => [
    `${hi} 👋 Thank you for ordering from ${f.storeName}!`,
    `We've received your order ${order} and will confirm it shortly.`,
  ],
  confirmed: (_f, hi, order) => [
    `${hi} ✅ Your order ${order} is confirmed.`,
    "We'll let you know as soon as it's on its way.",
  ],
  processing: (_f, hi, order) => [
    `${hi} 📦 We're now preparing your order ${order}.`,
    "We'll update you once it ships.",
  ],
  ready: (_f, hi, order) => [
    `${hi} 📦 Your order ${order} is packed and ready.`,
    "It will be handed to the courier soon.",
  ],
  shipped: (f, hi, order) => [
    `${hi} 🚚 Good news — your order ${order} has been shipped!`,
    ...shippedLines(f.courier.trim(), f.trackingNumber.trim()),
  ],
  delivered: (f, hi, order) => [
    `${hi} 🎉 Your order ${order} has been delivered.`,
    `Thank you for shopping with ${f.storeName}! We'd love to hear how you like it.`,
  ],
  cancelled: (_f, hi, order) => [
    `${hi} Your order ${order} has been cancelled.`,
    "If you have any questions, or if this was a mistake, just reply to this message.",
  ],
};

/** The ready-to-send update for the order's CURRENT status. */
export function buildBuyerUpdateMessage(f: BuyerUpdateFacts): string {
  const hi = `Hi ${firstName(f.buyerName)}!`;
  const num = f.orderNumber.trim().replace(/^#/, "");
  const order = num ? `#${num}` : "";
  const store = f.storeName.trim();
  const build = BODY[f.status as OrderStatus] ?? BODY.new;
  const lines = build({ ...f, storeName: store || "our store" }, hi, order);
  const signOff = store ? ["", `— ${store}`] : [];
  return [...lines, ...signOff]
    .map((l) => l.replace(/ {2,}/g, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
