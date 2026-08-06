// Self-contained gate for the STORE OPEN/CLOSED switch
// (src/lib/storefront/store-status.ts). No DB, no React.
//
// A store owner needs to shut the shop for a restock, a holiday, or a supplier
// delay without unpublishing anything. Closing keeps the catalog browsable —
// shoppers still see the products and the prices — but every buy control reads
// "Closed" and nothing can reach the cart or the checkout.
//
// This gate pins the rules the storefront, the cart and the server checkout all
// read, so the three can never drift:
//
//   • an absent / junk config leaves the store OPEN — no existing tenant moves
//   • only a literal `false` closes a store; a truthy-looking string never does
//   • the closed headline names the business, and the owner can override it
//   • the owner's message is trimmed and length-clamped before it is persisted
//   • every buy surface (card, modal, two-ways, group buy) shows the closed CTA
//   • the cart refuses the add AND the server refuses the order
//
//   npm run test:store-status

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MAX_STORE_CLOSED_HEADLINE,
  MAX_STORE_CLOSED_MESSAGE,
  STORE_CLOSED_BLOCK_MESSAGE,
  STORE_STATUS_DEFAULT,
  buildStoreClosedNotice,
  isStoreClosed,
  normalizeStoreStatus,
} from "../src/lib/storefront/store-status";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

console.log("store status — open / closed switch\n");

// ── normalizeStoreStatus — untrusted branding.config.storeStatus ─────────────
// Every existing tenant stores nothing here, so the default has to reproduce
// today's storefront exactly: open, no notice copy.
console.log("normalizeStoreStatus — fails safe to OPEN");

check("the default is an open store", eq(STORE_STATUS_DEFAULT, { open: true, headline: "", message: "" }));
check("undefined → open", eq(normalizeStoreStatus(undefined), STORE_STATUS_DEFAULT));
check("null → open", eq(normalizeStoreStatus(null), STORE_STATUS_DEFAULT));
check("a string → open", eq(normalizeStoreStatus("closed"), STORE_STATUS_DEFAULT));
check("an array → open", eq(normalizeStoreStatus(["closed"]), STORE_STATUS_DEFAULT));
check("a number → open", eq(normalizeStoreStatus(0), STORE_STATUS_DEFAULT));
check("{} → open", eq(normalizeStoreStatus({}), STORE_STATUS_DEFAULT));

// The one rule that matters most: a store must never close by accident. Only a
// literal boolean false closes it — JSON round-trips, form posts and hand-edited
// config all tend to produce strings, and "false" is truthy in JS.
console.log("\nonly a literal false closes a store");

check("{ open: false } → closed", normalizeStoreStatus({ open: false }).open === false);
check('{ open: "false" } → still OPEN', normalizeStoreStatus({ open: "false" }).open === true);
check('{ open: "" } → still OPEN', normalizeStoreStatus({ open: "" }).open === true);
check("{ open: 0 } → still OPEN", normalizeStoreStatus({ open: 0 }).open === true);
check("{ open: null } → still OPEN", normalizeStoreStatus({ open: null }).open === true);
check("{ open: true } → open", normalizeStoreStatus({ open: true }).open === true);

// ── the owner's copy is untrusted input ──────────────────────────────────────
console.log("\nheadline + message are sanitized on the way in");

check(
  "surrounding whitespace is trimmed off both fields",
  eq(normalizeStoreStatus({ open: false, headline: "  Back Monday  ", message: "\n Restocking \t" }), {
    open: false,
    headline: "Back Monday",
    message: "Restocking",
  }),
);
check(
  'a non-string headline reads as empty, not as "undefined"',
  normalizeStoreStatus({ open: false, headline: 42 }).headline === "",
);
check(
  "a non-string message reads as empty",
  normalizeStoreStatus({ open: false, message: { text: "hi" } }).message === "",
);
check(
  "an over-long headline is clamped, not rejected",
  normalizeStoreStatus({ open: false, headline: "x".repeat(5000) }).headline.length ===
    MAX_STORE_CLOSED_HEADLINE,
);
check(
  "an over-long message is clamped, not rejected",
  normalizeStoreStatus({ open: false, message: "y".repeat(9000) }).message.length ===
    MAX_STORE_CLOSED_MESSAGE,
);
check(
  "the headline cap is smaller than the message cap",
  MAX_STORE_CLOSED_HEADLINE < MAX_STORE_CLOSED_MESSAGE,
);

// Immutability — the storefront renders from the same config object the cache
// hands out, so the normalizer must never write back into it.
console.log("\nthe normalizer never mutates its input");

const frozenInput = Object.freeze({ open: false, headline: "  Hi  ", message: "  There  " });
let threw = false;
try {
  normalizeStoreStatus(frozenInput);
} catch {
  threw = true;
}
check("normalizing a frozen config does not throw", threw === false);
check("the input object is left untouched", frozenInput.headline === "  Hi  ");
check(
  "the result is a NEW object, not the input",
  (normalizeStoreStatus(frozenInput) as unknown) !== (frozenInput as unknown),
);

// ── isStoreClosed — the single predicate every surface reads ─────────────────
console.log("\nisStoreClosed — one predicate, shared by client and server");

check("an unset status is not closed", isStoreClosed(undefined) === false);
check("junk is not closed", isStoreClosed("closed") === false);
check("an open status is not closed", isStoreClosed({ open: true, headline: "", message: "" }) === false);
check("a closed status is closed", isStoreClosed({ open: false, headline: "", message: "" }) === true);
check(
  "isStoreClosed normalizes raw config too, so callers can pass it straight through",
  isStoreClosed({ open: false }) === true,
);

