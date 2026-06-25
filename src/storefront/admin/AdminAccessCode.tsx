"use client";

// Store-admin panel for the VISITOR access-code gate (the "enter a code to view
// this store" wall). Three controls:
//   1. Rotate the access code (rotateAccessCodeAction) — hashing happens server
//      side; rotating bumps the code version, which signs every current visitor
//      out instantly.
//   2. Turn the gate on/off (setGateSettingsAction). Can't be turned on until a
//      code exists, or visitors would be locked out with no way in.
//   3. Edit the heading shown on the gate page (white-label copy).
// The current code is never loaded back here — only whether one is set — because
// it's stored as a one-way hash and never leaves the server.

import { useEffect, useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import {
  getGateSettingsAction,
  setGateSettingsAction,
  rotateAccessCodeAction,
} from "@/actions/storefront-gate";

export function AdminAccessCode({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { toast } = useStore();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [heading, setHeading] = useState("Enter access code");
  const [hasCode, setHasCode] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    let alive = true;
    void getGateSettingsAction()
      .then((res) => {
        if (!alive || "error" in res) return;
        setEnabled(res.enabled);
        setHeading(res.heading);
        setHasCode(res.hasCode);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const saveSettings = async (next: { enabled?: boolean; heading?: string }) => {
    if (savingSettings) return;
    const payload = { enabled: next.enabled ?? enabled, heading: next.heading ?? heading };
    setSavingSettings(true);
    try {
      const res = await setGateSettingsAction(payload);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setEnabled(payload.enabled);
      setHeading(payload.heading);
      toast(payload.enabled ? "Access gate is ON" : "Access gate is OFF");
    } catch {
      toast("Couldn't save — please sign in again and retry.");
    } finally {
      setSavingSettings(false);
    }
  };

  const rotate = async () => {
    if (rotating) return;
    if (newCode.trim().length < 6) {
      toast("Access code must be at least 6 characters.");
      return;
    }
    setRotating(true);
    try {
      const res = await rotateAccessCodeAction(newCode.trim());
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setHasCode(true);
      setNewCode("");
      toast("Code updated — all current visitors have been signed out.");
    } catch {
      toast("Couldn't update the code — please sign in again and retry.");
    } finally {
      setRotating(false);
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
          <span style={{ fontSize: 20 }}>🔒</span>
          Access Code
        </h1>
        <div className="admin-form__bar-spacer" />
      </header>

      <div className="admin-form__body">
        <div className="admin-form__card">
          <h2 className="admin-form__section">🚪 Storefront Gate</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            When the gate is on, visitors must enter the access code before they can see your store.
            Rotating the code below signs out everyone who already entered the old one.
          </div>

          {loading ? null : enabled && hasCode ? (
            <div className="admin-field__hint" style={{ color: "#1e7e34", marginBottom: 14 }}>
              ✅ Gate is ON — visitors need the code to view {brand.name || "your store"}.
            </div>
          ) : hasCode ? (
            <div className="admin-field__hint" style={{ marginBottom: 14 }}>
              A code is set but the gate is OFF — your store is currently open to everyone.
            </div>
          ) : (
            <div className="admin-field__hint" style={{ marginBottom: 14 }}>
              No code set yet. Set one below, then turn the gate on.
            </div>
          )}

          <label
            style={{ display: "flex", alignItems: "center", gap: 10, cursor: hasCode ? "pointer" : "not-allowed", opacity: hasCode ? 1 : 0.55 }}
          >
            <input
              type="checkbox"
              checked={enabled}
              disabled={!hasCode || savingSettings || loading}
              onChange={(e) => void saveSettings({ enabled: e.target.checked })}
            />
            <span style={{ fontWeight: 600 }}>Require an access code to view the store</span>
          </label>
          {!hasCode && (
            <div className="admin-field__hint" style={{ marginTop: 6 }}>
              Set a code first — the gate can’t be enabled without one.
            </div>
          )}
        </div>

        <div className="admin-form__card">
          <h2 className="admin-form__section">🔑 {hasCode ? "Rotate Access Code" : "Set Access Code"}</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            The code is stored hashed and never shown again. {hasCode ? "Setting a new one immediately invalidates the old one." : ""}
          </div>
          <div className="admin-form__row">
            <div className="admin-field">
              <label className="admin-field__label">{hasCode ? "New access code" : "Access code"}</label>
              <input
                className="admin-input"
                value={newCode}
                placeholder="At least 6 characters"
                autoComplete="off"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewCode(e.target.value)}
              />
            </div>
          </div>
          <button className="admin-form__save" onClick={rotate} disabled={rotating || loading} style={{ marginTop: 4 }}>
            {rotating ? "Saving…" : hasCode ? "Update code" : "Set code"}
          </button>
        </div>

        <div className="admin-form__card">
          <h2 className="admin-form__section">✏️ Gate Heading</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            The headline shown on the access-code screen.
          </div>
          <div className="admin-form__row">
            <div className="admin-field">
              <label className="admin-field__label">Heading</label>
              <input
                className="admin-input"
                value={heading}
                placeholder="Enter access code"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHeading(e.target.value)}
              />
            </div>
          </div>
          <button
            className="admin-form__save"
            onClick={() => void saveSettings({ heading: heading.trim() || "Enter access code" })}
            disabled={savingSettings || loading}
            style={{ marginTop: 4 }}
          >
            {savingSettings ? "Saving…" : "Save heading"}
          </button>
        </div>
      </div>
    </div>
  );
}
