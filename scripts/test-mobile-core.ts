/**
 * Pure-core gate for the Pepweb Admin mobile API (src/lib/mobile/*). Runs the
 * REAL modules with no DB, no Next runtime and no network:
 *
 *   - store-identifier: what an admin types to reach their store → a host
 *   - tokens:          opaque token minting, hashing, credential stamps, bearer parsing
 *   - session-rules:   access/refresh validity + refresh-replay detection
 *   - theme:           website branding → mobile tokens (contrast-safe, versioned)
 *   - order-view:      the order list/detail view model and the next-action rules
 *   - push-message:    lock-screen-safe copy + Expo ticket triage
 *
 *   npm run test:mobile-core
 */
import assert from "node:assert";

import { normalizeStoreIdentifier } from "../src/lib/mobile/store-identifier";
import { MOBILE_APP_SCHEME, storeAppLink, storeDeepLink } from "../src/lib/mobile/store-link";
import { storeFromInput, storeFromUrl } from "../mobile/src/store-link/parse";
import {
  mintOpaqueToken,
  hashToken,
  credentialStamp,
  parseBearer,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from "../src/lib/mobile/tokens";
import { checkAccess, checkRefresh, type SessionRow } from "../src/lib/mobile/session-rules";
import { buildMobileTheme, contrastRatio, DEFAULT_MOBILE_THEME } from "../src/lib/mobile/theme";
import { THEME_PRESETS } from "../src/lib/theme/presets";
import { brandPaletteFromBranding } from "../src/lib/theme/resolve-css-vars";
import {
  toOrderSummary,
  toOrderDetail,
  nextActionFor,
  paymentView,
  statusMovesStock,
  ORDER_FILTERS,
  statusesForFilter,
  queueCountsFrom,
} from "../src/lib/mobile/order-view";
import { buildNewOrderPush, triageExpoTicket } from "../src/lib/mobile/push-message";
import type { Order } from "../src/storefront/types";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}
function section(t: string) {
  console.log(`\n${t}`);
}

const ROOT = "pepweb.store";

// ── store identifier ─────────────────────────────────────────────────────────
section("store-identifier");
test("bare slug → platform subdomain", () => {
  assert.equal(normalizeStoreIdentifier("hpglow", ROOT), "hpglow.pepweb.store");
});
test("case + whitespace are normalised", () => {
  assert.equal(normalizeStoreIdentifier("  HPGlow  ", ROOT), "hpglow.pepweb.store");
});
test("full platform host kept", () => {
  assert.equal(normalizeStoreIdentifier("hpglow.pepweb.store", ROOT), "hpglow.pepweb.store");
});
test("pasted URL with scheme, path and #admin → host", () => {
  assert.equal(
    normalizeStoreIdentifier("https://HPGlow.pepweb.store/#admin", ROOT),
    "hpglow.pepweb.store",
  );
});
test("custom domain kept as-is (www stripped)", () => {
  assert.equal(normalizeStoreIdentifier("www.shop-example.com", ROOT), "shop-example.com");
  assert.equal(normalizeStoreIdentifier("shop-example.com/", ROOT), "shop-example.com");
});
test("blank, junk and injection-ish input → null", () => {
  assert.equal(normalizeStoreIdentifier("", ROOT), null);
  assert.equal(normalizeStoreIdentifier("   ", ROOT), null);
  assert.equal(normalizeStoreIdentifier("a b", ROOT), null);
  assert.equal(normalizeStoreIdentifier("hp'glow", ROOT), null);
  assert.equal(normalizeStoreIdentifier(undefined, ROOT), null);
  assert.equal(normalizeStoreIdentifier("x".repeat(300), ROOT), null);
});
test("reserved platform labels never resolve to a store", () => {
  assert.equal(normalizeStoreIdentifier("app", ROOT), null);
  assert.equal(normalizeStoreIdentifier("admin.pepweb.store", ROOT), null);
  assert.equal(normalizeStoreIdentifier("pepweb.store", ROOT), null);
});
test("port-bearing dev root works (slug.lvh.me:3100)", () => {
  assert.equal(normalizeStoreIdentifier("acme", "lvh.me:3100"), "acme.lvh.me:3100");
});

