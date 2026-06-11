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

export const GROUP_BUY_MAX_VIALS = 10_000;

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
  validation: {
    /** Enforce in the cart drawer — blocks "Checkout" until the cart complies. */
    cart: boolean;
    /** Enforce at order placement — the server rejects non-compliant orders. */
    checkout: boolean;
  };
};

export const DEFAULT_GROUP_BUY_RULES: GroupBuyRules = {
  enabled: false,
  minOrder: { minVialsPerProduct: 0, minTotalVials: 0 },
  bacWater: { restrictionsDisabled: false, allowUnlimited: false, maxPerPeptide: 0 },
  validation: { cart: true, checkout: true },
};

function count(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n)
    ? Math.min(GROUP_BUY_MAX_VIALS, Math.max(0, Math.round(n)))
    : 0;
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
