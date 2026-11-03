// Self-contained test gate for "Live now" (src/lib/presence/live.ts). Pure — no DB.
//
//   npm run test:live-presence

import {
  buildLiveSnapshot,
  FEED_LIMIT,
  LIVE_WINDOW_MS,
  parsePresenceBeat,
  placeLabel,
  readGeo,
  webStage,
  type PresenceRow,
} from "../src/lib/presence/live";

let checks = 0;
let failures = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── parsePresenceBeat ───────────────────────────────────────────────────────
const good = parsePresenceBeat(
  { visitorId: "abcDEF12_-x", stage: "product", productRef: " bpc-157 ", cartItems: 2.7, cartValue: 3400, currency: "PHP" },
  { requireVisitorId: true },
);
ok("valid beat parses", good !== null && good.stage === "product" && good.productRef === "bpc-157");
ok("cart items floored", good?.cartItems === 2);
ok("currency kept", good?.currency === "PHP");
ok("non-object rejected", parsePresenceBeat("x", { requireVisitorId: false }) === null);
ok("array rejected", parsePresenceBeat([], { requireVisitorId: false }) === null);
ok("web needs a visitor id", parsePresenceBeat({ stage: "cart" }, { requireVisitorId: true }) === null);
ok("short visitor id rejected", parsePresenceBeat({ visitorId: "abc" }, { requireVisitorId: true }) === null);
ok("odd visitor id rejected", parsePresenceBeat({ visitorId: "abc def ghi<>" }, { requireVisitorId: true }) === null);
ok("app needs none", parsePresenceBeat({ stage: "cart" }, { requireVisitorId: false })?.stage === "cart");
ok("unknown stage → browsing", parsePresenceBeat({ stage: "hacking" }, { requireVisitorId: false })?.stage === "browsing");
ok("product ref dropped off the product stage", parsePresenceBeat({ stage: "cart", productRef: "x" }, { requireVisitorId: false })?.productRef === null);
ok("negative items → 0", parsePresenceBeat({ cartItems: -5 }, { requireVisitorId: false })?.cartItems === 0);
ok("huge items capped", parsePresenceBeat({ cartItems: 1e9 }, { requireVisitorId: false })?.cartItems === 999);
ok("NaN value → 0", parsePresenceBeat({ cartValue: Number.NaN }, { requireVisitorId: false })?.cartValue === 0);
ok("string value → 0", parsePresenceBeat({ cartValue: "500" }, { requireVisitorId: false })?.cartValue === 0);
ok("bad currency → null", parsePresenceBeat({ currency: "php" }, { requireVisitorId: false })?.currency === null);
ok("leave only when true", parsePresenceBeat({ leave: "yes" }, { requireVisitorId: false })?.leave === false);
ok("leave true", parsePresenceBeat({ leave: true }, { requireVisitorId: false })?.leave === true);
ok("long ref truncated", (parsePresenceBeat({ stage: "product", productRef: "x".repeat(500) }, { requireVisitorId: false })?.productRef ?? "").length === 120);

// ── readGeo / placeLabel ────────────────────────────────────────────────────
const headers: Record<string, string> = {
  "x-vercel-ip-city": "Quezon%20City",
  "x-vercel-ip-country-region": "00",
  "x-vercel-ip-country": "ph",
};
const geo = readGeo((n) => headers[n] ?? null);
ok("city decoded", geo.city === "Quezon City", String(geo.city));
ok("country upper-cased", geo.country === "PH");
ok("no headers → nulls", JSON.stringify(readGeo(() => null)) === JSON.stringify({ city: null, region: null, country: null }));
ok("bad escape kept raw", readGeo((n) => (n === "x-vercel-ip-city" ? "Davao%E0" : null)).city === "Davao%E0");
ok("control chars stripped", readGeo((n) => (n === "x-vercel-ip-city" ? "Ce\u0007bu" : null)).city === "Cebu");
ok("junk country dropped", readGeo((n) => (n === "x-vercel-ip-country" ? "PHL" : null)).country === null);
ok("label prefers city", placeLabel(geo) === "Quezon City");
ok("label falls back to country name", placeLabel({ city: null, region: null, country: "PH" }) === "Philippines");
ok("label null when unknown", placeLabel({ city: null, region: null, country: null }) === null);