// ── tokens ───────────────────────────────────────────────────────────────────
section("tokens");
test("opaque tokens are long, url-safe and unique", () => {
  const a = mintOpaqueToken();
  const b = mintOpaqueToken();
  assert.ok(a.length >= 43, `length ${a.length}`);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
});
test("hashToken is deterministic sha-256 hex and never the token itself", () => {
  const t = mintOpaqueToken();
  assert.equal(hashToken(t), hashToken(t));
  assert.match(hashToken(t), /^[0-9a-f]{64}$/);
  assert.notEqual(hashToken(t), t);
});
test("credentialStamp changes when the password hash changes", () => {
  const s1 = credentialStamp("scrypt$aa$bb");
  assert.equal(s1, credentialStamp("scrypt$aa$bb"));
  assert.notEqual(s1, credentialStamp("scrypt$aa$cc"));
  assert.ok(!s1.includes("bb"));
});
test("parseBearer accepts only a well-formed Bearer header", () => {
  assert.equal(parseBearer("Bearer abc_DEF-123"), "abc_DEF-123");
  assert.equal(parseBearer("bearer abc"), "abc");
  assert.equal(parseBearer("Basic abc"), null);
  assert.equal(parseBearer("Bearer "), null);
  assert.equal(parseBearer(null), null);
  assert.equal(parseBearer("Bearer a b"), null);
});
test("TTLs: short access, long refresh", () => {
  assert.equal(ACCESS_TOKEN_TTL_SECONDS, 15 * 60);
  assert.equal(REFRESH_TOKEN_TTL_SECONDS, 30 * 24 * 60 * 60);
});

// ── session rules ────────────────────────────────────────────────────────────
section("session-rules");
const NOW = new Date("2026-09-29T10:00:00Z");
const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  accessTokenHash: hashToken("acc"),
  accessExpiresAt: new Date(NOW.getTime() + 60_000),
  refreshTokenHash: hashToken("ref"),
  previousRefreshTokenHash: hashToken("old-ref"),
  refreshExpiresAt: new Date(NOW.getTime() + 86_400_000),
  revokedAt: null,
  ...over,
});
test("valid access token passes", () => {
  assert.deepEqual(checkAccess(row(), "acc", NOW), { ok: true });
});
test("expired access token → expired (client should refresh)", () => {
  const r = checkAccess(row({ accessExpiresAt: new Date(NOW.getTime() - 1) }), "acc", NOW);
  assert.deepEqual(r, { ok: false, reason: "expired" });
});
test("revoked session never passes", () => {
  assert.deepEqual(checkAccess(row({ revokedAt: NOW }), "acc", NOW), {
    ok: false,
    reason: "revoked",
  });
  assert.deepEqual(checkRefresh(row({ revokedAt: NOW }), "ref", NOW), {
    ok: false,
    reason: "revoked",
  });
});
test("wrong access token → invalid", () => {
  assert.deepEqual(checkAccess(row(), "nope", NOW), { ok: false, reason: "invalid" });
});
test("current refresh token rotates", () => {
  assert.deepEqual(checkRefresh(row(), "ref", NOW), { ok: true });
});
test("an already-rotated refresh token is a replay → revoke", () => {
  assert.deepEqual(checkRefresh(row(), "old-ref", NOW), { ok: false, reason: "replay" });
});
test("expired refresh → expired", () => {
  const r = checkRefresh(row({ refreshExpiresAt: new Date(NOW.getTime() - 1) }), "ref", NOW);
  assert.deepEqual(r, { ok: false, reason: "expired" });
});

// ── theme ────────────────────────────────────────────────────────────────────
section("theme");
test("unknown / invalid colours fall back to safe defaults", () => {
  const t = buildMobileTheme({ name: "", palette: { button: "not-a-colour" } });
  assert.equal(t.primary, DEFAULT_MOBILE_THEME.primary);
  assert.equal(t.name, "Your store");
});
test("on-primary text always meets 4.5:1 against the primary", () => {
  for (const button of ["#ffff00", "#111111", "#7fbfff", "#e11d48", "#c9a227"]) {
    const t = buildMobileTheme({ name: "X", palette: { button, buttonText: button } });
    assert.ok(contrastRatio(t.onPrimary, t.primary) >= 4.5, `${button} → ${t.onPrimary}`);
  }
});
test("a primary too light to read as a link on white gets a readable tint", () => {
  const t = buildMobileTheme({ name: "X", palette: { button: "#fff3b0" } });
  assert.ok(contrastRatio(t.primaryText, "#ffffff") >= 4.5, t.primaryText);
});
test("brand name, logo and fonts pass through", () => {
  const t = buildMobileTheme({
    name: "HP Glow",
    logoUrl: "https://ik.imagekit.io/x/logo.png",
    palette: { button: "#0b6e4f", headingFont: "Playfair Display", bodyFont: "Inter" },
  });
  assert.equal(t.name, "HP Glow");
  assert.equal(t.logoUrl, "https://ik.imagekit.io/x/logo.png");
  assert.equal(t.fonts.heading, "Playfair Display");
  assert.equal(t.fonts.body, "Inter");
});
test("non-https logo is dropped", () => {
  const t = buildMobileTheme({ name: "X", logoUrl: "javascript:alert(1)", palette: {} });
  assert.equal(t.logoUrl, null);
});
test("version is stable and changes when branding changes", () => {
  const a = buildMobileTheme({ name: "A", palette: { button: "#0b6e4f" } });
  const a2 = buildMobileTheme({ name: "A", palette: { button: "#0b6e4f" } });
  const b = buildMobileTheme({ name: "A", palette: { button: "#1d4ed8" } });
  assert.equal(a.version, a2.version);
  assert.notEqual(a.version, b.version);
});

