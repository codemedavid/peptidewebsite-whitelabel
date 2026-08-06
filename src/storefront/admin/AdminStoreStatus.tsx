"use client";

// Store-admin editor for the OPEN/CLOSED switch — the owner's "we're shut right
// now" control, for a restock, a holiday, or a backlog they need to clear.
//
// Closing does NOT hide the store. The catalog stays browsable with every price
// on show; only the buying stops. That is deliberate: a shopper who arrives
// mid-restock can still see what the store sells and decide to come back.
//
// Saves through saveStoreStatusAction (read-modify-write into
// branding.config.storeStatus, re-normalized server-side) and mirrors into the
// live brand via setTweak so the open storefront reflects it without a reload.
// Grantable to staff ("store-status") — see admin/staff-permissions.

import { useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { saveStoreStatusAction } from "@/actions/storefront-admin";
import {
  MAX_STORE_CLOSED_HEADLINE,
  MAX_STORE_CLOSED_MESSAGE,
  STORE_STATUS_DEFAULT,
  buildStoreClosedNotice,
  normalizeStoreStatus,
} from "@/lib/storefront/store-status";

export function AdminStoreStatus({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { setTweak, toast } = useStore();
  const initial = brand.storeStatus ?? STORE_STATUS_DEFAULT;

  const [open, setOpen] = useState(initial.open !== false);
  const [headline, setHeadline] = useState(initial.headline);
  const [message, setMessage] = useState(initial.message);
  const [saving, setSaving] = useState(false);

  const draft = normalizeStoreStatus({ open, headline, message });
  // Exactly what the storefront banner will render — same builder, so the
  // preview can't drift from the real thing.
  const preview = buildStoreClosedNotice(draft, brand.name);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await saveStoreStatusAction({ open, headline, message });
      if ("error" in res) {
        toast(res.error);
        return;
      }
      // Mirror into the live brand so the open storefront reflects it without a
      // reload (the DB copy is what the next visit reads).
      setTweak({ storeStatus: draft });
      toast(open ? "Store is open" : "Store is closed");
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
          <span style={{ fontSize: 20 }}>{open ? "🟢" : "🔴"}</span>
          Store Status
        </h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={save} disabled={saving}>
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
          <h2 className="admin-form__section">
            {open ? "🟢 Your store is open" : "🔴 Your store is closed"}
          </h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            Closing stops all orders without hiding your shop. Customers can still
            browse your products and see your prices — every &ldquo;Add to
            Cart&rdquo; button just reads <strong>Closed</strong> until you
            reopen.
          </div>

          <div className="admin-field" style={{ marginBottom: 18 }}>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={!open}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOpen(!e.target.checked)}
              />
              <span>Close my store — stop taking orders</span>
            </label>
            <div className="admin-field__hint">
              Leave this off for business as usual. Turning it on takes effect
              immediately, including for customers who already have items in their
              cart.
            </div>
          </div>

          <h2 className="admin-form__section" style={{ marginTop: 22 }}>
            What customers see
          </h2>

          <div className="admin-field">
            <label className="admin-field__label">Headline (optional)</label>
            <input
              className="admin-input"
              value={headline}
              maxLength={MAX_STORE_CLOSED_HEADLINE}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder={`Hello — ${brand.name || "your store"} is currently closed`}
            />
            <div className="admin-field__hint">
              Leave this blank and we&rsquo;ll greet your customers by your
              business name automatically.
            </div>
          </div>

          <div className="admin-field">
            <label className="admin-field__label">Your message</label>
            <textarea
              className="admin-textarea"
              rows={4}
              value={message}
              maxLength={MAX_STORE_CLOSED_MESSAGE}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="We're restocking this week — back open Monday 9am. Thanks for your patience!"
            />
            <div className="admin-field__hint">
              Tell customers why you&rsquo;re closed and when you&rsquo;ll be
              back. {message.length}/{MAX_STORE_CLOSED_MESSAGE}
            </div>
          </div>

          <h2 className="admin-form__section" style={{ marginTop: 22 }}>Preview</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 12 }}>
            {open
              ? "Nothing shows while your store is open — this is what customers would see if you closed it."
              : "This banner sits above your catalog on every page."}
          </div>
          {/* The real banner markup, so the preview and the storefront can't
              disagree. Rendered here even while open, as a what-if. */}
          <aside className="sf-closed sf-closed--preview" aria-hidden="true">
            <div className="sf-closed__inner">
              <span className="sf-closed__badge">Closed</span>
              <div className="sf-closed__copy">
                <p className="sf-closed__headline">{preview.headline}</p>
                {preview.message && <p className="sf-closed__message">{preview.message}</p>}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
