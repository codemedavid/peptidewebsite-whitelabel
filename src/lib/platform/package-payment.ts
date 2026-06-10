// The platform's OWN receiving payment details shown on the public /get-started
// checkout step (how a new client pays for their package). Operator-editable in
// the Super Admin (/admin/payments) and persisted as the "package_payment"
// PlatformSetting row (or .demo-data/platform-settings.json in demo mode).
// The hardcoded PACKAGE_PAYMENT in marketing/config.ts is the fallback/default.
//
// Client-safe: no fs/prisma imports — types and pure helpers only.

import { PACKAGE_PAYMENT } from "@/marketing/config";

export const PACKAGE_PAYMENT_KEY = "package_payment";

export type PackagePaymentMethod = {
  id: string;
  method: string; // e.g. "GCash"
  account: string; // account holder name
  number: string; // account / reference number
  note: string; // short instruction shown under the method name
  qrUrl: string; // hosted QR image (ImageKit URL, or data URL in demo)
  active: boolean; // inactive methods are hidden from the checkout step
};

export type PackagePaymentConfig = {
  instructions: string;
  methods: PackagePaymentMethod[];
};

/** The hardcoded marketing-config details, lifted into the editable shape. */
export function defaultPackagePayment(): PackagePaymentConfig {
  return {
    instructions: PACKAGE_PAYMENT.instructions,
    methods: PACKAGE_PAYMENT.methods.map((m, i) => ({
      id: `pp${i + 1}`,
      method: m.method,
      account: m.account,
      number: m.number,
      note: m.note ?? "",
      qrUrl: m.qr ?? "",
      active: true,
    })),
  };
}

const MAX_METHODS = 12;

/** Sanitize an untrusted/stored value into a well-formed config (never throws). */
export function normalizePackagePayment(input: unknown): PackagePaymentConfig {
  const o = (input ?? {}) as Record<string, unknown>;
  const rawMethods = Array.isArray(o.methods) ? o.methods : [];
  return {
    instructions: String(o.instructions ?? "").slice(0, 1000),
    methods: rawMethods.slice(0, MAX_METHODS).map((m, i) => {
      const r = (m ?? {}) as Record<string, unknown>;
      return {
        id: String(r.id ?? `pp${i + 1}`).slice(0, 64),
        method: String(r.method ?? "").slice(0, 120),
        account: String(r.account ?? "").slice(0, 200),
        number: String(r.number ?? "").slice(0, 200),
        note: String(r.note ?? "").slice(0, 500),
        qrUrl: typeof r.qrUrl === "string" ? r.qrUrl : "",
        active: r.active !== false,
      };
    }),
  };
}

/** What the public checkout step renders: active methods with a name. */
export function visiblePackagePaymentMethods(config: PackagePaymentConfig): PackagePaymentMethod[] {
  return config.methods.filter((m) => m.active && m.method.trim());
}
