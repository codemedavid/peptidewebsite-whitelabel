"use client";

// Store-admin view for Smart Cart & Checkout Logic. Three sections, mapping
// 1:1 onto branding.config.checkoutRules (lib/storefront/checkout-rules):
//   1. Cart restrictions — single-order-type and mixed-cart prevention.
//   2. Checkout rules — rule-based checkout (block vs warn), minimum quantity,
//      admin-fee validation, bac-water validation.
//   3. Checkout experience — the customizable validation messages, checkout
//      notice and cart warning.
// Saves through saveCheckoutRulesAction (read-modify-write into branding.config)
// and mirrors into the live brand via setTweak so the open storefront updates
// without a reload.

import { useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { saveCheckoutRulesAction } from "@/actions/storefront-admin";
import {
  CHECKOUT_RULE_DEFAULT_MESSAGES,
  CHECKOUT_RULE_MIN_QTY_MAX,
  normalizeCheckoutRules,
  type CheckoutRulesConfig,
} from "@/lib/storefront/checkout-rules";

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="admin-field" style={{ marginBottom: 14 }}>
      <label className="admin-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      <div className="admin-field__hint">{hint}</div>
    </div>
  );
}

export function AdminCheckoutRules({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { setTweak, toast } = useStore();
  const [rules, setRules] = useState<CheckoutRulesConfig>(() =>
    normalizeCheckoutRules(brand.checkoutRules),
  );
  const [saving, setSaving] = useState(false);

  const set = (edits: Partial<CheckoutRulesConfig>) =>
    setRules((r) => ({ ...r, ...edits }));
  const setMessage = (key: keyof CheckoutRulesConfig["messages"], val: string) =>
    setRules((r) => ({ ...r, messages: { ...r.messages, [key]: val } }));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const value = normalizeCheckoutRules(rules);
      const res = await saveCheckoutRulesAction(value);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      // Mirror into the live brand so the open storefront's cart picks the new
      // rules up immediately (the DB copy serves every other device).
      setTweak({ checkoutRules: value });
      setRules(value);
      toast("Checkout rules saved");
    } catch {
      toast("Couldn't save — please sign in again and retry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Dashboard
        </button>
        <h1 className="admin-form__title">
          <span style={{ fontSize: 20 }}>🧠</span>
          Smart Checkout
        </h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={save} disabled={saving}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
          </svg>
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      <div className="admin-form__body">
        {/* ---------- Cart restrictions ---------- */}
        <div className="admin-form__card">
          <h2 className="admin-form__section">🛒 Cart Restrictions</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            Hard limits on what a single cart may contain. These always apply — the
            rule-based checkout switch below doesn&apos;t soften them.
          </div>
          <Toggle
            label="Single order type per cart"
            hint="Reseller (wholesale-priced) and retail items can't be combined in one order — customers place them separately."
            checked={rules.singleOrderType}
            onChange={(v) => set({ singleOrderType: v })}
          />
          <Toggle
            label="Mixed cart prevention"
            hint="One product category per cart — adding an item from a second category is rejected with your message below."
            checked={rules.mixedCartPrevention}
            onChange={(v) => set({ mixedCartPrevention: v })}
          />
        </div>

        {/* ---------- Checkout rules ---------- */}
        <div className="admin-form__card">
          <h2 className="admin-form__section">✅ Checkout Rules</h2>
          <Toggle
            label="Rule-based checkout"
            hint="On: the rules below block checkout (and the server rejects violating orders). Off: they show as cart warnings only."
            checked={rules.ruleBasedCheckout}
            onChange={(v) => set({ ruleBasedCheckout: v })}
          />
          <Toggle
            label="Minimum quantity validation"
            hint="Require a minimum number of total items per order."
            checked={rules.minQuantityEnabled}
            onChange={(v) => set({ minQuantityEnabled: v })}
          />
          {rules.minQuantityEnabled && (
            <div className="admin-field" style={{ maxWidth: 220, marginBottom: 14 }}>
              <label className="admin-field__label">Minimum items per order</label>
              <input
                className="admin-input"
                type="number"
                min={1}
                max={CHECKOUT_RULE_MIN_QTY_MAX}
                value={rules.minQuantity}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  set({ minQuantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })
                }
              />
            </div>
          )}
          <Toggle
            label="Admin fee validation"
            hint="Reject an order when the fee shown at checkout no longer matches the configured admin fee (it changed mid-session), so customers are never charged a total they didn't see."
            checked={rules.adminFeeValidation}
            onChange={(v) => set({ adminFeeValidation: v })}
          />
          <Toggle
            label="Bac water validation"
            hint="Peptide orders must include bacteriostatic water. Only applies while your catalog has a bac-water product, so it can never make checkout impossible."
            checked={rules.bacWaterValidation}
            onChange={(v) => set({ bacWaterValidation: v })}
          />
        </div>

        {/* ---------- Checkout experience ---------- */}
        <div className="admin-form__card">
          <h2 className="admin-form__section">💬 Checkout Experience</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            Customize what customers read. Leave a field blank to use the built-in
            message (shown as the placeholder). The minimum-quantity message supports{" "}
            <code>{"{min}"}</code> and <code>{"{count}"}</code>.
          </div>

          <div className="admin-field" style={{ marginBottom: 14 }}>
            <label className="admin-field__label">Cart warning (always shown in the cart)</label>
            <input
              className="admin-input"
              value={rules.cartWarning}
              placeholder="e.g. Peptide orders ship Mondays–Wednesdays only."
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                set({ cartWarning: e.target.value })
              }
            />
          </div>
          <div className="admin-field" style={{ marginBottom: 18 }}>
            <label className="admin-field__label">Checkout notice (shown on the details step)</label>
            <input
              className="admin-input"
              value={rules.checkoutNotice}
              placeholder="e.g. Double-check your shipping address — peptides are temperature-sensitive."
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                set({ checkoutNotice: e.target.value })
              }
            />
          </div>

          {(
            [
              ["singleOrderType", "Single order type message"],
              ["mixedCart", "Mixed cart message"],
              ["minQuantity", "Minimum quantity message"],
              ["bacWater", "Bac water message"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="admin-field" style={{ marginBottom: 14 }}>
              <label className="admin-field__label">{label}</label>
              <input
                className="admin-input"
                value={rules.messages[key]}
                placeholder={CHECKOUT_RULE_DEFAULT_MESSAGES[key]}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setMessage(key, e.target.value)
                }
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
