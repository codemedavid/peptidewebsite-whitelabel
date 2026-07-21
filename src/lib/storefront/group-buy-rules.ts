// Group Buy Rules Engine — per-tenant order rules for group-buy style stores.
// Configured by the store owner in the store admin ("Group Buy Rules", gated on
// the platform FEATURES.STORE_GROUP_BUY entitlement) and persisted in the shared
// branding.config blob as `groupBuyRules`. Shared between the admin editor, the
// cart drawer (client-side validation) and placeStorefrontOrderAction
// (server-side validation) so every surface evaluates the rules identically.
//
// The engine's admin-fee settings (fixed vs percentage) live on the EXISTING
// `branding.config.adminFee` key — see admin-fee.ts — so a store can never be
// charged two competing fees.

import { classifyProductClass, type ProductClass } from "./product-class";

export const GROUP_BUY_MAX_VIALS = 10_000;

/** Max ratio the owner can configure (guards a runaway auto-add / message). */
export const RATIO_MAX = 100;

/** How the ratio floor is enforced when a cart is short on bac water:
 *   • strict   — checkout is blocked until the cart complies;
 *   • warn     — a soft message shows, checkout still proceeds;
 *   • auto_add — the cart injects the shortfall automatically (a residual gap,
 *                e.g. bac water sold out, still blocks like strict). */
export type RatioMode = "strict" | "warn" | "auto_add";
export const RATIO_MODES: readonly RatioMode[] = ["strict", "warn", "auto_add"];

/** Order Ratio Control — a FLOOR requiring N bac water per peptide vial. Distinct
 *  from `bacWater.maxPerPeptide` (a CEILING). Store-wide (one rule, one default
 *  bac-water product), configurable ratio so 2:1 / 3:1 need no code change. */
export type GroupBuyRatio = {
  /** Off → the ratio floor is never enforced (the other rules still apply). */
  enabled: boolean;
  mode: RatioMode;
  /** Required bac water per peptide vial. Floored at 1, capped at RATIO_MAX. */
  bacWaterPerPeptide: number;
  /** The product auto_add mode injects to top up the cart. Required to save
   *  auto_add; null otherwise. */
  defaultBacWaterProductId: string | null;
  /** Custom customer-facing copy. `{ratio}` / `{shortfall}` / `{required}` /
   *  `{peptide}` interpolate. Blank → DEFAULT_RATIO_MESSAGE. */
  message: string;
};

export type GroupBuyRules = {
  /** Master switch for the whole engine — off → no rule is ever enforced. */
  enabled: boolean;
  minOrder: {
    /** Each cart line must hold at least this many units. 0 = no rule. */
    minVialsPerProduct: number;
    /** The cart as a whole must hold at least this many units. 0 = no rule. */
    minTotalVials: number;
  };
  bacWater: {
    /** Kill switch — true → bac water is never restricted, whatever else says. */
    restrictionsDisabled: boolean;
    /** Buyers may add any amount of bac water (the cap below is ignored). */
    allowUnlimited: boolean;
    /** Max bac water vials allowed PER peptide vial in the cart. 0 = no cap. */
    maxPerPeptide: number;
  };
  /** Order Ratio Control — the peptide→bac-water FLOOR (see GroupBuyRatio). */
  ratio: GroupBuyRatio;
  validation: {
    /** Enforce in the cart drawer — blocks "Checkout" until the cart complies. */
    cart: boolean;
    /** Enforce at order placement — the server rejects non-compliant orders. */
    checkout: boolean;
  };
};

export const DEFAULT_RATIO: GroupBuyRatio = {
  enabled: false,
  mode: "strict",
  bacWaterPerPeptide: 1,
  defaultBacWaterProductId: null,
  message: "",
};

export const DEFAULT_GROUP_BUY_RULES: GroupBuyRules = {
  enabled: false,
  minOrder: { minVialsPerProduct: 0, minTotalVials: 0 },
  bacWater: { restrictionsDisabled: false, allowUnlimited: false, maxPerPeptide: 0 },
  ratio: DEFAULT_RATIO,
  validation: { cart: true, checkout: true },
};

/** Built-in ratio copy when the owner hasn't customized a message. */
export const DEFAULT_RATIO_MESSAGE =
  "Every peptide needs {ratio} bacteriostatic water — add {shortfall} more to check out.";

