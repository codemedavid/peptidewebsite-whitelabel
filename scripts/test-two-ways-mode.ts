// Self-contained gate for PER-WAY management of the "two ways to order"
// storefront (src/lib/storefront/two-ways-mode.ts). No DB, no React.
//
// A store that sells only one way (Dragon Peptides: group buy only) must be able
// to CLOSE a way (still shown, nothing buyable) or HIDE it outright (the page
// reads as a one-way store). This gate pins the rules that both the storefront
// and the server checkout read, so the two can never drift:
//
//   • an absent / junk config leaves BOTH ways open — no existing tenant moves
//   • hiding both ways is never a valid resolution (a store with no way to buy)
//   • the legacy live-round rule (groupBuyAllowOnHand) still closes on-hand
//   • closed and hidden are both UNBUYABLE — the checkout gate reads the same
//
//   npm run test:two-ways-mode

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  TWO_WAYS_MODE_DEFAULT,
  WAY_BLOCK_MESSAGES,
  isGroupBuyBuyable,
  isOnHandBuyable,
  normalizeTwoWaysMode,
  resolveWays,
  visibleWayCount,
  wayBlockMessage,
  waysHeading,
  type TwoWaysMode,
} from "../src/lib/storefront/two-ways-mode";

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

console.log("two ways to order — per-way management\n");

// ── normalizeTwoWaysMode — untrusted branding.config.twoWaysMode ─────────────
// Every existing tenant stores nothing here, so the default has to reproduce
// today's storefront exactly: both ways open.
check("the default is both ways open", eq(TWO_WAYS_MODE_DEFAULT, { onHand: "open", groupBuy: "open" }));
check("undefined → both open", eq(normalizeTwoWaysMode(undefined), TWO_WAYS_MODE_DEFAULT));
check("null → both open", eq(normalizeTwoWaysMode(null), TWO_WAYS_MODE_DEFAULT));
check("a string → both open", eq(normalizeTwoWaysMode("group-buy-only"), TWO_WAYS_MODE_DEFAULT));
check("an array → both open", eq(normalizeTwoWaysMode(["hidden"]), TWO_WAYS_MODE_DEFAULT));
check("{} → both open", eq(normalizeTwoWaysMode({}), TWO_WAYS_MODE_DEFAULT));

check(
  "on-hand hidden is honoured, missing group-buy stays open",
  eq(normalizeTwoWaysMode({ onHand: "hidden" }), { onHand: "hidden", groupBuy: "open" }),
);
check(
  "group-buy closed is honoured, missing on-hand stays open",
  eq(normalizeTwoWaysMode({ groupBuy: "closed" }), { onHand: "open", groupBuy: "closed" }),
);
check(
  "both states are honoured together",
  eq(normalizeTwoWaysMode({ onHand: "closed", groupBuy: "hidden" }), {
    onHand: "closed",
    groupBuy: "hidden",
  }),
);
check(
  "an unknown state falls back to open (fail-safe: never hide by accident)",
  eq(normalizeTwoWaysMode({ onHand: "gone", groupBuy: 3 }), TWO_WAYS_MODE_DEFAULT),
);

// A store with NO way to buy is never a valid resolution — an owner who somehow
// writes it (stale client, hand-edited config) gets today's storefront back
// rather than an unshoppable page.
check(
  "hiding BOTH ways is refused — falls back to both open",
  eq(normalizeTwoWaysMode({ onHand: "hidden", groupBuy: "hidden" }), TWO_WAYS_MODE_DEFAULT),
);
// Closed-everywhere is a legitimate (if unusual) state: the store is visibly
// paused rather than broken, so it is NOT coerced.
check(
  "closing both ways is allowed (a visibly paused store)",
  eq(normalizeTwoWaysMode({ onHand: "closed", groupBuy: "closed" }), {
    onHand: "closed",
    groupBuy: "closed",
  }),
);

check("the input object is never mutated", (() => {
  const input = { onHand: "hidden", groupBuy: "hidden" } as Record<string, unknown>;
  normalizeTwoWaysMode(input);
  return input.onHand === "hidden" && input.groupBuy === "hidden";
})());

// ── resolveWays — the owner setting folded with the live-round rule ──────────
const BOTH_OPEN: TwoWaysMode = { onHand: "open", groupBuy: "open" };
const GB_ONLY: TwoWaysMode = { onHand: "hidden", groupBuy: "open" };
const ON_HAND_ONLY: TwoWaysMode = { onHand: "open", groupBuy: "hidden" };