// The signed-in app wears the store's WEBSITE look: its page background, card
// surface, text, header and fonts — translated so every pair stays readable.
const AA_TEXT = 4.5;
const AA_GRAPHIC = 3;
function assertReadable(label: string, fg: string, bg: string, min = AA_TEXT) {
  const r = contrastRatio(fg, bg);
  assert.ok(r >= min, `${label}: ${fg} on ${bg} = ${r.toFixed(2)} < ${min}`);
}
function assertPaletteReadable(id: string, t: ReturnType<typeof buildMobileTheme>) {
  const p = t.palette;
  for (const surface of [p.bg, p.surface]) {
    assertReadable(`${id} text`, p.text, surface);
    assertReadable(`${id} textMuted`, p.textMuted, surface);
    assertReadable(`${id} textFaint`, p.textFaint, surface);
    assertReadable(`${id} link`, t.primaryText, surface);
    assertReadable(`${id} chart`, p.chart, surface, AA_GRAPHIC);
  }
  assertReadable(`${id} headerText`, t.headerText, t.headerBackground);
  assertReadable(`${id} bandText`, p.bandText, p.band);
  assertReadable(`${id} bandMuted`, p.bandMuted, p.band);
  assertReadable(`${id} chartOnBand`, p.chartOnBand, p.band, AA_GRAPHIC);
  assertReadable(`${id} onPrimary`, t.onPrimary, t.primary);
}
test("palette mirrors the website's background, surface and text", () => {
  const t = buildMobileTheme({
    name: "X",
    palette: { button: "#E94B7D", main: "#B0345E", background: "#FFF7FA", surface: "#ffffff", text: "#3B1F2A" },
  });
  assert.equal(t.palette.bg, "#fff7fa");
  assert.equal(t.palette.surface, "#ffffff");
  assert.equal(t.palette.text, "#3b1f2a");
  assert.equal(t.palette.scheme, "light");
});
test("every website theme preset stays readable in the app", () => {
  for (const themeId of Object.keys(THEME_PRESETS)) {
    const palette = brandPaletteFromBranding({ themeId } as Parameters<typeof brandPaletteFromBranding>[0]);
    assertPaletteReadable(themeId, buildMobileTheme({ name: themeId, palette }));
  }
});
test("a dark website makes a dark app", () => {
  const t = buildMobileTheme({
    name: "X",
    palette: { button: "#c8a24a", background: "#0b0b0d", surface: "#16161a", text: "#f2efe8" },
  });
  assert.equal(t.palette.scheme, "dark");
  assertPaletteReadable("dark", t);
});
test("no header override → header matches the site (surface + readable text)", () => {
  const t = buildMobileTheme({ name: "X", palette: { button: "#0b6e4f", surface: "#fdfbf7", main: "#0b6e4f" } });
  assert.equal(t.headerBackground, "#fdfbf7");
  assertReadable("header", t.headerText, t.headerBackground);
});
test("explicit header colours pass through and colour the hero band", () => {
  const t = buildMobileTheme({ name: "X", palette: { button: "#d4af37", headerBg: "#000000", headerText: "#ffffff" } });
  assert.equal(t.headerBackground, "#000000");
  assert.equal(t.headerText, "#ffffff");
  assert.equal(t.palette.band, "#000000");
});
test("the store's border colour is used for hairlines", () => {
  const t = buildMobileTheme({ name: "X", palette: { borderColor: "#000000" } });
  assert.equal(t.palette.border, "#000000");
});
test("unreadable website text is corrected, never copied blindly", () => {
  const t = buildMobileTheme({
    name: "X",
    palette: { button: "#fff3b0", background: "#ffffff", surface: "#fafafa", text: "#eeeeee", main: "#ffffff" },
  });
  assertPaletteReadable("washed-out", t);
});

