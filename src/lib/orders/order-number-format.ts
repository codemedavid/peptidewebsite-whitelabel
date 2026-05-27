/**
 * Pure (isomorphic) helpers for per-tenant order-number formats.
 *
 * Keep this module free of server-only imports (prisma, node:fs) — it is shared
 * by client wizards/editors and the server-side generator alike. The actual
 * collision-safe / atomic generator lives in ./order-number.ts.
 */

export type OrderNumberScheme = "random" | "sequential";

export type OrderNumberFormat = {
  prefix: string; // ^[A-Z0-9]{2,6}$
  separator: string; // joins prefix and number, e.g. "-"
  scheme: OrderNumberScheme;
  digits: number; // zero-padded width of the numeric part (3–8)
};

export const PREFIX_RE = /^[A-Z0-9]{2,6}$/;
export const MIN_DIGITS = 3;
export const MAX_DIGITS = 8;
export const SEQ_START = 1000; // Tenant.orderSeq default; first order is SEQ_START + 1

/**
 * Initials of a business name → a sane default prefix.
 *   "Acme Peptides" → "AP"   (multi-word: first letters)
 *   "Acme"          → "ACME" (single word: the word itself, capped at 6)
 */
export function defaultPrefixFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words
    .map((w) => w.replace(/[^A-Za-z0-9]/g, "")[0] ?? "")
    .join("")
    .toUpperCase();
  const alnum = name.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const base = (initials.length >= 2 ? initials : alnum).slice(0, 6);
  // Guarantee the 2–6 char rule even for degenerate one-character names.
  return base.length >= 2 ? base : (base + "ORD").slice(0, 3);
}

/** The out-of-the-box format for a brand new tenant: NAME-INITIALS, "-", sequential, 4 digits. */
export function defaultOrderNumberFormat(name: string): OrderNumberFormat {
  return { prefix: defaultPrefixFromName(name), separator: "-", scheme: "sequential", digits: 4 };
}

/** Validate a prefix. Returns null when valid, else a human-readable message. */
export function validatePrefix(prefix: string): string | null {
  if (!PREFIX_RE.test(prefix)) {
    return "Prefix must be 2–6 upper-case letters or digits (A–Z, 0–9).";
  }
  return null;
}

/**
 * Coerce an untrusted value (Prisma Json, form input, .demo-data blob) into a
 * complete, valid OrderNumberFormat — filling any missing/invalid field from
 * the default derived from `fallbackName`.
 */
export function normalizeOrderNumberFormat(
  raw: unknown,
  fallbackName = "Order",
): OrderNumberFormat {
  const base = defaultOrderNumberFormat(fallbackName);
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof OrderNumberFormat, unknown>>;

  const prefix = typeof r.prefix === "string" && PREFIX_RE.test(r.prefix.toUpperCase())
    ? r.prefix.toUpperCase()
    : base.prefix;

  const separator = typeof r.separator === "string" ? r.separator.slice(0, 3) : base.separator;

  const scheme: OrderNumberScheme = r.scheme === "random" || r.scheme === "sequential" ? r.scheme : base.scheme;

  const digitsNum = typeof r.digits === "number" ? r.digits : Number(r.digits);
  const digits = Number.isFinite(digitsNum)
    ? Math.min(MAX_DIGITS, Math.max(MIN_DIGITS, Math.trunc(digitsNum)))
    : base.digits;

  return { prefix, separator, scheme, digits };
}

/** Zero-pad a number to the format's width: formatNumber(1001, fmt) → "ABC-1001". */
export function formatOrderNumber(format: OrderNumberFormat, n: number): string {
  return `${format.prefix}${format.separator}${String(n).padStart(format.digits, "0")}`;
}

/** A representative example for previews (sequential shows the first real number). */
export function sampleOrderNumber(format: OrderNumberFormat): string {
  const n = format.scheme === "sequential" ? SEQ_START + 1 : 4 * 10 ** (format.digits - 1) + 217;
  return formatOrderNumber(format, n % 10 ** format.digits || n);
}
