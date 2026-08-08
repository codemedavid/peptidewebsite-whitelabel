// The STORE CURRENCY setting — the owner picks the money their shop trades in.
//
// This platform was born selling pesos, and the peso was written into the
// markup: a dozen admin files build money as `"₱" + n.toLocaleString()`, and the
// storefront reads `brand.currency || "₱"`. That made a non-PHP store
// impossible to configure — it needed a code change. This module makes the
// currency a per-tenant SETTING (branding.config.currency, owner-editable) and
// gives every money figure ONE formatter, so a store can trade in riyals,
// dirhams or dollars without touching source.
//
// Two rules carry the whole design:
//
//   FAILS SAFE TO THE PESO. ~30 tenants are live right now and not one of them
//   has ever written this setting. Absent, empty or junk config resolves to ₱,
//   so shipping this changes nothing for any of them.
//
//   THE LIST IS OPEN. A registry of "currencies we thought of" would break the
//   first time an owner sells somewhere we didn't anticipate. An unrecognised
//   code or symbol is KEPT and formatted sensibly, marked `custom`. "Any
//   currency" has to mean any.
//
// Spacing is derived, not stored: a word-like symbol ("SAR", "AED") is spaced
// off its amount, a glyph ("₱", "$", "S$") hugs it. That is what fixes the
// `${currency}${price}` templates the cart ships today, which render "SAR200".
// The rule reads two-or-more consecutive letters as word-like, so "S$200" stays
// correct while "SAR 200" gains its space. Multi-letter glyph-ish codes like
// "RM" get a space too — readable, if not the local convention.
//
// Pure + JSON-safe (no React, no DB) so the storefront, the store admin and the
// server share one contract — the same pattern as ./store-status and
// ./two-ways-mode. Covered by npm run test:currency.

/** A currency the storefront can price and format in. */
export type Currency = {
  /** ISO 4217 where we know it ("SAR"). Empty for a bare custom glyph. */
  code: string;
  /** What is printed next to the amount ("₱", "SAR"). Never empty. */
  symbol: string;
  /** Human label for the owner's picker. */
  label: string;
  /** Minor-unit digits: 0 (yen), 2 (most), 3 (Gulf dinars). */
  decimals: number;
  /** True when this came from outside the registry — see "the list is open". */
  custom: boolean;
};

type Entry = Omit<Currency, "custom">;

/**
 * The picker's list. Ordered by how likely this platform's tenants are to want
 * them: the home currency first, then the Gulf (where the client base is
 * expanding), then the rest of Asia-Pacific and the majors.
 *
 * Symbols must stay UNIQUE — they're a lookup key, because stored config holds
 * a symbol ("₱") where StoreSettings holds a code ("PHP").
 */
export const CURRENCIES: Entry[] = [
  { code: "PHP", symbol: "₱", label: "Philippine Peso", decimals: 2 },
  { code: "SAR", symbol: "SAR", label: "Saudi Riyal", decimals: 2 },
  { code: "AED", symbol: "AED", label: "UAE Dirham", decimals: 2 },
  { code: "QAR", symbol: "QAR", label: "Qatari Riyal", decimals: 2 },
  { code: "KWD", symbol: "KWD", label: "Kuwaiti Dinar", decimals: 3 },
  { code: "BHD", symbol: "BHD", label: "Bahraini Dinar", decimals: 3 },
  { code: "OMR", symbol: "OMR", label: "Omani Rial", decimals: 3 },
  { code: "USD", symbol: "$", label: "US Dollar", decimals: 2 },
  { code: "EUR", symbol: "€", label: "Euro", decimals: 2 },
  { code: "GBP", symbol: "£", label: "British Pound", decimals: 2 },
  { code: "SGD", symbol: "S$", label: "Singapore Dollar", decimals: 2 },
  { code: "AUD", symbol: "A$", label: "Australian Dollar", decimals: 2 },
  { code: "CAD", symbol: "C$", label: "Canadian Dollar", decimals: 2 },
  { code: "MYR", symbol: "RM", label: "Malaysian Ringgit", decimals: 2 },
  { code: "THB", symbol: "฿", label: "Thai Baht", decimals: 2 },
  { code: "IDR", symbol: "Rp", label: "Indonesian Rupiah", decimals: 0 },
  { code: "VND", symbol: "₫", label: "Vietnamese Dong", decimals: 0 },
  { code: "JPY", symbol: "¥", label: "Japanese Yen", decimals: 0 },
  { code: "KRW", symbol: "₩", label: "South Korean Won", decimals: 0 },
  { code: "INR", symbol: "₹", label: "Indian Rupee", decimals: 2 },
  { code: "HKD", symbol: "HK$", label: "Hong Kong Dollar", decimals: 2 },
  { code: "TWD", symbol: "NT$", label: "New Taiwan Dollar", decimals: 2 },
];

/** Build the public shape from a registry row. One place, so every returned
 *  object has identical key order (callers compare them serialized). */