// ── buildStoreClosedNotice — the shopper-facing card copy ────────────────────
// "Hello — {Business Name} is currently closed" is the whole point of the
// feature: the shopper has to know WHOSE store this is and that it is shut.
console.log("\nbuildStoreClosedNotice — greets the shopper by business name");

const autoNotice = buildStoreClosedNotice(
  { open: false, headline: "", message: "Back Monday 9am" },
  "HP Glow",
);
check("the auto headline greets the shopper", autoNotice.headline.startsWith("Hello"));
check("the auto headline names the business", autoNotice.headline.includes("HP Glow"));
check("the auto headline says the store is closed", /closed/i.test(autoNotice.headline));
check("the owner's message is carried through verbatim", autoNotice.message === "Back Monday 9am");

const overridden = buildStoreClosedNotice(
  { open: false, headline: "We're on holiday until the 5th", message: "" },
  "HP Glow",
);
check(
  "an owner-written headline replaces the auto one",
  overridden.headline === "We're on holiday until the 5th",
);
check("an empty message stays empty (the card just omits it)", overridden.message === "");

const noName = buildStoreClosedNotice({ open: false, headline: "", message: "" }, "");
check("a nameless brand still produces a sensible headline", noName.headline.length > 0);
check("a nameless brand's headline has no dangling separator", !/[—-]\s*$|\s{2,}/.test(noName.headline));
check("a nameless brand never renders the literal word undefined", !/undefined/i.test(noName.headline));

check(
  "there is a shopper-facing reason for a refused add",
  typeof STORE_CLOSED_BLOCK_MESSAGE === "string" && STORE_CLOSED_BLOCK_MESSAGE.length > 0,
);
check("the block message says the store is closed", /closed/i.test(STORE_CLOSED_BLOCK_MESSAGE));

// ── every buy surface honours the switch ─────────────────────────────────────
// The core above is only worth anything if the surfaces actually read it. These
// are the same source-level guards test-product-cta.ts uses: they catch a
// surface that was added later and quietly bypasses the gate.
console.log("\nevery buy surface reads the switch");

const productCta = src("src/lib/storefront/product-cta.ts");
check(
  "the CTA vocabulary has a Closed label",
  /closed:\s*"/i.test(productCta),
  "CTA_COPY has no closed entry — the buttons have nothing to say",
);
check(
  "buildProductCta accepts a storeClosed flag",
  /storeClosed/.test(productCta),
  "buildProductCta ignores the store switch — the cards would look buyable",
);

const catalog = src("src/storefront/components/Catalog.tsx");
check(
  "the catalog passes storeClosed into both the card and the quick-view modal",
  (catalog.match(/storeClosed/g) ?? []).length >= 2,
  "Catalog.tsx wires the flag into fewer than both buildProductCta call sites",
);

const twoWays = src("src/storefront/components/TwoWaysHome.tsx");
check(
  "the two-ways home guards its hand-rolled add buttons",
  /storeClosed|isStoreClosed/.test(twoWays),
  "TwoWaysHome.tsx builds its own buttons and never checks the switch",
);

const groupBuyPage = src("src/storefront/pages/GroupBuyPage.tsx");
check(
  "the group-buy page guards its Join button",
  /storeClosed|isStoreClosed/.test(groupBuyPage),
  "GroupBuyPage.tsx bypasses the switch — a closed store could still take pre-orders",
);

const store = src("src/storefront/store.tsx");
check(
  "the cart refuses to add while the store is closed",
  /isStoreClosed|STORE_CLOSED_BLOCK_MESSAGE/.test(store),
  "store.tsx addToCart has no closed guard — the CTA would be cosmetic",
);

const cartCheckout = src("src/storefront/components/CartCheckout.tsx");
check(
  "checkout is blocked while the store is closed",
  /isStoreClosed|STORE_CLOSED_BLOCK_MESSAGE/.test(cartCheckout),
  "CartCheckout.tsx would still let an already-filled cart place an order",
);

const app = src("src/storefront/StorefrontApp.tsx");
check(
  "the storefront renders the closed notice",
  /StoreClosedNotice/.test(app),
  "StorefrontApp.tsx never shows the notice — the shopper is given no explanation",
);

// The boundary. Everything above is UX; this is the rule that actually holds.
const ordersAction = src("src/actions/orders.ts");
check(
  "order placement re-checks the switch server-side",
  /isStoreClosed/.test(ordersAction),
  "orders.ts never re-checks the store status — a stale tab could still order",
);
check(
  "BOTH the demo and the DB placement paths are guarded",
  (ordersAction.match(/isStoreClosed/g) ?? []).length >= 2,
  "orders.ts guards only one placement path — the other accepts orders on a closed store",
);

// ── the owner can actually reach the switch ─────────────────────────────────
console.log("\nthe owner (and permitted staff) can reach the switch");

const staffPermissions = src("src/storefront/admin/staff-permissions.ts");
check(
  "store-status is a grantable staff module",
  /"store-status"/.test(staffPermissions),
  "staff-permissions.ts has no store-status key — staff could never be granted it",
);

const adminNav = src("src/storefront/admin/admin-nav.ts");
check(
  "the store admin sidebar offers the Store Status panel",
  /store-status/.test(adminNav),
  "admin-nav.ts has no entry — the owner has no way in",
);

const adminPage = src("src/storefront/admin/AdminPage.tsx");
check(
  "the admin routes the store-status view",
  /store-status/.test(adminPage),
  "AdminPage.tsx never routes the view — the sidebar entry would dead-end",
);

const adminAction = src("src/actions/storefront-admin.ts");
check(
  "there is a save action for the switch",
  /saveStoreStatusAction/.test(adminAction),
  "storefront-admin.ts has no saveStoreStatusAction — nothing persists",
);

console.log(
  failures === 0
    ? "\nPASS — store open/closed switch verified"
    : `\nFAIL — ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
