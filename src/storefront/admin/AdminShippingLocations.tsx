"use client";

import { useState } from "react";
import type { Brand, ShippingLocation } from "../types";
import { useStore } from "../store";

// ─── ShippingLocationModal ────────────────────────────────────────────────────

type ShippingLocationEditing = ShippingLocation & { _new?: boolean };

function ShippingLocationModal({
  location,
  currency,
  onCancel,
  onSave,
}: {
  location: ShippingLocationEditing;
  currency: string;
  onCancel: () => void;
  onSave: (loc: ShippingLocationEditing) => void;
}) {
  const [code, setCode] = useState<string>(location.code || "");
  const [name, setName] = useState<string>(location.name || "");
  const [price, setPrice] = useState<number>(location.price ?? 0);
  const [active, setActive] = useState<boolean>(location.active !== false);

  const canSave = name.trim() && code.trim();

  return (
    <div className="admin-modal" onClick={onCancel}>
      <div className="admin-modal__card" onClick={(e) => e.stopPropagation()}>
        <h2 className="admin-modal__title">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--brand-accent)" }}
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          {location._new ? "Add Shipping Location" : "Edit Shipping Location"}
        </h2>

        <div className="admin-modal__row">
          <label className="admin-field__label">
            Code
            <span className="req" style={{ color: "var(--brand-accent)" }}>
              *
            </span>
          </label>
          <input
            className="admin-input"
            value={code}
            placeholder="e.g., NCR, LBC_METRO_MANILA"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setCode(e.target.value.toUpperCase().replace(/\s+/g, "_"))
            }
          />
          <div className="admin-field__hint">
            Short uppercase identifier. Used internally for shipping rules.
          </div>
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">
            Name
            <span className="req" style={{ color: "var(--brand-accent)" }}>
              *
            </span>
          </label>
          <input
            className="admin-input"
            value={name}
            placeholder="e.g., LBC - Metro Manila"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setName(e.target.value)
            }
          />
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Shipping Fee ({currency})</label>
          <input
            className="admin-input"
            type="number"
            min={0}
            value={price}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setPrice(Number(e.target.value) || 0)
            }
          />
        </div>

        <div className="admin-modal__row">
          <label className="admin-check">
            <input
              type="checkbox"
              checked={active}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setActive(e.target.checked)
              }
            />
            <span>Active (customers can select this location at checkout)</span>
          </label>
        </div>

        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="admin-btn"
            disabled={!canSave}
            onClick={() =>
              onSave({
                ...location,
                code,
                name,
                price: Number(price) || 0,
                active,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AdminShippingLocations ───────────────────────────────────────────────────

export function AdminShippingLocations({
  brand,
  onBack,
}: {
  brand: Brand;
  onBack: () => void;
}) {
  const { shippingLocations, setShippingLocations } = useStore();
  const [editing, setEditing] = useState<ShippingLocationEditing | null>(null);

  const commit = (next: ShippingLocation[]) => {
    setShippingLocations(next);
  };

  const startAdd = () =>
    setEditing({
      id: `s${Date.now()}`,
      code: "",
      name: "",
      price: 0,
      active: true,
      _new: true,
    });

  const save = (loc: ShippingLocationEditing) => {
    const exists = shippingLocations.some((l) => l.id === loc.id);
    const { _new: _removed, ...clean } = loc;
    void _removed;
    commit(
      exists
        ? shippingLocations.map((l) => (l.id === loc.id ? clean : l))
        : [...shippingLocations, clean],
    );
    setEditing(null);
  };

  const remove = (id: string) => {
    if (!confirm("Delete this shipping location?")) return;
    commit(shippingLocations.filter((l) => l.id !== id));
  };

  const toggle = (id: string) => {
    commit(
      shippingLocations.map((l) =>
        l.id === id ? { ...l, active: !l.active } : l,
      ),
    );
  };

  const currency = brand.currency ?? "₱";

  return (
    <div className="admin">
      <main className="admin__inner">
        <div className="admin-table__head">
          <h1 className="admin-table__title">
            <a
              className="admin-table__title-back"
              href="#"
              onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                e.preventDefault();
                onBack();
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Dashboard
            </a>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              Shipping Locations
            </span>
          </h1>
          <button className="admin-btn" onClick={startAdd}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add New
          </button>
        </div>

        <div className="admin-ship-list">
          {shippingLocations.map((l) => (
            <div key={l.id} className="admin-ship-row">
              <div className="admin-ship-row__info">
                <div className="admin-ship-row__code">{l.code || "—"}</div>
                <div className="admin-ship-row__name">{l.name}</div>
              </div>
              <div className="admin-ship-row__price">
                {currency}
                {(l.price || 0).toLocaleString()}
              </div>
              <button
                className={`admin-ship-row__check ${l.active ? "" : "is-off"}`}
                onClick={() => toggle(l.id)}
                title={
                  l.active
                    ? "Active — click to disable"
                    : "Disabled — click to enable"
                }
                style={{ background: "none", border: 0, cursor: "pointer" }}
              >
                {l.active ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                )}
              </button>
              <div className="admin-ship-row__actions">
                <button
                  className="admin-icon-btn admin-ship-row__edit"
                  title="Edit"
                  onClick={() => setEditing({ ...l })}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                </button>
                <button
                  className="admin-icon-btn admin-icon-btn--danger"
                  title="Delete"
                  onClick={() => remove(l.id)}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          {shippingLocations.length === 0 && (
            <div className="admin-empty-set">
              No shipping locations yet.
              <button className="admin-empty-set__cta" onClick={startAdd}>
                + Add your first location
              </button>
            </div>
          )}
        </div>

        {editing && (
          <ShippingLocationModal
            location={editing}
            currency={currency}
            onCancel={() => setEditing(null)}
            onSave={save}
          />
        )}
      </main>
    </div>
  );
}
