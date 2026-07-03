"use client";

import { useEffect, useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { STAFF_MODULES } from "./staff-permissions";
import {
  listStaffAction,
  setStaffStatusAction,
  deleteStaffAction,
  type StaffListItem,
} from "@/actions/storefront-staff";

type Props = {
  brand: Brand;
  onBack: () => void;
  onAdd: () => void;
  onEdit: (staff: StaffListItem) => void;
};

const LABEL_BY_KEY = new Map(STAFF_MODULES.map((m) => [m.key, m.label]));

/** A short, human summary of what a staff member can access. */
function permissionSummary(permissions: string[]): string {
  if (permissions.length === 0) return "No modules yet";
  if (permissions.length === STAFF_MODULES.length) return "Full access";
  const labels = permissions.map((k) => LABEL_BY_KEY.get(k) ?? k);
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.slice(0, 3).join(", ")} +${labels.length - 3}`;
}

/** Owner-only "Staff Accounts" list: all staff + add/edit/suspend/delete. */
export function AdminStaffList({ brand, onBack, onAdd, onEdit }: Props) {
  const { toast } = useStore();
  const [items, setItems] = useState<StaffListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listStaffAction();
      if ("error" in res) {
        toast(res.error);
        setItems([]);
      } else {
        setItems(res.items);
      }
    } catch {
      toast("Couldn't load staff.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleStatus = async (staff: StaffListItem) => {
    if (busyId) return;
    const next = staff.status === "active" ? "suspended" : "active";
    setBusyId(staff.id);
    try {
      const res = await setStaffStatusAction(staff.id, next);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setItems((prev) => prev.map((s) => (s.id === staff.id ? { ...s, status: next } : s)));
      toast(next === "suspended" ? "Staff suspended" : "Staff activated");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (staff: StaffListItem) => {
    if (busyId) return;
    if (!window.confirm(`Delete staff member "${staff.fullName}"? This can't be undone.`)) return;
    setBusyId(staff.id);
    try {
      const res = await deleteStaffAction(staff.id);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setItems((prev) => prev.filter((s) => s.id !== staff.id));
      toast("Staff member deleted");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={onBack}>
          Back
        </button>
        <h1 className="admin-form__title">Staff Accounts</h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={onAdd}>
          Add Staff
        </button>
      </header>

      <div className="admin-form__body">
        <div className="admin__tip" style={{ marginTop: 0, textAlign: "left" }}>
          <strong>How admin sign-in works:</strong> with no staff, the admin login asks
          for your password only. As soon as you add your first staff member below, the
          login also asks for a <strong>username</strong> — you sign in as{" "}
          <code>owner</code> with your admin password, and each staff member signs in
          with the username you give them.
        </div>
        <div className="admin-form__card">
          {loading ? (
            <div className="admin-field__hint">Loading staff…</div>
          ) : items.length === 0 ? (
            <div className="staff-empty">
              <p className="staff-empty__title">No staff yet</p>
              <p className="admin-field__hint">
                Add a staff member to give a teammate limited access to this admin — they&apos;ll only
                see the modules you allow.
              </p>
              <button className="admin-form__save" onClick={onAdd}>
                Add your first staff member
              </button>
            </div>
          ) : (
            <div className="staff-list">
              {items.map((s) => (
                <div key={s.id} className={`staff-row ${s.status === "suspended" ? "is-suspended" : ""}`}>
                  <div className="staff-row__main">
                    <div className="staff-row__name">{s.fullName}</div>
                    <div className="staff-row__meta">
                      {s.email} · <code>@{s.username}</code>
                    </div>
                    <div className="staff-row__perms">{permissionSummary(s.permissions)}</div>
                  </div>
                  <div className="staff-row__side">
                    <span className={`staff-badge staff-badge--${s.status}`}>
                      {s.status === "active" ? "Active" : "Suspended"}
                    </span>
                    <div className="staff-row__actions">
                      <button
                        className="admin-btn admin-btn--ghost"
                        onClick={() => onEdit(s)}
                        disabled={busyId === s.id}
                      >
                        Edit
                      </button>
                      <button
                        className="admin-btn admin-btn--ghost"
                        onClick={() => toggleStatus(s)}
                        disabled={busyId === s.id}
                      >
                        {s.status === "active" ? "Suspend" : "Activate"}
                      </button>
                      <button
                        className="admin-btn admin-btn--danger"
                        onClick={() => remove(s)}
                        disabled={busyId === s.id}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
