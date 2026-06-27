"use client";

import { useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { isAdminViewVisible } from "../visibility";
import { STAFF_MODULES } from "./staff-permissions";
import { createStaffAction, updateStaffAction, type StaffListItem } from "@/actions/storefront-staff";

type Props = {
  brand: Brand;
  staff: StaffListItem | null;
  onBack: () => void;
  onSaved: () => void;
};

/**
 * Owner-only Add/Edit staff form. The permission grid lists exactly the modules
 * this store has (STAFF_MODULES filtered by the store's view toggles), so an owner
 * can only grant access to features that actually exist for their plan. On edit,
 * a blank password keeps the existing one.
 */
export function AdminStaffForm({ brand, staff, onBack, onSaved }: Props) {
  const { toast } = useStore();
  const isEdit = !!staff;

  const [fullName, setFullName] = useState(staff?.fullName ?? "");
  const [email, setEmail] = useState(staff?.email ?? "");
  const [username, setUsername] = useState(staff?.username ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"active" | "suspended">(
    staff?.status === "suspended" ? "suspended" : "active",
  );
  const [permissions, setPermissions] = useState<string[]>(staff?.permissions ?? []);
  const [saving, setSaving] = useState(false);

  // Only the modules this store actually exposes are grantable.
  const modules = STAFF_MODULES.filter((m) => isAdminViewVisible(brand, m.key));

  const toggle = (key: string) =>
    setPermissions((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const allOn = modules.every((m) => permissions.includes(m.key));
  const toggleAll = () => setPermissions(allOn ? [] : modules.map((m) => m.key));

  const canSave =
    fullName.trim().length > 0 &&
    email.trim().length > 0 &&
    username.trim().length >= 3 &&
    (isEdit || password.length >= 6);

  const save = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    try {
      const payload = {
        fullName,
        email,
        username,
        password,
        confirmPassword,
        status,
        permissions,
      };
      const res = isEdit
        ? await updateStaffAction(staff!.id, payload)
        : await createStaffAction(payload);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      toast(isEdit ? "Staff member updated" : "Staff member added");
      onSaved();
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
          Back
        </button>
        <h1 className="admin-form__title">{isEdit ? "Edit Staff" : "Add Staff"}</h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={save} disabled={saving || !canSave}>
          {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Staff"}
        </button>
      </header>

      <div className="admin-form__body">
        <div className="admin-form__card">
          <h2 className="admin-form__section">Basic Information</h2>

          <div className="admin-field">
            <label className="admin-field__label">Full Name</label>
            <input
              className="admin-input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Maria Santos"
            />
          </div>

          <div className="admin-field">
            <label className="admin-field__label">Email Address</label>
            <input
              className="admin-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="maria@example.com"
            />
          </div>

          <div className="admin-field">
            <label className="admin-field__label">Username</label>
            <input
              className="admin-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="maria"
              autoCapitalize="none"
            />
            <div className="admin-field__hint">
              Used to sign in. 3–32 characters: lowercase letters, numbers, dot, dash or underscore.
            </div>
          </div>

          <div className="admin-field">
            <label className="admin-field__label">Password</label>
            <input
              className="admin-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? "Leave blank to keep current password" : "At least 6 characters"}
            />
          </div>

          <div className="admin-field">
            <label className="admin-field__label">Confirm Password</label>
            <input
              className="admin-input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
            />
          </div>

          <div className="admin-field">
            <label className="admin-field__label">Status</label>
            <select
              className="admin-select"
              value={status}
              onChange={(e) => setStatus(e.target.value === "suspended" ? "suspended" : "active")}
            >
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
            <div className="admin-field__hint">Suspended staff can&apos;t sign in.</div>
          </div>
        </div>

        <div className="admin-form__card">
          <div className="staff-perms__head">
            <h2 className="admin-form__section">Permissions</h2>
            <button className="admin-btn admin-btn--ghost" onClick={toggleAll}>
              {allOn ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="admin-field__hint">
            This staff member will only see the modules you allow. Dashboard, Account Settings and
            Logout are always available.
          </div>

          <div className="staff-perms">
            {modules.map((m) => {
              const on = permissions.includes(m.key);
              return (
                <label key={m.key} className={`staff-perm ${on ? "is-on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(m.key)} />
                  <span>{m.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
