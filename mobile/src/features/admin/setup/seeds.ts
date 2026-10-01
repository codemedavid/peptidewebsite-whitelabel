import type { Row } from "./rules";

/**
 * The website admin's starter lists (src/storefront/data.ts SEED_*). A store
 * that has never saved a collection has NO key in branding.config, and the web
 * editor shows these defaults until the first save — so the app does the same,
 * and the owner's first edit here writes exactly what the web's would.
 */

export const SEED_PAYMENT_METHODS: Row[] = [
  { id: "pm1", name: "GCash", account: "Peptide Pulse", number: "", qrImage: "", order: 1, active: true },
  { id: "pm2", name: "BDO", account: "Peptide Pulse", number: "", qrImage: "", order: 2, active: true },
  { id: "pm3", name: "Security Bank", account: "Peptide Pulse", number: "", qrImage: "", order: 3, active: true },
  { id: "pm4", name: "Maya", account: "Britt Marie Angelica Arellano", number: "09179966191", qrImage: "", order: 4, active: true },
];

export const SEED_COURIERS: Row[] = [
  { id: "c1", name: "LBC Express", trackingUrl: "", active: true },
  { id: "c2", name: "J&T Express", trackingUrl: "", active: true },
  { id: "c3", name: "Flash Express", trackingUrl: "", active: true },
  { id: "c4", name: "Ninja Van", trackingUrl: "", active: true },
  { id: "c5", name: "JRS Express", trackingUrl: "", active: true },
  { id: "c6", name: "Grab Express", trackingUrl: "", active: true },
];

export const SEED_SHIPPING_LOCATIONS: Row[] = [
  { id: "s1", courierId: "c1", code: "LBC_METRO_MANILA", name: "Metro Manila", price: 150, active: true },
  { id: "s2", courierId: "c1", code: "LBC_LUZON", name: "Luzon (Provincial)", price: 200, active: true },
  { id: "s3", courierId: "c1", code: "LBC_VISMIN", name: "Visayas & Mindanao", price: 250, active: true },
  { id: "s4", courierId: "c2", code: "JNT_METRO_MANILA", name: "Metro Manila", price: 120, active: true },
  { id: "s5", courierId: "c2", code: "JNT_LUZON", name: "Luzon (Provincial)", price: 180, active: true },
  { id: "s6", courierId: "c2", code: "JNT_VISMIN", name: "Visayas & Mindanao", price: 230, active: true },
];

export const SEED_PROMO_CODES: Row[] = [
  { id: "pc1", code: "6VO", type: "fixed", value: 600, minPurchase: 0, usageLimit: null, used: 1, expiry: null, active: true },
  { id: "pc2", code: "2VO", type: "fixed", value: 400, minPurchase: 0, usageLimit: null, used: 1, expiry: null, active: true },
  { id: "pc3", code: "ROSIE", type: "fixed", value: 1400, minPurchase: 0, usageLimit: null, used: 1, expiry: "2026-05-17", active: true },
  { id: "pc4", code: "CHARMAINE BONGARES", type: "fixed", value: 900, minPurchase: 0, usageLimit: null, used: 0, expiry: null, active: true },
];
