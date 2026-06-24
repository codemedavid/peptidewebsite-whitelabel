"use client";

// Store-admin view for the checkout fee — the SAME branding.config.adminFee the
// platform operator can set in the tenant settings, now editable by the store
// owner. The label is free text, so a store that would rather charge one flat
// shipping fee (instead of per-location shipping rates) can simply name this
// "Shipping fee". Saves through saveStoreAdminFeeAction (read-modify-write into
// branding.config) and mirrors into the live brand via setTweak so the open
// storefront's cart updates without a reload.

import { useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { saveStoreAdminFeeAction } from "@/actions/storefront-admin";
import {
  ADMIN_FEE_AMOUNT_MAX,
  ADMIN_FEE_LABEL_DEFAULT,
  ADMIN_FEE_LABEL_MAX,
  normalizeAdminFee,
} from "@/lib/storefront/admin-fee";

// Quick label presets so the common use cases are one tap away.
const LABEL_PRESETS = ["Shipping fee", "Service fee", "Admin fee", "Processing fee"];

export function AdminFeeSettings({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { setTweak, toast } = useStore();
  // Normalize once so legacy/absent configs become a clean shape to edit.
  const initial = normalizeAdminFee(brand.adminFee);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [label, setLabel] = useState(initial.label);
  // Raw string so partial entries ("12.") don't fight the field; parsed on save.
  const [amount, setAmount] = useState(initial.amount > 0 ? String(initial.amount) : "");
  const [saving, setSaving] = useState(false);

  const currency = brand.currency ?? "₱";
  const amountNum = Number(amount);
  const amountValid =
    Number.isFinite(amountNum) && amountNum > 0 && amountNum <= ADMIN_FEE_AMOUNT_MAX;
  const canSave = !enabled || amountValid;
  const previewLabel = label.trim() || ADMIN_FEE_LABEL_DEFAULT;

  const save = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    try {
      const value = normalizeAdminFee({
        enabled,
        label,
        amount: Number(amount) || 0,
        // This view edits the flat fee only — pass the saved mode/percent through
        // so a percentage fee configured by the operator isn't clobbered to fixed.
        mode: initial.mode,
        percent: initial.percent,
      });
      const res = await saveStoreAdminFeeAction(value);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      // Mirror into the live brand so the open storefront's cart picks the new
      // fee up immediately (the DB copy serves every other device).
      setTweak({ adminFee: value });
      toast("Checkout fee saved");
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
          <span style={{ fontSize: 20 }}>🧾</span>
          Checkout Fee
        </h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={save} disabled={saving || !canSave}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
          </svg>
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      <div className="admin-form__body">
        <div className="admin-form__card">
          <h2 className="admin-form__section">🧾 Checkout Fee</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            A single charge added on top of the order total at checkout — e.g. a
            shipping, service or processing fee. Customers see it as its own line
            in the totals. Use this if you&apos;d rather charge one flat fee than
            set a fee on every shipping location.
          </div>

          <div className="admin-field" style={{ marginBottom: 14 }}>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEnabled(e.target.checked)}
              />
              <span>Charge a fee at checkout</span>
            </label>
            <div className="admin-field__hint">
              When on, the fee below is added once to every new order. Existing
              orders are never changed.
            </div>
          </div>

          {enabled && (
            <>
              <div className="admin-field" style={{ marginBottom: 8 }}>
                <label className="admin-field__label">What the fee is for</label>
                <input
                  className="admin-input"
                  value={label}
                  maxLength={ADMIN_FEE_LABEL_MAX}
                  placeholder={ADMIN_FEE_LABEL_DEFAULT}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)}
                />
                <div className="admin-field__hint">
                  The line label customers see in the totals, e.g.
                  &ldquo;Shipping fee&rdquo; or &ldquo;Service charge&rdquo;.
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
                {LABEL_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    style={{
                      padding: "5px 12px",
                      fontSize: 13,
                      ...(label.trim() === p
                        ? { borderColor: "var(--brand-accent)", color: "var(--brand-accent)" }
                        : {}),
                    }}
                    onClick={() => setLabel(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <div className="admin-field" style={{ maxWidth: 240, marginBottom: 4 }}>
                <label className="admin-field__label">Amount ({currency})</label>
                <input
                  className="admin-input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  placeholder="0.00"
                  aria-invalid={!amountValid}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
                />
                {!amountValid && (
                  <div className="admin-field__hint" style={{ color: "var(--brand-accent)" }}>
                    Enter an amount above zero
                    {amountNum > ADMIN_FEE_AMOUNT_MAX
                      ? ` (max ${ADMIN_FEE_AMOUNT_MAX.toLocaleString()})`
                      : ""}
                    , or turn the fee off.
                  </div>
                )}
              </div>
            </>
          )}

          <div className="admin-field__hint" style={{ marginTop: 16 }}>
            {enabled && amountValid ? (
              <>
                Checkout will show &ldquo;{previewLabel}: {currency}
                {amountNum.toLocaleString()}&rdquo; above the total.
              </>
            ) : (
              <>No fee is charged at checkout.</>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