/** Max message length, matching the checkout-rules message cap. */
export const RATIO_MESSAGE_MAX = 300;

function count(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n)
    ? Math.min(GROUP_BUY_MAX_VIALS, Math.max(0, Math.round(n)))
    : 0;
}

/** Coerce an untrusted value into a well-formed ratio block. */
function normalizeRatio(input: unknown): GroupBuyRatio {
  const x = (input ?? {}) as Record<string, unknown>;
  const mode = RATIO_MODES.includes(x.mode as RatioMode)
    ? (x.mode as RatioMode)
    : DEFAULT_RATIO.mode;
  const rawRatio = Number(x.bacWaterPerPeptide);
  const bacWaterPerPeptide = Number.isFinite(rawRatio)
    ? Math.min(RATIO_MAX, Math.max(1, Math.round(rawRatio)))
    : DEFAULT_RATIO.bacWaterPerPeptide;
  const id = x.defaultBacWaterProductId;
  return {
    enabled: x.enabled === true,
    mode,
    bacWaterPerPeptide,
    defaultBacWaterProductId: typeof id === "string" && id.trim() ? id : null,
    message: typeof x.message === "string" ? x.message.trim().slice(0, RATIO_MESSAGE_MAX) : "",
  };
}

/** Coerce an untrusted/legacy config value into well-formed GroupBuyRules. */
export function normalizeGroupBuyRules(input: unknown): GroupBuyRules {
  const x = (input ?? {}) as Record<string, unknown>;
  const mo = (x.minOrder ?? {}) as Record<string, unknown>;
  const bw = (x.bacWater ?? {}) as Record<string, unknown>;
  const va = (x.validation ?? {}) as Record<string, unknown>;
  return {
    enabled: x.enabled === true,
    minOrder: {
      minVialsPerProduct: count(mo.minVialsPerProduct),
      minTotalVials: count(mo.minTotalVials),
    },
    bacWater: {
      restrictionsDisabled: bw.restrictionsDisabled === true,
      allowUnlimited: bw.allowUnlimited === true,
      maxPerPeptide: count(bw.maxPerPeptide),
    },
    ratio: normalizeRatio(x.ratio),
    validation: {
      // Absent → on: enabling the engine without touching the toggles enforces.
      cart: va.cart !== false,
      checkout: va.checkout !== false,
    },
  };
}

const BAC_WATER_RE = /\bbac(?:teriostatic)?[\s_-]*water\b/i;

/**
 * Whether a cart line / order item is bacteriostatic water. Matched by NAME
 * (with the category as an extra signal when available) so the client cart and
 * the server order items — which only carry names — agree on every order.
 */
export function isBacWaterItem(name: string, category?: string): boolean {
  return BAC_WATER_RE.test(name) || (!!category && BAC_WATER_RE.test(category));
}

/** The minimal line shape both the cart (Product+qty) and the server
 *  (OrderItem) can produce. */
export type GroupBuyLine = { name: string; qty: number; category?: string };

/**
 * Every rule the given cart breaks, as customer-facing messages — empty when
 * the cart complies (or the engine is off). Bac water lines don't count toward
 * the vial minimums: those govern the peptides being grouped, while bac water
 * is the accessory the bac-water rules govern.
 */
export function groupBuyViolations(rules: GroupBuyRules, lines: GroupBuyLine[]): string[] {
  if (!rules.enabled) return [];
  const errors: string[] = [];

  const peptides = lines.filter((l) => !isBacWaterItem(l.name, l.category));
  const peptideVials = peptides.reduce((s, l) => s + l.qty, 0);
  const bacWaterVials = lines
    .filter((l) => isBacWaterItem(l.name, l.category))
    .reduce((s, l) => s + l.qty, 0);

  const { minVialsPerProduct, minTotalVials } = rules.minOrder;
  if (minVialsPerProduct > 0) {
    for (const l of peptides) {
      if (l.qty < minVialsPerProduct) {
        errors.push(
          `"${l.name}" needs at least ${minVialsPerProduct} vials (you have ${l.qty}).`,
        );
      }
    }
  }
  if (minTotalVials > 0 && peptideVials < minTotalVials) {
    errors.push(
      `Orders need at least ${minTotalVials} vials in total (you have ${peptideVials}).`,
    );
  }

  const { restrictionsDisabled, allowUnlimited, maxPerPeptide } = rules.bacWater;
  if (!restrictionsDisabled && !allowUnlimited && maxPerPeptide > 0 && bacWaterVials > 0) {
    const allowed = maxPerPeptide * peptideVials;
    if (bacWaterVials > allowed) {
      errors.push(
        allowed === 0
          ? "Add a peptide before adding bac water."
          : `Max ${maxPerPeptide} bac water per peptide vial — ${peptideVials} peptide vials allow ${allowed}, you have ${bacWaterVials}.`,
      );
    }
  }

  return errors;
}

