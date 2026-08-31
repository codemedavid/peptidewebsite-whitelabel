// Smart Cart & Checkout Logic — the per-tenant rule set that governs what a
// cart may contain and what checkout requires. Configured by the store owner
// in the storefront #admin ("Smart Checkout") and persisted in the shared
// branding.config blob as `checkoutRules` (read-modify-write, like adminFee).
//
// Two groups, with different enforcement semantics:
//   • Cart restrictions (singleOrderType, mixedCartPrevention) are HARD: mixed
//     categories are rejected at add-to-cart, mixed retail/reseller carts are
//     rejected at checkout — regardless of the rule-based-checkout switch.
//   • Checkout rules (min quantity, bac water, admin fee) are governed by the
//     `ruleBasedCheckout` master: on → violations BLOCK checkout (and the
//     server rejects the order); off → they render as cart warnings only.
//
// Pure (no server-only, no React) so the storefront client, the store-admin
// panel, and the order server action all normalize and validate identically —
// the same contract admin-fee.ts follows.

import type { Product } from "@/storefront/types";
import { isResellerQty } from "@/storefront/checkout";

export const CHECKOUT_RULE_MESSAGE_MAX = 300;
export const CHECKOUT_RULE_NOTICE_MAX = 500;
export const CHECKOUT_RULE_MIN_QTY_MAX = 10_000;
export const CUSTOMER_NOTE_LABEL_MAX = 80;

/** Built-in copy for the checkout note box when the owner hasn't renamed it. */
export const CHECKOUT_RULE_CUSTOMER_NOTE_LABEL = "Order notes / special requests";

/** The per-rule validation copy the owner can override. Blank → the default. */
export type CheckoutRuleMessages = {
  singleOrderType: string;
  mixedCart: string;
  minQuantity: string;
  bacWater: string;
};

/** What the store owner configures (branding.config.checkoutRules). */
export type CheckoutRulesConfig = {
  // ── Cart restriction settings ──
  /** One order type per cart: retail and reseller (wholesale-priced) lines
   *  can't be combined in a single order. */
  singleOrderType: boolean;
  /** One product category per cart: adding an item from a second category is
   *  rejected at add-to-cart. */
  mixedCartPrevention: boolean;
  // ── Checkout rules ──
  /** Master switch: on → rule violations block checkout (server-enforced);
   *  off → they show as warnings and the order still goes through. */
  ruleBasedCheckout: boolean;
  /** Require at least `minQuantity` total units per order. */
  minQuantityEnabled: boolean;
  minQuantity: number;
  /** Reject the order when the fee shown at checkout no longer matches the
   *  tenant's configured admin fee (config changed mid-session). Server-side. */
  adminFeeValidation: boolean;
  /** Peptide orders must include bacteriostatic water. Only applies when the
   *  catalog actually offers a bac-water product, so it can never make
   *  checkout impossible. OPT-IN: this is the coarse peptide→water FLOOR, and it
   *  contradicts a store running Order Ratio Control as a cap (where buying
   *  peptides alone is legitimate), so it ships off. */
  bacWaterValidation: boolean;
  // ── Checkout experience ──
  messages: CheckoutRuleMessages;
  /** Informational note shown on the checkout details step (in addition to
   *  the brand's checkoutNote). */
  checkoutNotice: string;
  /** Informational banner shown at the top of the cart. */
  cartWarning: string;
  /** Show the buyer a free-text note box on the checkout details step, so they
   *  can tell the owner about a delivery window, a gate code, a substitution.
   *  Always optional — it never blocks checkout. */
  customerNoteEnabled: boolean;
  /** The owner's own wording for that box. Blank → CHECKOUT_RULE_CUSTOMER_NOTE_LABEL. */
  customerNoteLabel: string;
};

/** Defaults for a tenant that has never opened the Smart Checkout panel.
 *  Single-order-type, min-quantity and admin-fee validation ship ON (each is a
 *  no-op until the catalog/config gives it something to check); mixed-cart
 *  prevention and bac-water validation ship OFF — a peptide-only order is a
 *  legitimate order, so nagging for water is something an owner opts into. */
export const CHECKOUT_RULES_DEFAULTS: CheckoutRulesConfig = {
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
  // ON: an optional note box costs a store nothing and answers the question
  // every owner ends up asking in chat anyway. An owner who doesn't want it
  // gets a switch rather than needing a code change.
  customerNoteEnabled: true,
  customerNoteLabel: "",
};

/** The built-in copy used when the owner hasn't customized a message.
 *  `{min}` / `{count}` interpolate in the min-quantity message. */
export const CHECKOUT_RULE_DEFAULT_MESSAGES: CheckoutRuleMessages = {
  singleOrderType:
    "Reseller (wholesale) and retail items can't be combined in one order — please place them separately.",
  mixedCart: "Your cart mixes product categories — please order one category at a time.",
  minQuantity: "This store requires at least {min} items per order — you have {count}.",
  bacWater:
    "Peptide vials need bacteriostatic water for reconstitution — please add bacteriostatic water to your order.",
};