// ── order view ───────────────────────────────────────────────────────────────
section("order-view");
const order = (over: Partial<Order> = {}): Order => ({
  id: "o1",
  orderNumber: "HPG-1001",
  status: "new",
  paymentStatus: "pending",
  paymentMethod: "GCash",
  date: "2026-09-29T02:00:00.000Z",
  customer: { name: "Ana Cruz", email: "ana@example.com", phone: "0917", contactMethod: "sms" },
  shipping: {
    address: "1 Main",
    barangay: "",
    city: "Makati",
    province: "NCR",
    postal: "1200",
    country: "PH",
    region: "NCR",
    fee: 150,
  },
  courier: "",
  trackingNumber: "",
  shippingNote: "",
  items: [
    { name: "BPC-157", qty: 2, price: 1000 } as Order["items"][number],
    { name: "Bac water", qty: 1, price: 200 } as Order["items"][number],
  ],
  paymentProof: null,
  ...over,
});
test("summary total mirrors website maths (items − discount + ship + fees)", () => {
  const s = toOrderSummary(
    order({
      discount: { code: "X", label: "X", amount: 100 },
      adminFee: { label: "Admin", amount: 50 },
      paymentFee: { label: "QR", amount: 20 },
    }),
    "₱",
  );
  // 2200 − 100 + 150 + 50 + 20
  assert.equal(s.total, 2320);
  assert.equal(s.totalLabel, "₱2,320.00");
  assert.equal(s.itemCount, 3);
  assert.equal(s.customerName, "Ana Cruz");
  assert.equal(s.orderNumber, "HPG-1001");
});
test("summary falls back to a short id when no order number", () => {
  const s = toOrderSummary(order({ orderNumber: undefined, id: "cmabcdef123456" }), "₱");
  assert.equal(s.orderNumber, "#123456");
});
test("detail exposes the money breakdown + timeline", () => {
  const d = toOrderDetail(
    order({ statusHistory: [{ status: "new", at: "2026-09-29T02:00:00.000Z" }] }),
    "₱",
    "2026-09-29T02:00:05.000Z",
  );
  assert.equal(d.money.subtotalLabel, "₱2,200.00");
  assert.equal(d.money.shippingLabel, "₱150.00");
  assert.equal(d.timeline.length, 1);
  assert.equal(d.updatedAt, "2026-09-29T02:00:05.000Z");
  assert.equal(d.items[0].lineTotalLabel, "₱2,000.00");
});
test("next action follows the fulfilment order and stops at the end", () => {
  assert.equal(nextActionFor(order({ status: "new" }))?.to, "confirmed");
  assert.equal(nextActionFor(order({ status: "confirmed" }))?.to, "processing");
  assert.equal(nextActionFor(order({ status: "processing" }))?.to, "ready");
  assert.equal(nextActionFor(order({ status: "ready" }))?.to, "shipped");
  assert.equal(nextActionFor(order({ status: "shipped" }))?.to, "delivered");
  assert.equal(nextActionFor(order({ status: "delivered" })), null);
  assert.equal(nextActionFor(order({ status: "cancelled" })), null);
});
test("shipping step asks for tracking details", () => {
  assert.equal(nextActionFor(order({ status: "ready" }))?.needsTracking, true);
});
test("payment view never claims 'verified' from a customer upload", () => {
  const withProof = paymentView(order({ paymentStatus: "paid", paymentProof: "https://x/p.jpg" }));
  assert.equal(withProof.label, "Proof submitted");
  assert.equal(withProof.tone, "info");
  assert.equal(withProof.hasProof, true);
  const pending = paymentView(order());
  assert.equal(pending.label, "Awaiting payment");
  assert.equal(pending.tone, "warning");
  const paidNoProof = paymentView(order({ paymentStatus: "paid", paymentProof: null }));
  assert.equal(paidNoProof.label, "Marked paid");
  assert.equal(paidNoProof.tone, "success");
});
test("stock-moving statuses are flagged for confirmation (not for imported orders)", () => {
  assert.equal(statusMovesStock(order({ status: "new" }), "confirmed"), "deduct");
  assert.equal(
    statusMovesStock(
      order({ status: "confirmed", statusHistory: [{ status: "confirmed", at: "x" }] }),
      "cancelled",
    ),
    "restock",
  );
  assert.equal(statusMovesStock(order({ status: "new" }), "processing"), null);
  assert.equal(statusMovesStock(order({ status: "new", imported: true }), "confirmed"), null);
});
test("filters map to real statuses only", () => {
  assert.deepEqual(
    ORDER_FILTERS.map((f) => f.key),
    ["new", "to-fulfil", "shipped", "all"],
  );
  assert.deepEqual(statusesForFilter("new"), ["new"]);
  assert.deepEqual(statusesForFilter("to-fulfil"), ["confirmed", "processing", "ready"]);
  assert.deepEqual(statusesForFilter("shipped"), ["shipped", "delivered"]);
  assert.equal(statusesForFilter("all"), null);
  assert.equal(statusesForFilter("bogus"), null);
});

