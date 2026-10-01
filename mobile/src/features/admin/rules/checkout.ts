/**
 * Smart Checkout (lib/storefront/checkout-rules) and Order Ratio Control
 * (lib/storefront/group-buy-rules) — the shapes, defaults and normalizers the
 * website editors run before a save. The server re-normalizes every save.
 */

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const bool = (v: unknown, dflt: boolean): boolean => (typeof v === "boolean" ? v : dflt);
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ── Smart Checkout — lib/storefront/checkout-rules ───────────────────────────

export const CHECKOUT_RULE_MESSAGE_MAX = 300;
export const CHECKOUT_RULE_NOTICE_MAX = 500;
export const CHECKOUT_RULE_MIN_QTY_MAX = 10_000;
export const CUSTOMER_NOTE_LABEL_MAX = 80;
export const CHECKOUT_RULE_CUSTOMER_NOTE_LABEL = "Order notes / special requests";

export type CheckoutRuleMessages = { singleOrderType: string; mixedCart: string; minQuantity: string; bacWater: string };

export type CheckoutRules = {
  singleOrderType: boolean;
  mixedCartPrevention: boolean;
  ruleBasedCheckout: boolean;
  minQuantityEnabled: boolean;
  minQuantity: number;
  adminFeeValidation: boolean;
  bacWaterValidation: boolean;
  messages: CheckoutRuleMessages;
  checkoutNotice: string;
  cartWarning: string;
  customerNoteEnabled: boolean;
  customerNoteLabel: string;
};

export const CHECKOUT_RULES_DEFAULTS: CheckoutRules = {
  singleOrderType: true,
  mixedCartPrevention: false,
  ruleBasedCheckout: true,
  minQuantityEnabled: true,
  minQuantity: 1,
  adminFeeValidation: true,
  bacWaterValidation: false,
  messages: { singleOrderType: "", mixedCart: "", minQuantity: "", bacWater: "" },
  checkoutNotice: "",
  cartWarning: "",
  customerNoteEnabled: true,
  customerNoteLabel: "",
};

export const CHECKOUT_RULE_DEFAULT_MESSAGES: CheckoutRuleMessages = {
  singleOrderType: "Reseller (wholesale) and retail items can't be combined in one order — please place them separately.",
  mixedCart: "Your cart mixes product categories — please order one category at a time.",
  minQuantity: "This store requires at least {min} items per order — you have {count}.",
  bacWater: "Peptide vials need bacteriostatic water for reconstitution — please add bacteriostatic water to your order.",
};

export const clampMinQuantity = (n: number): number =>
  Number.isFinite(n) ? Math.min(CHECKOUT_RULE_MIN_QTY_MAX, Math.max(1, Math.round(n))) : CHECKOUT_RULES_DEFAULTS.minQuantity;

export function normalizeCheckoutRules(input: unknown): CheckoutRules {
  const x = asObject(input);
  const m = asObject(x.messages);
  const d = CHECKOUT_RULES_DEFAULTS;
  return {
    singleOrderType: bool(x.singleOrderType, d.singleOrderType),
    mixedCartPrevention: bool(x.mixedCartPrevention, d.mixedCartPrevention),
    ruleBasedCheckout: bool(x.ruleBasedCheckout, d.ruleBasedCheckout),
    minQuantityEnabled: bool(x.minQuantityEnabled, d.minQuantityEnabled),
    minQuantity: clampMinQuantity(Number(x.minQuantity ?? d.minQuantity)),
    adminFeeValidation: bool(x.adminFeeValidation, d.adminFeeValidation),
    bacWaterValidation: bool(x.bacWaterValidation, d.bacWaterValidation),
    messages: {
      singleOrderType: text(m.singleOrderType, CHECKOUT_RULE_MESSAGE_MAX),
      mixedCart: text(m.mixedCart, CHECKOUT_RULE_MESSAGE_MAX),
      minQuantity: text(m.minQuantity, CHECKOUT_RULE_MESSAGE_MAX),
      bacWater: text(m.bacWater, CHECKOUT_RULE_MESSAGE_MAX),
    },
    checkoutNotice: text(x.checkoutNotice, CHECKOUT_RULE_NOTICE_MAX),
    cartWarning: text(x.cartWarning, CHECKOUT_RULE_NOTICE_MAX),
    customerNoteEnabled: bool(x.customerNoteEnabled, d.customerNoteEnabled),
    customerNoteLabel: text(x.customerNoteLabel, CUSTOMER_NOTE_LABEL_MAX),
  };
}

/** `{token}` interpolation, as ruleMessage / ratioMessage do it. */
export function fillTokens(msg: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), msg);
}

// ── Order Ratio Control — lib/storefront/group-buy-rules ─────────────────────

export const RATIO_MAX = 100;
export const RATIO_MESSAGE_MAX = 300;
const GROUP_BUY_MAX_VIALS = 10_000;

export type RatioMode = "strict" | "warn" | "auto_add";
export type RatioDirection = "floor" | "cap";
const RATIO_MODES: readonly RatioMode[] = ["strict", "warn", "auto_add"];
const RATIO_DIRECTIONS: readonly RatioDirection[] = ["floor", "cap"];

