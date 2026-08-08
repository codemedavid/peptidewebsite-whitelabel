// Self-contained gate for the STORE CURRENCY setting
// (src/lib/storefront/currency.ts). No DB, no React.
//
// Every price in this platform used to be a peso. The symbol was written into
// the markup — `"₱" + n.toLocaleString()` in a dozen admin files, `brand.currency
// || "₱"` on the storefront — so a store that sells in riyals, dirhams or
// dollars could not be built without editing source. This module makes the
// currency a per-tenant SETTING the owner picks, and one formatter every money
// figure goes through.
//
// The rules this gate pins:
//
//   • an absent / junk currency is a PESO — every tenant alive today stores
//     nothing here, and none of them may move
//   • a registry currency resolves by code OR by symbol, case-insensitively
//   • an UNKNOWN code still works: the platform must not ship a closed list,
//     or "any currency" is a lie
//   • a multi-character code is spaced off its amount — "SAR 200", never the
//     "SAR200" that today's `${currency}${price}` templates would produce
//   • a single-glyph symbol hugs its amount — "₱1,200.00", byte-identical to
//     the strings the admin prints today
//   • money that isn't a number is zero, not "NaN" in front of a customer
//
//   npm run test:currency

import {
  CURRENCIES,
  CURRENCY_DEFAULT,
  formatMoney,
  formatMoneyCents,
  normalizeCurrency,
  resolveBrandCurrency,
} from "../src/lib/storefront/currency";

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

console.log("store currency — the owner picks the money\n");

// ── The registry ────────────────────────────────────────────────────────────
// The picker renders straight from this list, so a malformed row is a broken
// admin screen. Codes are the identity: they must be unique and ISO-shaped.
console.log("CURRENCIES — the picker's source of truth");

check("the registry is a non-empty list", Array.isArray(CURRENCIES) && CURRENCIES.length > 0);
check(
  "every entry is complete",
  CURRENCIES.every(
    (c) =>
      /^[A-Z]{3}$/.test(c.code) &&
      typeof c.symbol === "string" &&
      c.symbol.length > 0 &&
      typeof c.label === "string" &&
      c.label.length > 0 &&
      [0, 2, 3].includes(c.decimals),
  ),
);
check(
  "symbols are unique",
  new Set(CURRENCIES.map((c) => c.symbol.toLowerCase())).size === CURRENCIES.length,
  "the symbol is a lookup key — a duplicate would resolve to the wrong currency",
);
check("codes are unique", new Set(CURRENCIES.map((c) => c.code)).size === CURRENCIES.length);
check("the peso is registered", CURRENCIES.some((c) => c.code === "PHP" && c.symbol === "₱"));
check("the riyal is registered", CURRENCIES.some((c) => c.code === "SAR"));
check(
  "zero-decimal currencies are modelled",
  CURRENCIES.some((c) => c.decimals === 0),
  "yen/won have no minor unit — formatting them with .00 is wrong",
);
check(
  "three-decimal currencies are modelled",
  CURRENCIES.some((c) => c.decimals === 3),
  "the Gulf dinars (KWD/BHD/OMR) use 3 — this store's region neighbours them",
);

// ── normalizeCurrency — untrusted branding.config.currency ───────────────────
// THE regression risk of this whole feature. ~30 live tenants have never
// touched this setting; every one of them must keep printing pesos.
console.log("\nnormalizeCurrency — fails safe to the PESO");

check("the default is the peso", CURRENCY_DEFAULT.code === "PHP" && CURRENCY_DEFAULT.symbol === "₱");
check("undefined → peso", eq(normalizeCurrency(undefined), CURRENCY_DEFAULT));
check("null → peso", eq(normalizeCurrency(null), CURRENCY_DEFAULT));
check("an empty string → peso", eq(normalizeCurrency(""), CURRENCY_DEFAULT));
check("whitespace → peso", eq(normalizeCurrency("   "), CURRENCY_DEFAULT));
check("a number → peso", eq(normalizeCurrency(0), CURRENCY_DEFAULT));
check("an array → peso", eq(normalizeCurrency(["SAR"]), CURRENCY_DEFAULT));
check("an object → peso", eq(normalizeCurrency({ code: "SAR" }), CURRENCY_DEFAULT));

// ── Resolution — by code, by symbol, either case ─────────────────────────────
// Stored values are inconsistent by history: branding.config.currency holds a
// SYMBOL ("₱"), StoreSettings.currency holds an ISO CODE ("PHP"), and product
// rows hold either. One resolver has to take all of them.
console.log("\nnormalizeCurrency — resolves a stored value however it was written");

check("an ISO code resolves", normalizeCurrency("SAR").code === "SAR");
check("a lowercase code resolves", normalizeCurrency("sar").code === "SAR");
check("a padded code resolves", normalizeCurrency("  SAR  ").code === "SAR");
check("the peso symbol resolves", normalizeCurrency("₱").code === "PHP");
check("the dollar symbol resolves", normalizeCurrency("$").code === "USD");
check("the euro symbol resolves", normalizeCurrency("€").code === "EUR");
check("PHP and ₱ resolve to the same currency", eq(normalizeCurrency("PHP"), normalizeCurrency("₱")));