// ── push message ─────────────────────────────────────────────────────────────
section("push-message");
test("new-order push is lock-screen safe (no customer, no products)", () => {
  const m = buildNewOrderPush({ id: "o1", orderNumber: "HPG-1001" }, "HP Glow");
  assert.equal(m.title, "New order · HP Glow");
  assert.equal(m.body, "Order HPG-1001. Tap to review.");
  assert.deepEqual(m.data, { type: "order", orderId: "o1" });
  assert.ok(!JSON.stringify(m).includes("Ana"));
});
test("new-order push carries the total + item count, still no customer or products", () => {
  const m = buildNewOrderPush({ id: "o1", orderNumber: "HPG-1001", total: 2450, itemCount: 3 }, "HP Glow", "₱");
  assert.equal(m.title, "New order · HP Glow");
  assert.match(m.body, /^Order HPG-1001 · ₱2,450(\.00)? · 3 items\. Tap to review\.$/);
  const one = buildNewOrderPush({ id: "o2", total: 0, itemCount: 1 }, "HP Glow", "₱");
  assert.equal(one.body, "Order #o2 · 1 item. Tap to review.");
});
test("expo ticket triage", () => {
  assert.equal(triageExpoTicket({ status: "ok", id: "t" }), "ok");
  assert.equal(
    triageExpoTicket({ status: "error", details: { error: "DeviceNotRegistered" } }),
    "remove-device",
  );
  assert.equal(
    triageExpoTicket({ status: "error", details: { error: "MessageRateExceeded" } }),
    "retry",
  );
  assert.equal(triageExpoTicket({ status: "error", details: { error: "InvalidCredentials" } }), "fail");
  assert.equal(triageExpoTicket(undefined), "retry");
});

test("store link: the seller's shareable /app link and the deep link it opens", () => {
  assert.equal(storeAppLink("https://hpglow.pepweb.store"), "https://hpglow.pepweb.store/app");
  assert.equal(storeAppLink("https://hpglow.pepweb.store/"), "https://hpglow.pepweb.store/app");
  assert.equal(storeDeepLink("hpglow"), `${MOBILE_APP_SCHEME}://store/hpglow`);
});
test("store link: the app reads the store out of every link shape", () => {
  assert.equal(storeFromUrl(storeDeepLink("hpglow")), "hpglow");
  assert.equal(storeFromUrl("pepwebadmin:///store/hpglow"), "hpglow");
  assert.equal(storeFromUrl("/store/HPGlow"), "hpglow", "the path expo-router hands to +native-intent");
  assert.equal(storeFromUrl("/store/hpglow?utm=ig"), "hpglow");
  assert.equal(storeFromUrl("https://hpglow.pepweb.store/app"), "hpglow.pepweb.store");
  assert.equal(storeFromUrl("https://shop.example.com/app/?ref=bio"), "shop.example.com");
  assert.equal(storeFromUrl("/orders/123"), null, "other deep links pass through untouched");
  assert.equal(storeFromUrl("https://hpglow.pepweb.store/"), null);
  assert.equal(storeFromUrl("/store/%E0%A4%A"), null, "bad escapes never throw");
  assert.equal(storeFromUrl("/store/<script>"), null);
});
test("store link: what a customer types into Add your store", () => {
  assert.equal(storeFromInput("  HPGlow "), "hpglow");
  assert.equal(storeFromInput("hpglow.pepweb.store"), "hpglow.pepweb.store");
  assert.equal(storeFromInput("https://hpglow.pepweb.store/#admin"), "hpglow.pepweb.store");
  assert.equal(storeFromInput("https://hpglow.pepweb.store/app"), "hpglow.pepweb.store");
  assert.equal(storeFromInput(""), null);
  assert.equal(storeFromInput("not a store!"), null);
});

test("queue badges from one grouped count: new vs to-fulfil, others ignored", () => {
  const counts = queueCountsFrom([
    { status: "new", count: 3 },
    { status: "confirmed", count: 2 },
    { status: "processing", count: 1 },
    { status: "ready", count: 4 },
    { status: "shipped", count: 9 },
    { status: "cancelled", count: 5 },
  ]);
  assert.deepEqual(counts, { new: 3, toFulfil: 7 });
  assert.deepEqual(queueCountsFrom([]), { new: 0, toFulfil: 0 });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
