"use client";

// Store-admin view for the reseller / merchant portal. Three jobs:
//   1. Set (or remove) the reseller PASSWORD. It is stored as a scrypt hash via
//      saveResellerSettingsAction and cannot be read back — so this screen shows
//      whether one is set and offers replace/remove, never the value itself.
//      Whether the portal is AVAILABLE at all is a platform entitlement the
//      operator toggles in admin → Features; the owner only sees that status
//      here and supplies the password that takes it live.
//   2. Word the password screen resellers see (title + instructions).
//   3. Give the owner a reseller-focused overview of every product's wholesale
//      pricing, with a one-click jump to the product editor (where the MOQ and
//      the wholesale price are actually set).

import { useEffect, useState } from "react";
import type { Brand, Product } from "../types";
import { useStore } from "../store";
import {
  getResellerSettingsAction,
  saveResellerSettingsAction,
} from "@/actions/storefront-admin";
import { resellerMinQty } from "../checkout";
import { resolveWholesale } from "@/lib/storefront/wholesale";
import {
  DEFAULT_RESELLER_GATE_TITLE,
  DEFAULT_RESELLER_GATE_SUB,
} from "@/lib/storefront/reseller-page-copy";

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
  const [pageAvailable, setPageAvailable] = useState(false);
  const [wholesaleAvailable, setWholesaleAvailable] = useState(false);
  // Whether a password is currently stored. The value is never loaded — it is a
  // one-way hash — so `code` starts blank and only carries a NEW password.
  const [hasCode, setHasCode] = useState(false);
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [gateTitle, setGateTitle] = useState("");
  const [gateSub, setGateSub] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void getResellerSettingsAction()
      .then((res) => {
        if (!alive) return;
        if (!("error" in res)) {
          setAvailable(res.available);
          setPageAvailable(res.pageAvailable);
          setWholesaleAvailable(res.wholesaleAvailable);
          setHasCode(res.hasCode);
          setGateTitle(res.gateTitle);
          setGateSub(res.gateSub);
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
      const res = await saveResellerSettingsAction({
        // Omit `code` entirely when the box is empty, so saving page copy never
        // touches (or clears) an existing password — clearing is its own button.
        ...(code.trim() ? { code: code.trim() } : {}),
        merchantGateTitle: gateTitle,
        merchantGateSub: gateSub,
      });
      if ("error" in res) {
        toast(res.error);
        return;
      }
      if (code.trim()) {
        setHasCode(true);
        setCode("");
        setShowCode(false);
      }
      toast("Reseller settings saved");
    } catch {
      toast("Couldn't save — please sign in again and retry.");
    } finally {
      setSaving(false);
    }
  };

  // Removing the password re-locks the portal AND revokes every reseller
  // currently signed in (the save bumps the code version, which invalidates
  // their sessions), so it asks first.
  const removeCode = async () => {
    if (saving) return;
    if (!confirm("Remove the reseller password? The reseller page locks again and anyone currently signed in is signed out.")) return;
    setSaving(true);
    try {
      const res = await saveResellerSettingsAction({ code: "", clear: true });
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setHasCode(false);
      setCode("");
      toast("Reseller password removed");
    } catch {
      toast("Couldn't save — please sign in again and retry.");
    } finally {
      setSaving(false);
    }
  };

  const currency = brand.currency || "₱";
  const money = (n?: number | null) => (n && n > 0 ? `${currency}${n.toLocaleString()}` : "—");
  const catLabel = (id: string) => (categories || []).find((c) => c.id === id)?.label || id;
  // Through the shared resolver so BOTH config shapes count — a product priced
  // with the current MOQ block is wholesale-ready just as much as a legacy one.
  const withWholesale = products.filter((p) => resolveWholesale(p) != null);

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
          <h2 className="admin-form__section">🔐 Reseller Page Password</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            Your reseller page lives at <code>/reseller</code>. Resellers open it, enter the password
            below, and see your wholesale prices — regular shoppers never do. Share the link and the
            password with your resellers.
          </div>

          {loading ? null : !available ? (
            <div className="admin-field__hint" style={{ color: "#c0392b", marginBottom: 14 }}>
              Your plan doesn’t include the Reseller feature yet — contact your provider to enable it.
              You can still set a password below so it’s ready the moment they do.
            </div>
          ) : !pageAvailable ? (
            <div className="admin-field__hint" style={{ color: "#c0392b", marginBottom: 14 }}>
              The Reseller feature is on, but the <strong>Wholesale reseller page</strong> isn’t enabled
              for your store yet — ask your provider to turn it on. Wholesale pricing on your regular
              storefront is {wholesaleAvailable ? "already active" : "also off"}.
            </div>
          ) : hasCode ? (
            <div className="admin-field__hint" style={{ color: "#1e7e34", marginBottom: 14 }}>
              ✅ Live — your reseller page is open at <code>/reseller</code> to anyone with the password.
            </div>
          ) : (
            <div className="admin-field__hint" style={{ marginBottom: 14 }}>
              Set a password to take your reseller page live.
            </div>
          )}

          <div className="admin-form__row">
            <div className="admin-field">
              <label className="admin-field__label">
                {hasCode ? "Set a new password" : "Reseller page password"}
              </label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  className="admin-input"
                  type={showCode ? "text" : "password"}
                  value={code}
                  placeholder={hasCode ? "Leave blank to keep the current password" : "e.g. NOVALABWHOLESALE"}
                  autoComplete="new-password"
                  style={{ flex: 1 }}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value)}
                />
                <button
                  type="button"
                  className="admin-icon-btn"
                  title={showCode ? "Hide password" : "Show password"}
                  aria-label={showCode ? "Hide password" : "Show password"}
                  onClick={() => setShowCode((v) => !v)}
                >
                  {showCode ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                         strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                         strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              <div className="admin-field__hint">
                {hasCode
                  ? "Your current password can’t be shown — it’s stored encrypted. Type a new one to replace it. Changing or removing it signs out every reseller using the old one."
                  : "At least 4 characters. It’s stored encrypted and never shown again, so keep your own copy."}
              </div>
            </div>
          </div>

          {hasCode && (
            <button
              type="button"
              className="admin-btn admin-btn--danger-soft"
              onClick={removeCode}
              disabled={saving}
              style={{ marginTop: 4 }}
            >
              Remove password (re-lock the page)
            </button>
          )}
        </div>

        <div className="admin-form__card">
          <h2 className="admin-form__section">✍️ Reseller Page Wording</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            What resellers read on the password screen before they get in.
          </div>
          <div className="admin-form__row">
            <div className="admin-field">
              <label className="admin-field__label">Title</label>
              <input
                className="admin-input"
                value={gateTitle}
                placeholder={DEFAULT_RESELLER_GATE_TITLE}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGateTitle(e.target.value)}
              />
            </div>
          </div>
          <div className="admin-form__row">
            <div className="admin-field">
              <label className="admin-field__label">Instructions</label>
              <textarea
                className="admin-input"
                rows={2}
                value={gateSub}
                placeholder={DEFAULT_RESELLER_GATE_SUB}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setGateSub(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="admin-form__card">
          <h2 className="admin-form__section">💰 Wholesale Prices by Product</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            Reseller pricing is set per product. Click a product to set its minimum order quantity and
            wholesale price in the product editor. Products with no wholesale price never appear on the
            reseller page.
          </div>

          {/* Without the wholesale-pricing child the product editor renders no
              MOQ/price fields at all, so "click a product to set it" above would
              send the owner to a screen that cannot do what it promises. Say so
              here rather than letting them find out. */}
          {!loading && available && !wholesaleAvailable && (
            <div className="admin-field__hint" style={{ color: "#c0392b", marginBottom: 18 }}>
              Heads up: <strong>Wholesale pricing</strong> isn’t enabled for your store yet, so the
              product editor won’t show the reseller price and MOQ fields. Ask your provider to turn it
              on, then set your prices here.
            </div>
          )}

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Retail</th>
                  <th>Reseller</th>
                  <th>MOQ</th>
                  <th>Stock</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const w = resolveWholesale(p);
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
                      <td className="admin-cell-price" data-label="Retail">{money(p.price)}</td>
                      <td className="admin-cell-price" data-label="Reseller">{money(w?.price)}</td>
                      <td className="admin-cell-price" data-label="MOQ">{w ? `${resellerMinQty(p)}+` : "—"}</td>
                      <td className="admin-cell-price" data-label="Stock">
                        {typeof p.stock === "number" ? p.stock.toLocaleString() : "—"}
                      </td>
                      <td className="admin-cell-actions">
                        <button
                          className="admin-icon-btn"
                          title={w ? "Edit reseller pricing" : "Set reseller pricing"}
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
                      No products yet. Add products first, then set their reseller pricing.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {products.length > 0 && withWholesale.length === 0 && (
            <div className="admin-field__hint" style={{ marginTop: 14 }}>
              No products have reseller pricing yet — the reseller page will be empty until you set some.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