function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === "boolean" ? v : dflt;
}

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Coerce an untrusted/legacy config value into a well-formed rule set. */
export function normalizeCheckoutRules(input: unknown): CheckoutRulesConfig {
  const x = (input ?? {}) as Record<string, unknown>;
  const m = (x.messages ?? {}) as Record<string, unknown>;
  const d = CHECKOUT_RULES_DEFAULTS;
  const rawMin = Number(x.minQuantity);
  return {
    singleOrderType: bool(x.singleOrderType, d.singleOrderType),
    mixedCartPrevention: bool(x.mixedCartPrevention, d.mixedCartPrevention),
    ruleBasedCheckout: bool(x.ruleBasedCheckout, d.ruleBasedCheckout),
    minQuantityEnabled: bool(x.minQuantityEnabled, d.minQuantityEnabled),
    minQuantity: Number.isFinite(rawMin)
      ? Math.min(CHECKOUT_RULE_MIN_QTY_MAX, Math.max(1, Math.round(rawMin)))
      : d.minQuantity,
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

/** The label for the checkout note box — the owner's wording, else the built-in.
 *  `text()` has already trimmed, so a whitespace-only entry reads as unset
 *  rather than rendering a blank label above the box. */
export function customerNoteLabel(rules: CheckoutRulesConfig): string {
  return rules.customerNoteLabel.trim() || CHECKOUT_RULE_CUSTOMER_NOTE_LABEL;
}

/** The message for a rule — the owner's custom copy, else the built-in. */
export function ruleMessage(
  rules: CheckoutRulesConfig,
  rule: keyof CheckoutRuleMessages,
  vars?: Record<string, string | number>,
): string {
  let msg = rules.messages[rule] || CHECKOUT_RULE_DEFAULT_MESSAGES[rule];
  for (const [k, v] of Object.entries(vars ?? {})) {
    msg = msg.split(`{${k}}`).join(String(v));
  }
  return msg;
}

// ── Product classification ───────────────────────────────────────────────────

/** Matches "Bac Water", "BacWater", "Bacteriostatic Water" anywhere in a name. */
const BAC_WATER_RE = /\bbac(?:teriostatic)?\s*water\b/i;

export function isBacWaterProduct(p: Pick<Product, "name">): boolean {
  return BAC_WATER_RE.test(p.name);
}

/** Whether a product is a lyophilized peptide that needs bacteriostatic water
 *  to reconstitute — by category/name keyword or a stated amino sequence. */
export function needsBacWater(p: Pick<Product, "name" | "category" | "sequence">): boolean {
  if (isBacWaterProduct(p)) return false;
  return (
    /pept/i.test(p.category || "") ||
    /\bpeptide\b/i.test(p.name) ||
    !!(p.sequence && p.sequence.trim())
  );
}

// ── Validation ───────────────────────────────────────────────────────────────

/** A cart line: a distinct product plus how many units are in the cart.
 *  (Structurally identical to storefront/checkout's CartLine.) */
export type RuleCartLine = { product: Product; qty: number };

export type CheckoutRuleViolation = {
  rule: "singleOrderType" | "mixedCart" | "minQuantity" | "bacWater";
  message: string;
  /** True → checkout must not proceed; false → render as a warning only. */
  blocking: boolean;
};

/**
 * Every rule the current cart violates, in display order. Cart restrictions
 * always block; checkout rules block only under `ruleBasedCheckout`. The same
 * engine runs in the cart UI and (re-run against the DB catalog) in
 * placeStorefrontOrderAction, so the server enforces exactly what the cart
 * showed. `catalog` is the tenant's product set, used so bac-water validation
 * only fires when the store actually sells bacteriostatic water.
 */
export function checkoutRuleViolations(
  lines: RuleCartLine[],
  catalog: Pick<Product, "name">[],
  rulesInput: unknown,
): CheckoutRuleViolation[] {
  const rules = normalizeCheckoutRules(rulesInput);
  if (lines.length === 0) return [];
  const out: CheckoutRuleViolation[] = [];

  if (rules.singleOrderType) {
    const hasReseller = lines.some((l) => isResellerQty(l.product, l.qty));
    const hasRetail = lines.some((l) => !isResellerQty(l.product, l.qty));
    if (hasReseller && hasRetail) {
      out.push({
        rule: "singleOrderType",
        message: ruleMessage(rules, "singleOrderType"),
        blocking: true,
      });
    }
  }

  if (rules.mixedCartPrevention) {
    const categories = new Set(lines.map((l) => l.product.category || ""));
    if (categories.size > 1) {
      out.push({ rule: "mixedCart", message: ruleMessage(rules, "mixedCart"), blocking: true });
    }
  }

  if (rules.minQuantityEnabled && rules.minQuantity > 1) {
    const count = lines.reduce((sum, l) => sum + l.qty, 0);
    if (count < rules.minQuantity) {
      out.push({
        rule: "minQuantity",
        message: ruleMessage(rules, "minQuantity", { min: rules.minQuantity, count }),
        blocking: rules.ruleBasedCheckout,
      });
    }
  }

  if (rules.bacWaterValidation && catalog.some(isBacWaterProduct)) {
    const cartNeedsIt = lines.some((l) => needsBacWater(l.product));
    const cartHasIt = lines.some((l) => isBacWaterProduct(l.product));
    if (cartNeedsIt && !cartHasIt) {
      out.push({
        rule: "bacWater",
        message: ruleMessage(rules, "bacWater"),
        blocking: rules.ruleBasedCheckout,
      });
    }
  }

  return out;
}

/**
 * Why `product` may not be added to the current cart, or null when it may.
 * Only the mixed-cart restriction applies at add time — the single-order-type
 * rule depends on quantities (a line turns "reseller" once it crosses the
 * wholesale threshold), so it is checked at checkout instead.
 */
export function addToCartViolation(
  product: Product,
  cart: Pick<Product, "id" | "category">[],
  rulesInput: unknown,
): string | null {
  const rules = normalizeCheckoutRules(rulesInput);
  if (!rules.mixedCartPrevention || cart.length === 0) return null;
  const category = product.category || "";
  const mixes = cart.some((p) => p.id !== product.id && (p.category || "") !== category);
  return mixes ? ruleMessage(rules, "mixedCart") : null;
}
