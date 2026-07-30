"use client";

// Store-admin view for changing the storefront admin password. Verifies the
// current password and writes the new one as a scrypt hash via
// changeStorefrontAdminPasswordAction — the owner's onto Tenant.storeAdminPasswordHash,
// a staff member's onto their own StorefrontStaff row. The new password takes
// effect on the next login; the current session cookie stays valid.
//
// The sign-in EMAIL is not editable here. It is set by the provider in the
// platform tenant settings, so the store owner can change their password but
// cannot change (or lock themselves out of) the address it belongs to.

import { useState } from "react";
import { useStore } from "../store";
import { changeStorefrontAdminPasswordAction } from "@/actions/storefront-admin";

export function AdminAccountSettings({ onBack }: { onBack: () => void }) {
  const { toast } = useStore();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    if (!current.trim()) {
      toast("Enter your current password");
      return;
    }
    if (next.trim().length < 6) {
      toast("New password must be at least 6 characters");
      return;
    }
    if (next !== confirm) {
      toast("New passwords don't match");
      return;
    }
    setSaving(true);
    try {
      const res = await changeStorefrontAdminPasswordAction(current, next);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      toast("Password updated");
    } catch {
      toast("Couldn't update — please sign in again and retry.");
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
          <span style={{ fontSize: 20 }}>🔑</span>
          Account Settings
        </h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={save} disabled={saving}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
          </svg>
          {saving ? "Saving…" : "Update Password"}
        </button>
      </header>

      <div className="admin-form__body">
        <div className="admin-form__card" style={{ maxWidth: 520 }}>
          <h2 className="admin-form__section">🔒 Change Your Password</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            This is your password for signing in to the ADMIN DASHBOARD.
            The new password takes effect the next time you log in. To change the
            email address you sign in with, contact your provider.
          </div>

          <div className="admin-field" style={{ marginBottom: 14 }}>
            <label className="admin-field__label">Current password</label>
            <input
              className="admin-input"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrent(e.target.value)}
            />
          </div>

          <div className="admin-field" style={{ marginBottom: 14 }}>
            <label className="admin-field__label">New password</label>
            <input
              className="admin-input"
              type="password"
              autoComplete="new-password"
              placeholder="At least 6 characters"
              value={next}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNext(e.target.value)}
            />
          </div>

          <div className="admin-field" style={{ marginBottom: 4 }}>
            <label className="admin-field__label">Confirm new password</label>
            <input
              className="admin-input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