// ── The open list — "any currency" has to mean any ───────────────────────────
// A closed registry would make the setting a lie the first time an owner sells
// somewhere we didn't anticipate. An unknown value is KEPT and formatted, not
// silently swapped for pesos.
console.log("\nnormalizeCurrency — an unregistered currency still works");

const custom = normalizeCurrency("ZMW");
check("an unknown ISO code is kept, not discarded", custom.code === "ZMW");
check("an unknown code is its own symbol", custom.symbol === "ZMW");
check("an unknown code is marked custom", custom.custom === true);
check("a registry currency is not marked custom", normalizeCurrency("SAR").custom === false);
const glyph = normalizeCurrency("₸");
check("an unknown SYMBOL is kept too", glyph.symbol === "₸");

// ── formatMoney — the one formatter ─────────────────────────────────────────
// Byte-compatibility with today's admin strings is the acceptance bar for the
// peso: `"₱" + n.toLocaleString()` and the order-detail's 2-decimal form.
console.log("\nformatMoney — the peso is unchanged");

check("a peso amount", formatMoney(1200, "₱") === "₱1,200.00");
check("a peso amount, no decimals", formatMoney(1200, "₱", { decimals: false }) === "₱1,200");
check("thousands are grouped", formatMoney(1234567.5, "PHP") === "₱1,234,567.50");
check("the default currency is the peso", formatMoney(1200) === "₱1,200.00");
check("a symbol hugs its amount", !formatMoney(1200, "₱").includes(" "));

console.log("\nformatMoney — a multi-character code is spaced");

check("a riyal amount", formatMoney(200, "SAR") === "SAR 200.00");
check("a riyal amount, no decimals", formatMoney(200, "SAR", { decimals: false }) === "SAR 200");
check(
  "the code never glues to the digits",
  !/SAR\d/.test(formatMoney(200, "SAR")),
  "this is the bug `${currency}${price}` templates ship today",
);
check("an unregistered code is spaced too", formatMoney(200, "ZMW") === "ZMW 200.00");

console.log("\nformatMoney — the awkward inputs");

check("NaN is zero", formatMoney(Number.NaN, "₱") === "₱0.00");
check("undefined is zero", formatMoney(undefined as unknown as number, "₱") === "₱0.00");
check("Infinity is zero", formatMoney(Number.POSITIVE_INFINITY, "₱") === "₱0.00");
check("a numeric string is read", formatMoney("1200" as unknown as number, "₱") === "₱1,200.00");
check("zero prints", formatMoney(0, "SAR") === "SAR 0.00");
check("the sign leads the symbol", formatMoney(-50, "₱") === "-₱50.00");
check(
  "a zero-decimal currency drops the minor unit",
  formatMoney(1200, "JPY") === "¥1,200",
  "¥1,200.00 is not how yen is written",
);

console.log("\nformatMoneyCents — the DB stores integer cents");

check("cents become major units", formatMoneyCents(120000, "₱") === "₱1,200.00");
check("a riyal price", formatMoneyCents(20000, "SAR") === "SAR 200.00");
check("rounding is not lossy", formatMoneyCents(199, "₱") === "₱1.99");
check("NaN cents are zero", formatMoneyCents(Number.NaN, "SAR") === "SAR 0.00");

// ── resolveBrandCurrency — what every surface calls ─────────────────────────
// The storefront reads `brand.currency`; products carry their own captured
// symbol. Brand WINS, or an owner who switches currency keeps seeing the old
// one on every product card that was created before the switch.
console.log("\nresolveBrandCurrency — the brand is the authority");

check("the brand's currency is used", resolveBrandCurrency({ currency: "SAR" }).code === "SAR");
check("a brand with no currency is pesos", resolveBrandCurrency({}).code === "PHP");
check("a null brand is pesos", resolveBrandCurrency(null).code === "PHP");
check(
  "the brand beats a stale product symbol",
  resolveBrandCurrency({ currency: "SAR" }, "₱").code === "SAR",
  "product rows captured ₱ before the switch — they must not win",
);
check(
  "a product symbol is the fallback when the brand is silent",
  resolveBrandCurrency({}, "SAR").code === "SAR",
);

// ── Purity ──────────────────────────────────────────────────────────────────
console.log("\nthe module never mutates its input");

const brand = { currency: "SAR" };
const before = JSON.stringify(brand);
resolveBrandCurrency(brand);
normalizeCurrency(brand.currency);
formatMoney(10, brand.currency);
check("the brand object is untouched", JSON.stringify(brand) === before);

console.log(
  failures === 0 ? "\nAll currency checks passed." : `\n${failures} currency check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
