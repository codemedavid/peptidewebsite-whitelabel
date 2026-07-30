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

/** How the ratio rule is enforced when a cart doesn't comply:
 *   • strict   — checkout is blocked until the cart complies;
 *   • warn     — a soft message shows, checkout still proceeds;
 *   • auto_add — the cart injects the shortfall automatically (a residual gap,
 *                e.g. bac water sold out, still blocks like strict). FLOOR only:
 *                a surplus can't be fixed by adding, so under `cap` this mode
 *                blocks like strict and never injects. */
export type RatioMode = "strict" | "warn" | "auto_add";
export const RATIO_MODES: readonly RatioMode[] = ["strict", "warn", "auto_add"];

/** Which way the peptide ↔ bac-water ratio is enforced:
 *   • floor — every peptide REQUIRES N bac water ("add 2 more to check out"),
 *             so a peptide-only cart is blocked until water is added.
 *   • cap   — bac water may not EXCEED N per peptide vial. A peptide-only cart
 *             is always fine (there is nothing to cap); only a surplus of water
 *             violates. A cart holding water but no peptide is blocked, since
 *             0 peptides allow 0 water.
 * "floor" is the default so every config stored before this switch existed keeps
 * meaning exactly what it meant when it was saved. */
export type RatioDirection = "floor" | "cap";
export const RATIO_DIRECTIONS: readonly RatioDirection[] = ["floor", "cap"];

/** Order Ratio Control — the peptide ↔ bac-water ratio rule, enforced as a FLOOR
 *  or a CAP (see RatioDirection). The `cap` direction supersedes the older
 *  `bacWater.maxPerPeptide` ceiling, which stays for tenants still on it.
 *  Store-wide (one rule, one default bac-water product), configurable ratio so
 *  2:1 / 3:1 need no code change. */
