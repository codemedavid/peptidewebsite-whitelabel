"use client";

// Store-admin editor for the CURRENCY the shop trades in.
//
// The platform was born selling pesos and the peso was written into the markup,
// so a shop that sells in riyals or dirhams needed a code change to exist. This
// screen makes it a setting the owner picks.
//
// Two things it deliberately does NOT do:
//
//   It does not convert prices. Switching to SAR relabels 1,500 as "SAR 1,500",
//   it does not divide by an exchange rate. Rates move daily and the right price
//   in a new market is a business decision, not arithmetic — silently repricing
//   a whole catalog would be the worst possible default.
//
//   It does not restrict the owner to a list. The picker offers the currencies
//   we know, plus a free-text box for anything else, because "any currency" has
//   to mean any (see lib/storefront/currency — "the list is open").
//
// Saves through saveCurrencyAction, which re-normalizes server-side and moves
// all three stores of a currency together: branding.config, StoreSettings, and
// the symbol captured on every existing product row.
// Grantable to staff ("currency") — see admin/staff-permissions.

import { useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { saveCurrencyAction } from "@/actions/storefront-admin";
import { CURRENCIES, formatMoney, normalizeCurrency } from "@/lib/storefront/currency";

/** A sample big enough to show grouping and the minor unit at once. */
const SAMPLE = 1500;

export function AdminCurrency({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { setTweak, toast } = useStore();
  const current = normalizeCurrency(brand.currency);

  // A currency the registry knows selects itself; anything else lands the form
  // in "custom" mode with the stored value in the box, so an owner who typed
  // something unusual sees it preserved rather than silently reset.
  const known = CURRENCIES.some((c) => c.code === current.code);
  const [choice, setChoice] = useState(known ? current.code : "custom");
  const [custom, setCustom] = useState(known ? "" : current.symbol);
  const [saving, setSaving] = useState(false);

  const picked = choice === "custom" ? custom : choice;
  const draft = normalizeCurrency(picked);
  const changed = draft.symbol !== current.symbol;

  const save = async () => {
    if (saving) return;
    if (choice === "custom" && !custom.trim()) {
      toast("Type a currency code or symbol first.");
      return;
    }
    setSaving(true);
    try {
      const res = await saveCurrencyAction(picked);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      // Mirror into the live brand so the open storefront updates without a
      // reload; the DB copy is what the next visit reads.
      setTweak({ currency: draft.symbol });
      toast(`Now selling in ${draft.label}`);
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
          <span style={{ fontSize: 20 }}>{current.symbol}</span>
          Currency
        </h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={save} disabled={saving || !changed}>
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
          <h2 className="admin-form__section">Your shop sells in {current.label}</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            This is the currency shown on every product card, in the cart, at
            checkout, and across your own dashboard and order records.
          </div>

          <div className="admin-field">
            <label className="admin-field__label">Currency</label>
            <select
              className="admin-field__input"
              value={choice}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setChoice(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label} ({c.symbol})
                </option>
              ))}
              <option value="custom">Something else…</option>
            </select>
          </div>

          {choice === "custom" && (
            <div className="admin-field">
              <label className="admin-field__label">Code or symbol</label>
              <input
                className="admin-field__input"
                value={custom}
                maxLength={8}
                placeholder="e.g. ZMW"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustom(e.target.value)}
              />
              <div className="admin-field__hint">
                A three-letter code (ZMW, NGN) or a symbol (₸). Whatever you type
                is what your customers will see beside every price.
              </div>
            </div>
          )}

          <h2 className="admin-form__section" style={{ marginTop: 22 }}>
            How your prices will look
          </h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 14 }}>
            A product priced {SAMPLE.toLocaleString()} in your catalog:
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              flexWrap: "wrap",
              fontWeight: 700,
              fontSize: 26,
            }}
          >
            <span style={{ opacity: 0.4, textDecoration: changed ? "line-through" : "none" }}>
              {formatMoney(SAMPLE, current.symbol)}
            </span>
            {changed && <span aria-hidden="true">→</span>}
            {changed && <span>{formatMoney(SAMPLE, draft.symbol)}</span>}
          </div>

          {changed && (
            <div className="admin-field__hint" style={{ marginTop: 18 }}>
              <strong>Your prices do not change.</strong> A product priced{" "}
              {SAMPLE.toLocaleString()} stays {SAMPLE.toLocaleString()} — only the
              currency beside it changes, on every product you already have. If
              your new prices should be different numbers, edit them in Manage
              Products after saving.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
