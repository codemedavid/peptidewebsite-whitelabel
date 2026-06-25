"use client";

import { useState } from "react";
import type { Brand, Courier } from "../types";
import { useStore } from "../store";

// ─── CourierModal ─────────────────────────────────────────────────────────────

type CourierEditing = Courier & { _new?: boolean };

function CourierModal({
  courier,
  onCancel,
  onSave,
}: {
  courier: CourierEditing;
  onCancel: () => void;
  onSave: (c: CourierEditing) => void;
}) {
  const [name, setName] = useState<string>(courier.name || "");
  const [trackingUrl, setTrackingUrl] = useState<string>(courier.trackingUrl || "");
  const [active, setActive] = useState<boolean>(courier.active !== false);
  const [noLocation, setNoLocation] = useState<boolean>(courier.noLocation === true);

  const canSave = name.trim().length > 0;

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
            <rect x="1" y="3" width="15" height="13" />
            <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
            <circle cx="5.5" cy="18.5" r="2.5" />
            <circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
          {courier._new ? "Add Courier" : "Edit Courier"}
        </h2>

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
            placeholder="e.g., LBC Express"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setName(e.target.value)
            }
          />
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Tracking Page URL (Optional)</label>
          <input
            className="admin-input"
            value={trackingUrl}
            placeholder="e.g., https://www.lbcexpress.com/track"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setTrackingUrl(e.target.value)
            }
          />
          <div className="admin-field__hint">
            Where customers can look up their tracking number.
          </div>
        </div>

        <div className="admin-modal__row">
          <label className="admin-check">
            <input
              type="checkbox"
              checked={noLocation}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setNoLocation(e.target.checked)
              }
            />
            <span>No shipping location / fee — cash on delivery only</span>
          </label>
          <div className="admin-field__hint">
            For couriers like Lalamove or Maxim where the customer just pays COD.
            Offered at checkout without a location selector and adds no shipping
            fee.
          </div>
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
            <span>Active (selectable when saving tracking info on orders)</span>
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
                ...courier,
                name: name.trim(),
                trackingUrl: trackingUrl.trim(),
                active,
                noLocation,
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

// ─── AdminCouriers ────────────────────────────────────────────────────────────

export function AdminCouriers({
  brand,
  onBack,
}: {
  brand: Brand;
  onBack: () => void;
}) {
  const { couriers, setCouriers, shippingLocations } = useStore();
  const [editing, setEditing] = useState<CourierEditing | null>(null);

  void brand;

  // A courier is only offered at checkout when it's active AND either it's a
  // COD/no-location courier OR it has at least one active shipping location (the
  // customer needs a location/fee to pick). An active location-based courier with
  // no location is silently dropped from the storefront, so flag it here to
  // explain the admin/storefront mismatch.
  const hasActiveLocation = (courierId: string) =>
    shippingLocations.some((l) => l.active && l.courierId === courierId);

  const startAdd = () =>
    setEditing({
      id: `c${Date.now()}`,
      name: "",
      trackingUrl: "",
      active: true,
      _new: true,
    });

  const save = (c: CourierEditing) => {
    const exists = couriers.some((x) => x.id === c.id);
    const { _new: _removed, ...clean } = c;
    void _removed;
    setCouriers(
      exists ? couriers.map((x) => (x.id === c.id ? clean : x)) : [...couriers, clean],
    );
    setEditing(null);
  };

  const remove = (id: string) => {
    if (!confirm("Delete this courier?")) return;
    setCouriers(couriers.filter((c) => c.id !== id));
  };

  const toggle = (id: string) => {
    setCouriers(
      couriers.map((c) => (c.id === id ? { ...c, active: !c.active } : c)),
    );
  };

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
                <rect x="1" y="3" width="15" height="13" />
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
              Couriers
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
          {couriers.map((c) => (
            <div key={c.id} className="admin-ship-row">
              <div className="admin-ship-row__info">
                <div className="admin-ship-row__name">{c.name}</div>
                {c.trackingUrl && (
                  <div className="admin-ship-row__code" style={{ textTransform: "none" }}>
                    {c.trackingUrl}
                  </div>
                )}
                {c.noLocation && (
                  <div
                    className="admin-ship-row__code"
                    style={{
                      marginTop: 4,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 12,
                      fontWeight: 600,
                      textTransform: "none",
                      color: "var(--brand-accent)",
                    }}
                  >
                    Cash on delivery — no shipping location or fee
                  </div>
                )}
                {c.active && !c.noLocation && !hasActiveLocation(c.id) && (
                  <div
                    className="admin-ship-row__warn"
                    style={{
                      marginTop: 4,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#b45309",
                    }}
                    title="Add an active shipping location for this courier so customers can choose it."
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    No shipping location — won&apos;t show at checkout
                  </div>
                )}
              </div>
              <button
                className={`admin-ship-row__check ${c.active ? "" : "is-off"}`}
                onClick={() => toggle(c.id)}
                title={
                  c.active
                    ? "Active — click to disable"
                    : "Disabled — click to enable"
                }
                style={{ background: "none", border: 0, cursor: "pointer" }}
              >
                {c.active ? (
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
                  onClick={() => setEditing({ ...c })}
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
                  onClick={() => remove(c.id)}
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
          {couriers.length === 0 && (
            <div className="admin-empty-set">
              No couriers yet.
              <button className="admin-empty-set__cta" onClick={startAdd}>
                + Add your first courier
              </button>
            </div>
          )}
        </div>

        {editing && (
          <CourierModal
            courier={editing}
            onCancel={() => setEditing(null)}
            onSave={save}
          />
        )}
      </main>
    </div>
  );
}
