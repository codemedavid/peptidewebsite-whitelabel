"use client";

import { useRef, useState } from "react";
import type { Brand, PaymentMethod } from "../types";
import { useStore } from "../store";
import { readImageFile } from "./shared";

// Editing state includes an optional _new flag not present on PaymentMethod.
type EditingMethod = PaymentMethod & { _new?: boolean };

function AdminPaymentMethodForm({
  method,
  onCancel,
  onSave,
}: {
  brand: Brand;
  method: EditingMethod;
  onCancel: () => void;
  onSave: (m: EditingMethod) => void;
}) {
  const [name, setName]       = useState<string>(method.name || "");
  const [number, setNumber]   = useState<string>(method.number || "");
  const [account, setAccount] = useState<string>(method.account || "");
  const [qrImage, setQrImage] = useState<string>(method.qrImage || "");
  const [drag, setDrag]       = useState<boolean>(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canSave = name.trim() && number.trim() && account.trim();

  const handleImage = async (file: File | undefined) => {
    try {
      const dataUrl = await readImageFile(file, 2048);
      setQrImage(dataUrl);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Image upload failed.");
    }
  };

  return (
    <div className="admin pay-page">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={onCancel}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </button>
        <h1 className="admin-form__title">
          {method._new ? "Add Payment Method" : "Edit Payment Method"}
        </h1>
        <div className="admin-form__bar-spacer"></div>
        <button className="admin-form__cancel" onClick={onCancel}>Cancel</button>
        <button className="admin-form__save"
          onClick={() => onSave({ ...method, name, number, account, qrImage })}
          disabled={!canSave}>
          Save
        </button>
      </header>

      <div className="admin-form__body" style={{ maxWidth: 760 }}>
        <div className="pay-form-card">
          <div className="admin-field" style={{ marginBottom: 22 }}>
            <label className="admin-field__label">
              Payment Method Name<span style={{ color: "var(--brand-accent)" }}>*</span>
            </label>
            <input className="admin-input" value={name}
              placeholder="e.g., GCash, Maya, Bank Transfer"
              onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="admin-field" style={{ marginBottom: 22 }}>
            <label className="admin-field__label">
              Account Number/Phone<span style={{ color: "var(--brand-accent)" }}>*</span>
            </label>
            <input className="admin-input" value={number}
              placeholder="09XX XXX XXXX or Account: 1234-5678-9012"
              onChange={(e) => setNumber(e.target.value)} />
          </div>

          <div className="admin-field" style={{ marginBottom: 22 }}>
            <label className="admin-field__label">
              Account Name<span style={{ color: "var(--brand-accent)" }}>*</span>
            </label>
            <input className="admin-input" value={account}
              placeholder="ACCOUNT NAME"
              onChange={(e) => setAccount(e.target.value)} />
          </div>

          <div className="admin-field">
            <label className="admin-field__label">QR Code Image (Optional)</label>
            <div className="admin-field__hint" style={{ marginBottom: 14 }}>
              Upload a QR code image or paste an image URL. If upload fails, you can use the URL input below.
            </div>
            <div
              className={`admin-image-drop ${drag ? "is-dragover" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                void handleImage(e.dataTransfer.files?.[0]);
              }}
            >
              {qrImage ? (
                <div className="admin-image-drop__preview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrImage} alt="QR preview" />
                </div>
              ) : (
                <>
                  <div className="admin-image-drop__icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                         strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <circle cx="9" cy="9" r="2"/>
                      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.81.01L6 21"/>
                    </svg>
                  </div>
                  <div className="admin-image-drop__title">Click to upload QR image</div>
                  <div className="admin-image-drop__sub">or drag and drop</div>
                  <div className="admin-image-drop__formats">
                    All image formats (JPG, PNG, WebP, SVG…) — max 2 MB
                  </div>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => { void handleImage(e.target.files?.[0]); }}
              />
            </div>

            <div className="admin-image-actions">
              <button className="admin-image-btn" type="button"
                onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Choose File
              </button>
              <span style={{ fontSize: 14, color: "var(--brand-text-muted)" }}>or enter URL below</span>
              {qrImage && (
                <button className="admin-image-btn admin-image-btn--secondary" type="button"
                  onClick={() => setQrImage("")}>Clear</button>
              )}
            </div>

            <div className="admin-field" style={{ marginTop: 16 }}>
              <label className="admin-field__label">Or enter image URL</label>
              <input
                className="admin-input"
                value={qrImage.startsWith("data:") ? "" : qrImage}
                placeholder="https://example.com/image.jpg"
                onChange={(e) => setQrImage(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminPaymentMethods({
  brand,
  onBack,
}: {
  brand: Brand;
  onBack: () => void;
}) {
  const { paymentMethods, setPaymentMethods } = useStore();
  const [editing, setEditing] = useState<EditingMethod | null>(null);

  const commit = (next: PaymentMethod[]) => setPaymentMethods(next);

  const startAdd = () =>
    setEditing({
      id: `pm${Date.now()}`,
      name: "",
      number: "",
      account: "",
      qrImage: "",
      order: paymentMethods.length + 1,
      active: true,
      _new: true,
    });

  const save = (m: EditingMethod) => {
    const exists = paymentMethods.some((x) => x.id === m.id);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _new: _dropped, ...clean } = m;
    commit(
      exists
        ? paymentMethods.map((x) => (x.id === clean.id ? clean : x))
        : [...paymentMethods, clean],
    );
    setEditing(null);
  };

  const remove = (id: string) => {
    if (!confirm("Delete this payment method?")) return;
    commit(paymentMethods.filter((m) => m.id !== id));
  };

  const toggle = (id: string) => {
    commit(paymentMethods.map((m) => (m.id === id ? { ...m, active: !m.active } : m)));
  };

  if (editing) {
    return (
      <AdminPaymentMethodForm
        brand={brand}
        method={editing}
        onCancel={() => setEditing(null)}
        onSave={save}
      />
    );
  }

  return (
    <div className="admin pay-page">
      <main className="admin__inner">
        <div className="admin-table__head">
          <h1 className="admin-table__title">
            <a
              className="admin-table__title-back"
              href="#"
              onClick={(e) => { e.preventDefault(); onBack(); }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Dashboard
            </a>
            <span>Payment Methods</span>
          </h1>
          <button className="admin-btn" onClick={startAdd}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                 strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Payment Method
          </button>
        </div>

        <div className="pay-card-wrap">
          <h2 className="pay-card-wrap__head">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
            </svg>
            Payment Methods
          </h2>

          {paymentMethods.map((m) => (
            <div key={m.id} className="pay-row">
              <div className="pay-row__avatar">
                {m.qrImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.qrImage} alt={m.name} />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                       strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
                  </svg>
                )}
              </div>
              <div className="pay-row__body">
                <div className="pay-row__name">{m.name || "Untitled"}</div>
                {m.number && <div className="pay-row__num">{m.number}</div>}
                <div className="pay-row__account">Account: {m.account || "—"}</div>
                <div className="pay-row__meta">ID: {m.id} · Order: #{m.order}</div>
              </div>
              <div className="pay-row__actions">
                <button
                  className={`pay-row__active-pill ${m.active ? "" : "is-off"}`}
                  onClick={() => toggle(m.id)}
                >
                  {m.active ? "Active" : "Inactive"}
                </button>
                <button className="pay-row__edit-btn" onClick={() => setEditing({ ...m })} title="Edit">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                       strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>
                  </svg>
                </button>
                <button className="pay-row__delete-btn" onClick={() => remove(m.id)} title="Delete">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                       strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}

          {paymentMethods.length === 0 && (
            <div className="admin-empty-set">
              No payment methods yet.
              <button className="admin-empty-set__cta" onClick={startAdd}>
                + Add your first method
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