// ── Order Ratio Control (the peptide → bac-water FLOOR) ──────────────────────

/** A line the ratio engine classifies. `productClass` is the admin's explicit
 *  per-product tag; when absent the name/category/sequence fallback decides
 *  (see product-class.ts). Both the cart (from Product) and the server (from
 *  OrderItem + the catalog) can build this shape. */
export type RatioLine = {
  name: string;
  qty: number;
  category?: string;
  sequence?: string;
  productClass?: ProductClass;
};

/** A ratio violation, shaped to slot straight into the cart's violation list. */
export type RatioViolation = { message: string; blocking: boolean };

/** Sum the cart's peptide vs bac-water vials; "other" products are ignored. */
export function ratioCounts(lines: RatioLine[]): { peptide: number; bacWater: number } {
  let peptide = 0;
  let bacWater = 0;
  for (const l of lines) {
    const qty = Math.max(0, l.qty || 0);
    const cls = classifyProductClass(l);
    if (cls === "peptide") peptide += qty;
    else if (cls === "bacWater") bacWater += qty;
  }
  return { peptide, bacWater };
}

/** Bac water the floor requires for `peptideQty` — ceil(qty × ratio). */
export function requiredBacWater(rules: GroupBuyRules, peptideQty: number): number {
  return Math.ceil(Math.max(0, peptideQty) * rules.ratio.bacWaterPerPeptide);
}

/** Interpolate the ratio message tokens. */
function ratioMessage(
  rules: GroupBuyRules,
  vars: { ratio: number; shortfall: number; required: number; peptide: number },
): string {
  let msg = rules.ratio.message || DEFAULT_RATIO_MESSAGE;
  for (const [k, v] of Object.entries(vars)) {
    msg = msg.split(`{${k}}`).join(String(v));
  }
  return msg;
}

/**
 * The ratio floor violation for a cart, or null when it complies. Fires only
 * when the engine AND the ratio block are enabled and the cart holds ≥1 peptide.
 * `blocking` is true for strict/auto_add (auto_add is not a bypass — a residual
 * gap, e.g. bac water sold out, must still stop checkout) and false for warn.
 */
export function ratioViolation(rules: GroupBuyRules, lines: RatioLine[]): RatioViolation | null {
  const r = rules.ratio;
  if (!rules.enabled || !r.enabled) return null;
  const { peptide, bacWater } = ratioCounts(lines);
  if (peptide <= 0) return null;
  const required = requiredBacWater(rules, peptide);
  if (bacWater >= required) return null;
  const shortfall = required - bacWater;
  return {
    message: ratioMessage(rules, { ratio: r.bacWaterPerPeptide, shortfall, required, peptide }),
    blocking: r.mode !== "warn",
  };
}

/**
 * How many bac-water units auto_add mode should inject so the cart meets the
 * floor. Zero in any other mode (or when the floor is already met / no peptides)
 * — the caller adds `shortfall` of the configured defaultBacWaterProductId,
 * clamped to stock.
 */
export function autoAddPlan(rules: GroupBuyRules, lines: RatioLine[]): { shortfall: number } {
  const r = rules.ratio;
  if (!rules.enabled || !r.enabled || r.mode !== "auto_add") return { shortfall: 0 };
  const { peptide, bacWater } = ratioCounts(lines);
  if (peptide <= 0) return { shortfall: 0 };
  return { shortfall: Math.max(0, requiredBacWater(rules, peptide) - bacWater) };
}
