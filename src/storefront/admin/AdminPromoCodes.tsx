"use client";

import { useState } from "react";
import type { Brand, PromoCode } from "../types";
import { useStore } from "../store";

// Internal NumberField spinner — matches the prototype's widget.
function NumberField({
  value,
  onChange,
  min = 0,
  max,
}: {
  value: number | string;
  onChange: (v: number | string) => void;
  min?: number;
  max?: number;
}) {
  const v = value === "" ? "" : Number(value);
  const step = (delta: number) => {
    let n = (Number(v) || 0) + delta;
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    onChange(n);
  };
  return (
    <div className="admin-number">
      <input
        className="admin-input"
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="admin-number__spin">
        <button type="button" onClick={() => step(1)} aria-label="Increase">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
               strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
        </button>
        <button type="button" onClick={() => step(-1)} aria-label="Decrease">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
               strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// Editing state includes an optional _new flag that is not part of PromoCode.
type EditingPromo = PromoCode & { _new?: boolean };

function PromoCodeModal({
  currency,
  promo,
  onCancel,
  onSave,
}: {
  currency: string;
  promo: EditingPromo;
  onCancel: () => void;
  onSave: (c: EditingPromo) => void;
}) {
  const [code, setCode]     = useState<string>(promo.code || "");
  const [type, setType]     = useState<"fixed" | "percent">(promo.type || "fixed");
  const [value, setValue]   = useState<number | string>(promo.value ?? 0);
  const [minP, setMinP]     = useState<number | string>(promo.minPurchase ?? 0);
  const [limit, setLimit]   = useState<number | string>(promo.usageLimit ?? "");
  const [expiry, setExpiry] = useState<string>(promo.expiry || "");
  const canSave = code.trim() && Number(value) > 0;

  return (
    <div className="admin-modal" onClick={onCancel}>
      <div className="admin-modal__card" onClick={(e) => e.stopPropagation()}
           style={{ maxWidth: 560 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <h2 className="admin-modal__title admin-modal__title--green" style={{ margin: 0 }}>
            {promo._new ? "Create Promo Code" : "Edit Promo Code"}
          </h2>
          <button className="admin-icon-btn" onClick={onCancel} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Promo Code</label>
          <input className="admin-input" value={code}
            placeholder="E.G. SAVE100"
            onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="admin-modal__row" style={{ margin: 0 }}>
            <label className="admin-field__label">Type</label>
            <select className="admin-select" value={type}
              onChange={(e) => setType(e.target.value as "fixed" | "percent")}>
              <option value="fixed">Fixed Amount ({currency})</option>
              <option value="percent">Percentage (%)</option>
            </select>
          </div>
          <div className="admin-modal__row" style={{ margin: 0 }}>
            <label className="admin-field__label">Value</label>
            <NumberField value={value} onChange={setValue} min={0} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
          <div className="admin-modal__row" style={{ margin: 0 }}>
            <label className="admin-field__label">Min. Purchase ({currency})</label>
            <NumberField value={minP} onChange={setMinP} min={0} />
          </div>
          <div className="admin-modal__row" style={{ margin: 0 }}>
            <label className="admin-field__label">Usage Limit</label>
            <input className="admin-input" type="number" min="0" value={limit}
              placeholder="No limit" onChange={(e) => setLimit(e.target.value)} />
          </div>
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Expiry Date</label>
          <input className="admin-input" type="date" value={expiry}
            onChange={(e) => setExpiry(e.target.value)} />
        </div>

        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--ghost" onClick={onCancel}>Cancel</button>
          <button className="promo-modal__create" disabled={!canSave}
            onClick={() => onSave({
              ...promo, code, type,
              value: Number(value) || 0,
              minPurchase: Number(minP) || 0,
              usageLimit: limit !== "" ? Number(limit) : null,
              expiry: expiry || null,
            })}>
            {promo._new ? "Create Code" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminPromoCodes({
  brand,
  onBack,
}: {
  brand: Brand;
  onBack: () => void;
}) {
  const { promoCodes, setPromoCodes } = useStore();
  const [editing, setEditing] = useState<EditingPromo | null>(null);
  const [query, setQuery] = useState<string>("");
  const currency = brand.currency || "₱";

  const commit = (next: PromoCode[]) => setPromoCodes(next);

  const startAdd = () =>
    setEditing({
      id: `pc${Date.now()}`,
      code: "",
      type: "fixed",
      value: 0,
      minPurchase: 0,
      usageLimit: null,
      used: 0,
      expiry: null,
      active: true,
      _new: true,
    });

  const save = (c: EditingPromo) => {
    const exists = promoCodes.some((x) => x.id === c.id);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _new: _dropped, ...clean } = c;
    commit(
      exists
        ? promoCodes.map((x) => (x.id === clean.id ? clean : x))
        : [...promoCodes, clean],
    );
    setEditing(null);
  };

  const remove = (id: string) => {
    if (!confirm("Delete this promo code?")) return;
    commit(promoCodes.filter((c) => c.id !== id));
  };

  const filtered = promoCodes.filter(
    (c) => !query.trim() || c.code.toLowerCase().includes(query.toLowerCase()),
  );

  const isExpired = (c: PromoCode) =>
    !!c.expiry && new Date(c.expiry) < new Date();

  return (
    <div className="admin promo-page">
      <main className="admin__inner">
        <a
          className="admin-table__title-back"
          href="#"
          onClick={(e) => { e.preventDefault(); onBack(); }}
          style={{ marginBottom: 22 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back to Dashboard
        </a>

        <div className="promo-toolbar">
          <h1 className="promo-toolbar__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
              <line x1="7" y1="7" x2="7.01" y2="7"/>
            </svg>
            Promo Codes
          </h1>
          <button className="promo-btn-green" onClick={startAdd}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                 strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Create New Code
          </button>
        </div>

        <div className="promo-search-wrap">
          <label className="input-wrap">
            <svg className="input-icon" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <input value={query} placeholder="Search by code…"
              onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>

        {filtered.map((c) => (
          <div key={c.id} className="promo-card">
            <div className="promo-card__row1">
              <h3 className="promo-card__code">{c.code || "—"}</h3>
              <div className="promo-card__icons">
                <button className="admin-icon-btn promo-card__edit" title="Edit"
                  onClick={() => setEditing({ ...c })}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                       strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>
                  </svg>
                </button>
                <button className="admin-icon-btn admin-icon-btn--danger" title="Delete"
                  onClick={() => remove(c.id)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                       strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  </svg>
                </button>
              </div>
            </div>
            <span className="promo-card__value-pill">
              {c.type === "percent"
                ? `${c.value}% OFF`
                : `${currency}${c.value.toLocaleString()} OFF`}
            </span>
            <div className="promo-card__meta">
              <div>
                <div className="promo-card__meta-label">Status</div>
                <span className={`promo-card__status-pill ${(!c.active || isExpired(c)) ? "promo-card__status-pill--off" : ""}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                       strokeLinecap="round" strokeLinejoin="round">
                    {(!c.active || isExpired(c))
                      ? (
                        <>
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </>
                      )
                      : <polyline points="20 6 9 17 4 12"/>
                    }
                  </svg>
                  {isExpired(c) ? "Expired" : c.active ? "Active" : "Inactive"}
                </span>
              </div>
              <div>
                <div className="promo-card__meta-label">Usage</div>
                <div className="promo-card__meta-val">
                  {c.used || 0} / {c.usageLimit || "∞"}
                </div>
              </div>
              <div>
                <div className="promo-card__meta-label">Expiry</div>
                <div className="promo-card__meta-val">
                  {c.expiry ? new Date(c.expiry).toLocaleDateString() : "Never"}
                </div>
              </div>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="admin-empty-set">
            {query ? "No codes match your search." : "No promo codes yet."}
            {!query && (
              <button className="admin-empty-set__cta" onClick={startAdd}>
                + Create your first code
              </button>
            )}
          </div>
        )}

        {editing && (
          <PromoCodeModal
            currency={currency}
            promo={editing}
            onCancel={() => setEditing(null)}
            onSave={save}
          />
        )}
      </main>
    </div>
  );
}