export type GroupBuyRatio = {
  /** Off → the ratio rule is never enforced (the other rules still apply). */
  enabled: boolean;
  /** Floor (require water) vs cap (limit water). Defaults to "floor". */
  direction: RatioDirection;
  mode: RatioMode;
  /** Bac water per peptide vial — REQUIRED under floor, ALLOWED under cap.
   *  Floored at 1, capped at RATIO_MAX. */
  bacWaterPerPeptide: number;
  /** The product auto_add mode injects to top up the cart. Required to save
   *  auto_add; null otherwise. Floor direction only. */
  defaultBacWaterProductId: string | null;
  /** Custom customer-facing copy. Floor tokens: `{ratio}` / `{shortfall}` /
   *  `{required}` / `{peptide}`. Cap tokens: `{ratio}` / `{peptide}` /
   *  `{allowed}` / `{bacWater}` / `{surplus}`. Blank → the direction's built-in
   *  default (DEFAULT_RATIO_MESSAGE / DEFAULT_CAP_MESSAGE). */
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
  direction: "floor",
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

/** Built-in FLOOR copy when the owner hasn't customized a message. */
export const DEFAULT_RATIO_MESSAGE =
  "Every peptide needs {ratio} bacteriostatic water — add {shortfall} more to check out.";

/** Built-in CAP copy. Never tells the customer to add water — the cart already
 *  has too much — and never fires on a peptide-only cart. */
export const DEFAULT_CAP_MESSAGE =
  "Bacteriostatic water can't exceed your peptide vials — {peptide} peptide vials allow {allowed}, you have {bacWater}. Please remove {surplus}.";

/** Built-in CAP copy for a cart holding bac water but no peptide at all. */
export const DEFAULT_CAP_NO_PEPTIDE_MESSAGE =
  "Add a peptide before adding bacteriostatic water.";

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
  const direction = RATIO_DIRECTIONS.includes(x.direction as RatioDirection)
    ? (x.direction as RatioDirection)
    : DEFAULT_RATIO.direction;
  const id = x.defaultBacWaterProductId;
  return {
    enabled: x.enabled === true,
    direction,
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

  // The legacy per-peptide ceiling. Skipped when Order Ratio Control is running
  // as a CAP: that rule enforces the same limit with the admin's per-product
  // classification and the owner's copy, so running both would show the customer
  // two near-identical messages for one problem.
  const { restrictionsDisabled, allowUnlimited, maxPerPeptide } = rules.bacWater;
  const capOwnsTheLimit = rules.ratio.enabled && rules.ratio.direction === "cap";
  if (
    !capOwnsTheLimit &&
    !restrictionsDisabled &&
    !allowUnlimited &&
    maxPerPeptide > 0 &&
    bacWaterVials > 0
  ) {
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

/** The most bac water the CAP allows for `peptideQty` — qty × ratio. No peptides
 *  → 0, so a water-only cart has nothing to measure against. */
export function allowedBacWater(rules: GroupBuyRules, peptideQty: number): number {
  return Math.max(0, Math.floor(peptideQty)) * rules.ratio.bacWaterPerPeptide;
}

/** Interpolate the ratio message tokens against the owner's copy, or `fallback`
 *  when they haven't customized one. */
function ratioMessage(
  rules: GroupBuyRules,
  fallback: string,
  vars: Record<string, number>,
): string {
  let msg = rules.ratio.message || fallback;
  for (const [k, v] of Object.entries(vars)) {
    msg = msg.split(`{${k}}`).join(String(v));
  }
  return msg;
}

/**
 * The ratio violation for a cart, or null when it complies. Fires only when the
 * engine AND the ratio block are enabled. `blocking` is true for strict/auto_add
 * (auto_add is not a bypass — a residual floor gap, e.g. bac water sold out, must
 * still stop checkout; and under a cap it can't help at all) and false for warn.
 *
 * Floor: needs ≥1 peptide, then the cart must carry `required` water.
 * Cap: needs ≥1 bac water — a peptide-only (or water-free) cart is always fine —
 * then the water must not exceed `allowed`. Water with no peptide is blocked
 * because 0 peptides allow 0 water.
 */
export function ratioViolation(rules: GroupBuyRules, lines: RatioLine[]): RatioViolation | null {
  const r = rules.ratio;
  if (!rules.enabled || !r.enabled) return null;
  const { peptide, bacWater } = ratioCounts(lines);
  const blocking = r.mode !== "warn";

  if (r.direction === "cap") {
    // Nothing to cap: the customer is buying peptides only (or nothing at all).
    if (bacWater <= 0) return null;
    if (peptide <= 0) {
      return { message: r.message || DEFAULT_CAP_NO_PEPTIDE_MESSAGE, blocking };
    }
    const allowed = allowedBacWater(rules, peptide);
    if (bacWater <= allowed) return null;
    return {
      message: ratioMessage(rules, DEFAULT_CAP_MESSAGE, {
        ratio: r.bacWaterPerPeptide,
        peptide,
        allowed,
        bacWater,
        surplus: bacWater - allowed,
      }),
      blocking,
    };
  }

  if (peptide <= 0) return null;
  const required = requiredBacWater(rules, peptide);
  if (bacWater >= required) return null;
  const shortfall = required - bacWater;
  return {
    message: ratioMessage(rules, DEFAULT_RATIO_MESSAGE, {
      ratio: r.bacWaterPerPeptide,
      shortfall,
      required,
      peptide,
    }),
    blocking,
  };
}

/**
 * How many bac-water units auto_add mode should inject so the cart meets the
 * floor. Zero in any other mode (or when the floor is already met / no peptides)
 * — the caller adds `shortfall` of the configured defaultBacWaterProductId,
 * clamped to stock. Always zero under the CAP direction: injecting water there
 * would create the very surplus the cap blocks.
 */
export function autoAddPlan(rules: GroupBuyRules, lines: RatioLine[]): { shortfall: number } {
  const r = rules.ratio;
  if (!rules.enabled || !r.enabled || r.mode !== "auto_add" || r.direction !== "floor") {
    return { shortfall: 0 };
  }
  const { peptide, bacWater } = ratioCounts(lines);
  if (peptide <= 0) return { shortfall: 0 };
  return { shortfall: Math.max(0, requiredBacWater(rules, peptide) - bacWater) };
}