// ── webStage ────────────────────────────────────────────────────────────────
ok("browsing", webStage({ cartOpen: false, checkoutStep: "cart", productOpen: false }) === "browsing");
ok("product", webStage({ cartOpen: false, checkoutStep: "cart", productOpen: true }) === "product");
ok("cart beats product", webStage({ cartOpen: true, checkoutStep: "cart", productOpen: true }) === "cart");
ok("details = checkout", webStage({ cartOpen: true, checkoutStep: "details", productOpen: false }) === "checkout");
ok("payment = checkout", webStage({ cartOpen: true, checkoutStep: "payment", productOpen: false }) === "checkout");
ok("closed drawer is not checkout", webStage({ cartOpen: false, checkoutStep: "payment", productOpen: false }) === "browsing");

// ── buildLiveSnapshot ───────────────────────────────────────────────────────
const now = new Date("2026-10-30T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const row = (id: string, over: Partial<PresenceRow> = {}): PresenceRow => ({
  id,
  surface: "web",
  stage: "browsing",
  productRef: null,
  cartItems: 0,
  cartValue: 0,
  currency: null,
  customerId: null,
  city: "Davao City",
  region: null,
  country: "PH",
  firstSeenAt: ago(300_000),
  lastSeenAt: ago(5_000),
  ...over,
});
const lookups = {
  productName: (ref: string) => (ref === "bpc" ? "BPC-157 10mg" : null),
  customerName: (id: string) => (id === "c1" ? "Maria Santos" : null),
  money: (v: number) => `₱${v}`,
};
const snap = buildLiveSnapshot({
  rows: [
    row("browse"),
    row("stale", { lastSeenAt: ago(LIVE_WINDOW_MS + 1_000) }),
    row("prod", { stage: "product", productRef: "bpc", city: "Cebu City" }),
    row("pay", { stage: "checkout", surface: "app", customerId: "c1", cartItems: 3, cartValue: 3400, lastSeenAt: ago(20_000) }),
    row("cart", { stage: "cart", cartItems: 1, city: null, country: null }),
    row("bogus", { stage: "weird", surface: "fax" }),
  ],
  last24h: 2,
  now,
  lookups,
});
ok("stale visitor dropped", snap.total === 5, String(snap.total));
ok("surface split", snap.web === 4 && snap.app === 1, `${snap.web}/${snap.app}`);
ok("stage counts", snap.stages.checkout === 1 && snap.stages.cart === 1 && snap.stages.product === 1 && snap.stages.browsing === 2);
ok("checkout first", snap.visitors[0]?.id === "pay");
ok("then cart, then product", snap.visitors[1]?.id === "cart" && snap.visitors[2]?.id === "prod");
ok("app customer named", snap.visitors[0]?.who === "Maria Santos");
ok("website visitor anonymous", snap.visitors.find((v) => v.id === "browse")?.who === null);
ok("product named", snap.visitors.find((v) => v.id === "prod")?.productName === "BPC-157 10mg");
ok("cart label", snap.visitors[0]?.cartLabel === "₱3400");
ok("no value → no label", snap.visitors.find((v) => v.id === "cart")?.cartLabel === null);
ok("unknown place null", snap.visitors.find((v) => v.id === "cart")?.place === null);
ok("seconds since seen", snap.visitors[0]?.lastSeenSecs === 20);
ok("seconds on site", snap.visitors[0]?.onSiteSecs === 300);
ok("unknown stage/surface normalised", snap.visitors.find((v) => v.id === "bogus")?.stage === "browsing" && snap.visitors.find((v) => v.id === "bogus")?.surface === "web");
ok("places ranked", snap.places[0]?.name === "Davao City" && snap.places[0]?.value === 3, JSON.stringify(snap.places[0]));
ok("places skip unknown", snap.places.every((p) => p.name));
ok("24h never below live", snap.last24h === 5);
ok("asOf iso", snap.asOf === now.toISOString());

const crowd = buildLiveSnapshot({
  rows: Array.from({ length: FEED_LIMIT + 7 }, (_, i) => row(`v${i}`)),
  last24h: 100,
  now,
  lookups,
});
ok("feed capped", crowd.visitors.length === FEED_LIMIT && crowd.more === 7);
ok("24h count kept", crowd.last24h === 100);
const none = buildLiveSnapshot({ rows: [], last24h: 0, now, lookups });
ok("empty store", none.total === 0 && none.visitors.length === 0 && none.places.length === 0 && none.more === 0);

if (failures > 0) {
  console.error(`\n${failures}/${checks} live-presence checks failed`);
  process.exit(1);
}
console.log(`✓ live-presence: ${checks} checks passed`);
