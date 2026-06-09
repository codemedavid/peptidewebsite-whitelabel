"use client";

// Store-admin view for the reseller / merchant portal. Two jobs:
//   1. Set the reseller access code (persisted in branding.config via
//      saveResellerSettingsAction). Whether the portal is AVAILABLE at all is a
//      platform entitlement the operator toggles in admin → Features; the owner
//      only sees that status here and supplies the code that takes it live.
//   2. Give the owner a reseller-focused overview of every product's wholesale
//      tiers, with a one-click jump to the product editor (where the per-product
//      vials-only / complete-set prices are actually set).

import { useEffect, useState } from "react";
import type { Brand, Product } from "../types";
import { useStore } from "../store";
import {
  getResellerSettingsAction,
  saveResellerSettingsAction,
} from "@/actions/storefront-admin";
import { resellerMinQty } from "../checkout";

export function AdminResellerSettings({
  brand,
  onBack,
  onEdit,
}: {
  brand: Brand;
  onBack: () => void;
  onEdit: (p: Product) => void;
}) {
  const { products, categories, toast } = useStore();
  const [available, setAvailable] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load the current settings (server-only — the access code isn't shipped in
  // the public brand, so it's fetched here behind the admin session).
  useEffect(() => {
    let alive = true;
    void getResellerSettingsAction()
      .then((res) => {
        if (!alive) return;
        if (!("error" in res)) {
          setAvailable(res.available);
          setCode(res.code);
        }
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await saveResellerSettingsAction({ code: code.trim() });
      if ("error" in res) {
        toast(res.error);
        return;
      }
      toast("Reseller settings saved");
    } catch {
      toast("Couldn't save — please sign in again and retry.");
    } finally {
      setSaving(false);
    }
  };

  const currency = brand.currency || "₱";
  const money = (n?: number | null) => (n && n > 0 ? `${currency}${n.toLocaleString()}` : "—");
  const catLabel = (id: string) => (categories || []).find((c) => c.id === id)?.label || id;
  const withReseller = products.filter((p) => p.reseller && (p.reseller.vialsOnly || p.reseller.completeSet));

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
          <span style={{ fontSize: 20 }}>🤝</span>
          Reseller Portal
        </h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={save} disabled={saving || loading}>
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
          <h2 className="admin-form__section">🔐 Wholesale Page Access</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            The gated reseller price list at <code>#merchant</code> goes live once you set an access code
            below — regular shoppers never see it. Share the link <code>/#merchant</code> + the code with
            your resellers.
          </div>

          {loading ? null : !available ? (
            <div className="admin-field__hint" style={{ color: "#c0392b", marginBottom: 14 }}>
              Your plan doesn’t include the reseller portal yet — contact your provider to enable it. You
              can still set a code below so it’s ready the moment they do.
            </div>
          ) : code.trim() ? (
            <div className="admin-field__hint" style={{ color: "#1e7e34", marginBottom: 14 }}>
              ✅ Live — resellers can unlock <code>#merchant</code> with the code below.
            </div>
          ) : (
            <div className="admin-field__hint" style={{ marginBottom: 14 }}>
              Set an access code to take your reseller page live.
            </div>
          )}

          <div className="admin-form__row">
            <div className="admin-field">
              <label className="admin-field__label">Access code</label>
              <input
                className="admin-input"
                value={code}
                placeholder="e.g. PEPPIES10"
                autoComplete="off"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="admin-form__card">
          <h2 className="admin-form__section">💰 Wholesale Prices by Product</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            Reseller prices are set per product. Click a product to edit its vials-only and complete-set
            tiers in the product editor.
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Min order</th>
                  <th>Retail</th>
                  <th>Vials only</th>
                  <th>Complete set</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const hasReseller = !!(p.reseller && (p.reseller.vialsOnly || p.reseller.completeSet));
                  return (
                    <tr key={p.id}>
                      <td className="admin-cell-product">
                        <button
                          type="button"
                          className="admin-cell-product__name"
                          onClick={() => onEdit(p)}
                        >
                          {p.name}
                        </button>
                      </td>
                      <td data-label="Category"><span style={{ fontSize: 14 }}>{catLabel(p.category)}</span></td>
                      <td className="admin-cell-price" data-label="Min order">{hasReseller ? `${resellerMinQty(p)}+` : "—"}</td>
                      <td className="admin-cell-price" data-label="Retail">{money(p.price)}</td>
                      <td className="admin-cell-price" data-label="Vials only">{money(p.reseller?.vialsOnly)}</td>
                      <td className="admin-cell-price" data-label="Complete set">{money(p.reseller?.completeSet)}</td>
                      <td className="admin-cell-actions">
                        <button
                          className="admin-icon-btn"
                          title={hasReseller ? "Edit reseller prices" : "Set reseller prices"}
                          onClick={() => onEdit(p)}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                               strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: 60, color: "var(--brand-text-muted)" }}>
                      No products yet. Add products first, then set their reseller prices.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {products.length > 0 && withReseller.length === 0 && (
            <div className="admin-field__hint" style={{ marginTop: 14 }}>
              No products have reseller prices yet — the wholesale page will be empty until you set some.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
