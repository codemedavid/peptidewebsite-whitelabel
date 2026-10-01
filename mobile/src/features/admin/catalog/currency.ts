/**
 * The store-currency rules, re-derived from src/lib/storefront/currency.ts (the
 * app can't import website code). saveCurrencyAction re-normalizes whatever we
 * send, so this only drives the picker and the preview.
 */

export type Currency = { code: string; symbol: string; label: string; decimals: number; custom: boolean };

type Entry = Omit<Currency, "custom">;

/** The website picker's list, in the website's order. */
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

const fromEntry = (e: Entry, custom = false): Currency => ({ ...e, custom });
const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));
const BY_SYMBOL = new Map(CURRENCIES.map((c) => [c.symbol.toLowerCase(), c]));
const PESO = fromEntry(BY_CODE.get("PHP") as Entry);

/** A code or a symbol → a printable currency. Junk falls back to the peso; the unknown is kept as custom. */
export function normalizeCurrency(value: unknown): Currency {
  if (typeof value !== "string" || !value.trim()) return { ...PESO };
  const raw = value.trim();
  const known = BY_CODE.get(raw.toUpperCase()) ?? BY_SYMBOL.get(raw.toLowerCase());
  if (known) return fromEntry(known);
  const isoLike = /^[A-Za-z]{3}$/.test(raw);
  return {
    code: isoLike ? raw.toUpperCase() : "",
    symbol: isoLike ? raw.toUpperCase() : raw.slice(0, 8),
    label: isoLike ? raw.toUpperCase() : `Custom (${raw.slice(0, 8)})`,
    decimals: 2,
    custom: true,
  };
}

/** THE money format: word-like symbols get a space ("SAR 1,500.00"), glyphs hug ("₱1,500.00"). */
export function formatMoney(amount: number, currency: unknown, opts?: { decimals?: boolean }): string {
  const money = normalizeCurrency(currency);
  const digits = opts?.decimals === false ? 0 : money.decimals;
  const value = Number.isFinite(amount) ? amount : 0;
  const body = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const gap = /[A-Za-z]{2,}/.test(money.symbol) ? " " : "";
  return `${value < 0 ? "-" : ""}${money.symbol}${gap}${body}`;
}