check(
  "no round live, both open → both open (today's storefront)",
  eq(resolveWays(BOTH_OPEN, { allowOnHand: true, roundLive: false }), BOTH_OPEN),
);
check(
  "a live round with on-hand allowed leaves both open",
  eq(resolveWays(BOTH_OPEN, { allowOnHand: true, roundLive: true }), BOTH_OPEN),
);
// The pre-existing owner toggle (branding.config.groupBuyAllowOnHand) pauses
// on-hand only WHILE a round is live — that behaviour must survive untouched.
check(
  "a live round with on-hand paused CLOSES the on-hand way",
  eq(resolveWays(BOTH_OPEN, { allowOnHand: false, roundLive: true }), {
    onHand: "closed",
    groupBuy: "open",
  }),
);
check(
  "on-hand paused but NO round live leaves on-hand open (the legacy rule is round-scoped)",
  eq(resolveWays(BOTH_OPEN, { allowOnHand: false, roundLive: false }), BOTH_OPEN),
);
check(
  "a hidden way is never re-opened by the live-round rule",
  eq(resolveWays(GB_ONLY, { allowOnHand: false, roundLive: true }), GB_ONLY),
);
check(
  "an owner-closed way stays closed regardless of the round",
  eq(resolveWays({ onHand: "closed", groupBuy: "open" }, { allowOnHand: true, roundLive: false }), {
    onHand: "closed",
    groupBuy: "open",
  }),
);
check(
  "resolveWays normalizes untrusted input too",
  eq(resolveWays({ onHand: "nope" } as unknown as TwoWaysMode, { allowOnHand: true, roundLive: false }), BOTH_OPEN),
);
check("resolveWays never mutates the mode it is given", (() => {
  const mode: TwoWaysMode = { onHand: "open", groupBuy: "open" };
  resolveWays(mode, { allowOnHand: false, roundLive: true });
  return mode.onHand === "open";
})());

// ── Buyability — what the cart and the server checkout both read ─────────────
check("open on-hand is buyable", isOnHandBuyable({ onHand: "open", groupBuy: "open" }));
check("closed on-hand is NOT buyable", !isOnHandBuyable({ onHand: "closed", groupBuy: "open" }));
check("hidden on-hand is NOT buyable", !isOnHandBuyable({ onHand: "hidden", groupBuy: "open" }));
check("open group buy is buyable", isGroupBuyBuyable({ onHand: "open", groupBuy: "open" }));
check("closed group buy is NOT buyable", !isGroupBuyBuyable({ onHand: "open", groupBuy: "closed" }));
check("hidden group buy is NOT buyable", !isGroupBuyBuyable({ onHand: "open", groupBuy: "hidden" }));

// ── Block messages — one shared copy for cart + checkout ─────────────────────
check(
  "an open way produces no block message",
  wayBlockMessage("onHand", BOTH_OPEN) === null && wayBlockMessage("groupBuy", BOTH_OPEN) === null,
);
check(
  "a closed on-hand way explains itself",
  wayBlockMessage("onHand", { onHand: "closed", groupBuy: "open" }) === WAY_BLOCK_MESSAGES.onHand,
);
check(
  "a hidden on-hand way uses the same copy (a shopper must never see 'hidden')",
  wayBlockMessage("onHand", GB_ONLY) === WAY_BLOCK_MESSAGES.onHand,
);
check(
  "a closed group buy explains itself",
  wayBlockMessage("groupBuy", { onHand: "open", groupBuy: "closed" }) === WAY_BLOCK_MESSAGES.groupBuy,
);
check(
  "block copy never leaks the internal state words",
  !/hidden|closed way/i.test(WAY_BLOCK_MESSAGES.onHand + WAY_BLOCK_MESSAGES.groupBuy),
);

// ── Presentation — how many ways the page actually offers ────────────────────
check("both ways visible → 2", visibleWayCount(BOTH_OPEN) === 2);
check("a closed way is still VISIBLE (shown as closed) → 2", visibleWayCount({ onHand: "closed", groupBuy: "open" }) === 2);
check("a hidden way drops out → 1", visibleWayCount(GB_ONLY) === 1);
check("group-buy hidden drops out → 1", visibleWayCount(ON_HAND_ONLY) === 1);

check('two visible ways keep the "Two ways to order" heading', waysHeading(BOTH_OPEN) === "Two ways to order");
check('one visible way reads "How to order"', waysHeading(GB_ONLY) === "How to order");
check('a one-way store never says "two"', !/two/i.test(waysHeading(ON_HAND_ONLY)));

// ── Wiring — the storefront must enforce, not just hide ─────────────────────
// Hiding a section is cosmetic. The cart has to refuse the add too, or a stale
// tab (or a product reached from the catalog route) still fills a cart the
// server will only reject at the very end of checkout.
const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

check(
  "the cart refuses adds from a way that isn't selling",
  (() => {
    const src = read("src/storefront/store.tsx");
    return /decideWayBlock/.test(src) && /twoWaysMode/.test(src);
  })(),
  "store.tsx addToCart must consult the per-way gate",
);

check(
  "the group-buy route is not reachable when the way is hidden",
  /twoWaysMode[^\n]*groupBuy/.test(read("src/storefront/StorefrontApp.tsx")),
  "StorefrontApp must send #groupbuy home when the way is hidden",
);

check(
  "a store-admin action persists the setting",
  (() => {
    const src = read("src/actions/group-buys.ts");
    return (
      /saveTwoWaysModeAction/.test(src) &&
      /normalizeTwoWaysMode/.test(src) &&
      /twoWaysMode/.test(src)
    );
  })(),
  "actions/group-buys.ts must expose a gated saveTwoWaysModeAction",
);

check(
  "the owner can manage both ways from the Group Buys admin",
  (() => {
    const src = read("src/storefront/admin/AdminGroupBuys.tsx");
    return /saveTwoWaysModeAction/.test(src) && /Ways to order/.test(src);
  })(),
  "AdminGroupBuys must expose a 'Ways to order' control",
);

console.log(
  failures === 0
    ? "\nPASS — per-way two-ways management verified"
    : `\nFAIL — ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
