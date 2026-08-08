// Self-contained gate for the CURRENCY SWEEP — the surfaces that print a
// tenant's money must print the tenant's CURRENCY.
//
// src/lib/storefront/currency.ts made the currency a per-tenant setting. That
// alone changes nothing: the money on screen is still built by a dozen local
// formatters written when every store sold pesos. This gate pins the two
// defects that sweep has to clear, and the boundary it must NOT cross.
//
// DEFECT A — surfaces that ignore the setting outright. The store-admin
// dashboard, orders table, analytics tiles and order detail all build money as
// `"₱" + n.toLocaleString()`. A Saudi store that has set SAR still reads its own
// revenue in pesos, because these never look at the brand at all.
//
// DEFECT B — the glue. Surfaces that DO read `brand.currency` concatenate it
// (`${currency}${amount}`), which was invisible while the symbol was a single
// glyph. The moment the currency is a word-like code the storefront renders
// "SAR1,200" — a price no shopper can read. Spacing is not cosmetic here; it is
// the difference between a legible price and a typo.
//
// THE BOUNDARY — not every ₱ in this repo is the tenant's money. The SaaS
// subscription the tenant pays US is billed in pesos by definition, whatever
// currency their shop trades in. A sweep that "fixed" those would reprice the
// operator's own revenue, so this gate asserts they still say ₱. Over-sweeping
// is a real failure mode, and it fails here loudly.
//
//   npm run test:currency-surfaces

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formatGbMoney } from "../src/lib/storefront/group-buy-page";
import { optionLabel } from "../src/lib/storefront/variations";
import * as orderDetail from "../src/storefront/admin/order-detail";
import * as adminDashboard from "../src/lib/storefront/admin-dashboard";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** A hardcoded peso in EXECUTABLE code. Comments and doc examples are allowed to
 *  say "₱1,200" — they document the peso case, they don't render it. Stripping
 *  them first is what keeps this gate about behavior instead of prose. */
function codeWithoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/(?<=\S)[ \t]+\/\/.*$/gm, "");
}
const hardcodesPeso = (rel: string) => codeWithoutComments(read(rel)).includes("₱");

console.log("currency sweep — a tenant's money prints in the tenant's currency\n");

// ── Defect B: the glue ──────────────────────────────────────────────────────
// These two already TAKE a currency, so they look correct. They are the ones
// that ship "SAR1,200" today.
console.log("the currency never glues to the digits");

check(
  "a group-buy price is spaced from a word-like code",
  formatGbMoney("SAR", 1200) === "SAR 1,200",
  `got "${formatGbMoney("SAR", 1200)}" — the shopper reads "SAR1,200"`,
);
check(
  "a group-buy price still hugs a glyph",
  formatGbMoney("₱", 1200) === "₱1,200",
  "the peso store must not gain a space",
);
check(
  "a variation pill is spaced from a word-like code",
  optionLabel({ name: "Vials only", price: 2500 } as never, "SAR") === "Vials only · SAR 2,500",
  `got "${optionLabel({ name: "Vials only", price: 2500 } as never, "SAR")}"`,
);
check(
  "a variation pill still hugs a glyph",
  optionLabel({ name: "Vials only", price: 2500 } as never, "₱") === "Vials only · ₱2,500",
);

// ── Defect A: surfaces blind to the setting ─────────────────────────────────
// Both of these format money with no way to say WHICH money. The fix is a
// currency parameter, so the test is: can you even ask for riyals?
console.log("\nthe store admin can be asked for a currency");

const orderMoney = (orderDetail as Record<string, unknown>).formatOrderMoney;
check("order detail exposes a currency-aware formatter", typeof orderMoney === "function");
if (typeof orderMoney === "function") {
  const f = orderMoney as (n: number, currency?: unknown) => string;
  check("an order total in riyals", f(1200, "SAR") === "SAR 1,200.00", `got "${f(1200, "SAR")}"`);
  check("an order total in pesos is byte-identical to today", f(1200, "₱") === "₱1,200.00");
  check("a currency-less call is still the peso", f(1200) === "₱1,200.00");
  check("NaN is still zero", f(Number.NaN, "SAR") === "SAR 0.00");
}

const dashMoney = (adminDashboard as Record<string, unknown>).formatDashboardMoney;
check("the dashboard exposes a currency-aware formatter", typeof dashMoney === "function");
if (typeof dashMoney === "function") {
  const f = dashMoney as (n: number, currency?: unknown) => string;
  check("dashboard revenue in riyals", f(1200, "SAR") === "SAR 1,200", `got "${f(1200, "SAR")}"`);
  check(
    "dashboard revenue in pesos is byte-identical to today",
    f(1200, "₱") === "₱1,200",
    "the dashboard has always shown whole pesos — that must not change",
  );
  check("a currency-less call is still the peso", f(1200) === "₱1,200");
}

// ── Defect A, the components ────────────────────────────────────────────────
// These build money inline in JSX. There is no function to call, so the
// guarantee is structural: the peso may not be spelled in their code.
console.log("\nno store-admin surface spells the peso in its code");

const SWEPT = [
  "src/storefront/admin/AdminAnalytics.tsx",
  "src/storefront/admin/AdminOrders.tsx",
  "src/storefront/admin/AdminDashboard.tsx",
  "src/storefront/admin/order-detail.ts",
  "src/lib/storefront/admin-dashboard.ts",
];
for (const rel of SWEPT) {
  check(`${rel} reads the setting`, !hardcodesPeso(rel), "a literal ₱ remains in executable code");
}

// The tenant's own catalog is loaded with an explicit display symbol. Passing
// the literal "₱" there overrides whatever the owner chose — the storefront
// would render the right currency on one path and pesos on another.
console.log("\nthe catalog is loaded in the tenant's currency");

check(
  "order actions do not force the peso onto product rows",
  !/dbProductToStorefront\([^)]*"₱"/.test(read("src/actions/orders.ts")),
  'src/actions/orders.ts still passes a literal "₱" into dbProductToStorefront',
);

// ── The boundary ────────────────────────────────────────────────────────────
// The SaaS fee the tenant pays the operator is pesos regardless of what their
// shop sells. If a sweep reaches these, it has repriced the wrong business.
console.log("\nthe operator's own revenue is still pesos");

const PLATFORM = [
  "src/lib/admin/plans.ts",
  "src/storefront/admin/AdminBilling.tsx",
  "src/components/admin/shell/primitives.tsx",
];
for (const rel of PLATFORM) {
  check(
    `${rel} still prices the subscription in pesos`,
    hardcodesPeso(rel),
    "the sweep went too far — this bills the operator, not the shopper",
  );
}

console.log(
  failures === 0
    ? "\nAll currency-surface checks passed."
    : `\n${failures} currency-surface check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
