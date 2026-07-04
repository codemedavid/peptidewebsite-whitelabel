"use client";

// Store-admin view (OWNER-ONLY) for the "you received an order" email alert.
// The owner turns it on and sets the inbox that should hear about every new
// order. Saves through saveOrderNotificationsAction (read-modify-write into
// branding.config.orderNotifications) and mirrors into the live brand via
// setTweak. The email itself is delivered by the tenant's PostHog Messaging
// (see lib/analytics/admin-notify) — this view only captures WHERE to send it.

import { useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { saveOrderNotificationsAction } from "@/actions/storefront-admin";
import { isValidEmail } from "@/lib/analytics/events";

const EMAIL_MAX = 254; // RFC-5321 max address length

export function AdminOrderNotifications({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { setTweak, toast } = useStore();
  const initial = brand.orderNotifications ?? { enabled: false, email: "" };
  const [enabled, setEnabled] = useState<boolean>(initial.enabled === true);
  const [email, setEmail] = useState<string>(initial.email ?? "");
  const [saving, setSaving] = useState(false);

  const emailValid = isValidEmail(email);
  // Enabling demands a valid inbox so we never persist an "on but unreachable"
  // state that silently drops alerts; turning it off can always be saved.
  const canSave = !enabled || emailValid;

  const save = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    try {
      const value = { enabled, email: email.trim() };
      const res = await saveOrderNotificationsAction(value);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      // Mirror into the live brand so a second admin panel reflects it without a
      // reload (the DB copy is what checkout reads on the next order).
      setTweak({ orderNotifications: value });
      toast(enabled ? "Order alerts on" : "Order alerts off");
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Dashboard
        </button>
        <h1 className="admin-form__title">
          <span style={{ fontSize: 20 }}>🔔</span>
          Order Notifications
        </h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={save} disabled={saving || !canSave}>
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
          <h2 className="admin-form__section">🔔 Email me on new orders</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            Get an email the moment a customer places an order, so you never miss
            one. The email carries the order number, total and who ordered.
          </div>

          <div className="admin-field" style={{ marginBottom: 14 }}>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEnabled(e.target.checked)}
              />
              <span>Email me when I receive an order</span>
            </label>
            <div className="admin-field__hint">
              When on, every new order sends one email to the address below.
              Existing orders are never re-sent.
            </div>
          </div>

          {enabled && (
            <div className="admin-field" style={{ marginBottom: 8 }}>
              <label className="admin-field__label">Send alerts to</label>
              <input
                className="admin-input"
                type="email"
                inputMode="email"
                value={email}
                maxLength={EMAIL_MAX}
                placeholder="you@gmail.com"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              />
              <div className="admin-field__hint">
                {email.trim() && !emailValid
                  ? "That doesn't look like a valid email address."
                  : "Any inbox works — your Gmail, a shared team address, etc."}
              </div>
            </div>
          )}

          <div className="admin-field__hint" style={{ marginTop: 16, opacity: 0.8 }}>
            Alerts are delivered through your store&apos;s connected analytics
            (PostHog Messaging). If you&apos;ve just enabled this and aren&apos;t
            receiving emails, ask your provider to confirm PostHog is connected.
          </div>
        </div>
      </div>
    </div>
  );
}