function fromEntry(entry: Entry, custom = false): Currency {
  return {
    code: entry.code,
    symbol: entry.symbol,
    label: entry.label,
    decimals: entry.decimals,
    custom,
  };
}

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));
const BY_SYMBOL = new Map(CURRENCIES.map((c) => [c.symbol.toLowerCase(), c]));

/** The peso — today's behavior, and the fallback for anything unrecognised. */
export const CURRENCY_DEFAULT: Currency = fromEntry(BY_CODE.get("PHP") as Entry);

/**
 * Coerce an untrusted stored currency into one we can print.
 *
 * Accepts either half of the platform's split history: a SYMBOL (how
 * branding.config.currency has always been written) or an ISO CODE (how
 * StoreSettings.currency and Product.currency are written). Case and padding
 * are forgiven — this value has round-tripped through JSON and form posts.
 *
 * Anything that isn't a usable string resolves to the PESO, so a tenant that
 * has never touched the setting keeps exactly the store it has today. A string
 * we don't recognise is kept as a custom currency rather than being silently
 * turned into pesos — quietly repricing someone's shop would be far worse than
 * printing an unfamiliar code.
 *
 * Always returns a NEW object; the input is never mutated.
 */
export function normalizeCurrency(value: unknown): Currency {
  if (typeof value !== "string") return { ...CURRENCY_DEFAULT };
  const raw = value.trim();
  if (!raw) return { ...CURRENCY_DEFAULT };

  const byCode = BY_CODE.get(raw.toUpperCase());
  if (byCode) return fromEntry(byCode);

  const bySymbol = BY_SYMBOL.get(raw.toLowerCase());
  if (bySymbol) return fromEntry(bySymbol);

  // Unregistered. An ISO-shaped value is treated as a code (and prints as one);
  // anything else is a bare glyph with no ISO identity we can honestly claim.
  const isoLike = /^[A-Za-z]{3}$/.test(raw);
  return {
    code: isoLike ? raw.toUpperCase() : "",
    symbol: isoLike ? raw.toUpperCase() : raw.slice(0, 8),
    label: isoLike ? raw.toUpperCase() : `Custom (${raw.slice(0, 8)})`,
    decimals: 2,
    custom: true,
  };
}

/** Word-like symbols get a space; glyphs hug the digits. See the header note. */
function needsSpace(symbol: string): boolean {
  return /[A-Za-z]{2,}/.test(symbol);
}

/** Anything non-finite is zero: "NaN" must never reach a customer's screen. */
function toAmount(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export type FormatMoneyOptions = {
  /** false drops the minor unit entirely ("₱1,200"), for dense admin tables
   *  that have always printed rounded pesos. Defaults to the currency's own
   *  precision. */
  decimals?: boolean;
};

/**
 * THE money formatter. Every store-facing amount — catalog, cart, checkout,
 * order detail, admin dashboard — goes through this, so a tenant's currency can
 * never be right on one screen and wrong on the next.
 *
 * Not to be confused with lib/admin/plans.ts `formatPesos`, which prices the
 * SaaS subscription the tenant pays US. That one is peso by definition and must
 * not follow the store's currency.
 *
 * The sign leads the whole figure ("-₱50.00"), which is how a negative amount
 * reads in every locale we serve.
 */
export function formatMoney(
  amount: number,
  currency?: unknown,
  opts?: FormatMoneyOptions,
): string {
  const money = normalizeCurrency(currency);
  const digits = opts?.decimals === false ? 0 : money.decimals;
  const value = toAmount(amount);

  const body = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  const sign = value < 0 ? "-" : "";
  const gap = needsSpace(money.symbol) ? " " : "";
  return `${sign}${money.symbol}${gap}${body}`;
}

/** Same, for the integer minor units the DB stores (Product.priceCents). */
export function formatMoneyCents(
  cents: number,
  currency?: unknown,
  opts?: FormatMoneyOptions,
): string {
  return formatMoney(toAmount(cents) / 100, currency, opts);
}

/** The brand blob a storefront surface holds. Loose on purpose: callers pass
 *  `brand` straight through, and mid-onboarding tenants have sparse config. */
type BrandLike = { currency?: unknown } | null | undefined;

/**
 * Resolve the currency a surface should print, given the brand and (optionally)
 * a symbol captured on a product row.
 *
 * The BRAND WINS. Product rows store the symbol that was current when they were
 * created (product-mapping stamps `metadata.currencySymbol`), so an owner who
 * switches currency would otherwise keep seeing the old one on every card made
 * before the switch — a store showing two currencies at once. The product
 * symbol is only a fallback for a brand that hasn't set one.
 */
export function resolveBrandCurrency(brand: BrandLike, productSymbol?: unknown): Currency {
  const fromBrand = typeof brand?.currency === "string" ? brand.currency.trim() : "";
  if (fromBrand) return normalizeCurrency(fromBrand);
  return normalizeCurrency(productSymbol);
}