export type GroupBuyRatio = {
  enabled: boolean;
  direction: RatioDirection;
  mode: RatioMode;
  bacWaterPerPeptide: number;
  defaultBacWaterProductId: string | null;
  message: string;
};

/** The whole engine — held in full so editing the ratio never clobbers the rest. */
export type GroupBuyRules = {
  enabled: boolean;
  minOrder: { minVialsPerProduct: number; minTotalVials: number };
  bacWater: { restrictionsDisabled: boolean; allowUnlimited: boolean; maxPerPeptide: number };
  ratio: GroupBuyRatio;
  validation: { cart: boolean; checkout: boolean };
};

export const DEFAULT_RATIO_MESSAGE = "Every peptide needs {ratio} bacteriostatic water — add {shortfall} more to check out.";
export const DEFAULT_CAP_MESSAGE =
  "Bacteriostatic water can't exceed your peptide vials — your cart allows {allowed}, you have {bacWater}. Please remove {surplus}.";

export const clampRatio = (n: number): number => (Number.isFinite(n) ? Math.min(RATIO_MAX, Math.max(1, Math.round(n))) : 1);

const count = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(GROUP_BUY_MAX_VIALS, Math.max(0, Math.round(n))) : 0;
};

function normalizeRatio(input: unknown): GroupBuyRatio {
  const x = asObject(input);
  const id = x.defaultBacWaterProductId;
  return {
    enabled: x.enabled === true,
    direction: RATIO_DIRECTIONS.includes(x.direction as RatioDirection) ? (x.direction as RatioDirection) : "floor",
    mode: RATIO_MODES.includes(x.mode as RatioMode) ? (x.mode as RatioMode) : "strict",
    bacWaterPerPeptide: x.bacWaterPerPeptide === undefined ? 1 : clampRatio(Number(x.bacWaterPerPeptide)),
    defaultBacWaterProductId: typeof id === "string" && id.trim() ? id : null,
    message: typeof x.message === "string" ? x.message.trim().slice(0, RATIO_MESSAGE_MAX) : "",
  };
}

export function normalizeGroupBuyRules(input: unknown): GroupBuyRules {
  const x = asObject(input);
  const mo = asObject(x.minOrder);
  const bw = asObject(x.bacWater);
  const va = asObject(x.validation);
  return {
    enabled: x.enabled === true,
    minOrder: { minVialsPerProduct: count(mo.minVialsPerProduct), minTotalVials: count(mo.minTotalVials) },
    bacWater: {
      restrictionsDisabled: bw.restrictionsDisabled === true,
      allowUnlimited: bw.allowUnlimited === true,
      maxPerPeptide: count(bw.maxPerPeptide),
    },
    ratio: normalizeRatio(x.ratio),
    validation: { cart: va.cart !== false, checkout: va.checkout !== false },
  };
}

/**
 * Switching direction drops what would contradict it (AdminGroupBuyRules
 * onDirectionChange): auto-add can't service a cap, and copy using the other
 * direction's tokens falls back to the built-in default.
 */
export function withDirection(ratio: GroupBuyRatio, direction: RatioDirection): GroupBuyRatio {
  const wrongTokens = direction === "cap" ? /\{(shortfall|required)\}/ : /\{(allowed|bacWater|surplus)\}/;
  return {
    ...ratio,
    direction,
    mode: direction === "cap" && ratio.mode === "auto_add" ? "strict" : ratio.mode,
    message: wrongTokens.test(ratio.message) ? "" : ratio.message,
  };
}

/**
 * A sample of the customer-facing message for a typical breaking cart, built
 * the way ratioViolation does: floor → 2 peptides with no water; cap → 2
 * peptides with one bottle too many.
 */
export function ratioSample(ratio: GroupBuyRatio): { cart: string; message: string } {
  const peptide = 2;
  const n = ratio.bacWaterPerPeptide;
  if (ratio.direction === "cap") {
    const allowed = peptide * n;
    const bacWater = allowed + 1;
    return {
      cart: `${peptide} peptide vials + ${bacWater} bac water`,
      message: fillTokens(ratio.message || DEFAULT_CAP_MESSAGE, { ratio: n, peptide, allowed, bacWater, surplus: 1 }),
    };
  }
  const required = peptide * n;
  return {
    cart: `${peptide} peptide vials, no bac water`,
    message: fillTokens(ratio.message || DEFAULT_RATIO_MESSAGE, { ratio: n, shortfall: required, required, peptide }),
  };
}

// ── product classification — lib/storefront/product-class ────────────────────

const BAC_WATER_RE = /\bbac(?:teriostatic)?\s*water\b/i;

/** Tagged bac water wins; untagged products fall back to the name/category heuristic. */
export function isBacWaterProduct(p: { name?: string; category?: string; productClass?: unknown }): boolean {
  if (p.productClass === "peptide" || p.productClass === "bacWater" || p.productClass === "other") {
    return p.productClass === "bacWater";
  }
  return BAC_WATER_RE.test(p.name ?? "") || BAC_WATER_RE.test(p.category ?? "");
}
