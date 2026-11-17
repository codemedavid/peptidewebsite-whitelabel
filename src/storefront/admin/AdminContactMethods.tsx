"use client";

// Store-admin editor (OWNER-ONLY) for Contact Methods — where shoppers message
// the store about orders (checkout hand-off) and where app members ask for a
// new password ("Forgot password?" in the Pepweb app). One row per app: a
// switch, the handle / number, live validation with the same rules the server
// applies (cleanContactDestination), and a preview of the buttons customers see.
// Saves through saveStoreContactMethodsAction; the app edits the same field.

import { useMemo, useState } from "react";
import type { Brand, ContactChannel, ContactChannelType } from "../types";
import { useStore } from "../store";
import { saveStoreContactMethodsAction } from "@/actions/contact-methods";
import { CONTACT_CHANNEL_META, normalizeContactChannels } from "@/lib/storefront/contact-channels";
import { cleanContactDestination } from "@/lib/storefront/contact-methods";
import "./contact-methods.css";

const GLYPH: Record<ContactChannelType, string> = {
  whatsapp: "WA",
  telegram: "TG",
  messenger: "M",
  viber: "V",
  gmail: "@",
  instagram: "IG",
};

function rowError(c: ContactChannel): string | null {
  if (!c.enabled) return null;
  const res = cleanContactDestination(c.type, c.destination);
  return res.ok ? null : res.error;
}

export function AdminContactMethods({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { setTweak, toast } = useStore();
  const [channels, setChannels] = useState<ContactChannel[]>(() => normalizeContactChannels(brand.contactChannels));
  const [touched, setTouched] = useState<ReadonlySet<ContactChannelType>>(new Set());
  const [saving, setSaving] = useState(false);

  const errors = useMemo(() => new Map(channels.map((c) => [c.type, rowError(c)])), [channels]);
  const live = channels.filter((c) => c.enabled && !errors.get(c.type));
  const firstError = channels.map((c) => errors.get(c.type)).find(Boolean) ?? null;

  const update = (type: ContactChannelType, patch: Partial<ContactChannel>) =>
    setChannels((prev) => prev.map((c) => (c.type === type ? { ...c, ...patch } : c)));
  const touch = (type: ContactChannelType) => setTouched((prev) => new Set(prev).add(type));

  const save = async () => {
    if (saving) return;
    if (firstError) {
      setTouched(new Set(channels.map((c) => c.type)));
      toast(firstError);
      return;
    }
    setSaving(true);
    try {
      const res = await saveStoreContactMethodsAction({ channels });
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setChannels(res.channels);
      setTweak({ contactChannels: res.channels });
      toast(res.channels.some((c) => c.enabled) ? "Contact methods saved" : "Saved. No contact method is on");
    } catch {
      toast("Couldn't save. Please sign in again and retry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Dashboard
        </button>
        <h1 className="admin-form__title">
          <span style={{ fontSize: 20 }}>💬</span>
          Contact Methods
        </h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      <div className="admin-form__body">
        <div className="cm-layout">
          <section className="admin-form__card cm-card" aria-labelledby="cm-heading">
            <h2 id="cm-heading" className="admin-form__section">Where customers reach you</h2>
            <p className="admin-field__hint cm-intro">
              Used when a customer sends their order, and in the app when a member forgot their password and asks you
              for a new one. Turn on the apps you reply on.
            </p>

            <ul className="cm-list">
              {CONTACT_CHANNEL_META.map((meta) => {
                const c = channels.find((x) => x.type === meta.type)!;
                const error = touched.has(meta.type) ? errors.get(meta.type) : null;
                const inputId = `cm-${meta.type}`;
                return (
                  <li key={meta.type} className={`cm-row cm-row--${meta.type}${c.enabled ? " is-on" : ""}`}>
                    <div className="cm-row__head">
                      <span className="cm-badge" aria-hidden="true">{GLYPH[meta.type]}</span>
                      <label htmlFor={inputId} className="cm-row__label">{meta.label}</label>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={c.enabled}
                        aria-label={`${meta.label} ${c.enabled ? "on" : "off"}`}
                        className="cm-switch"
                        onClick={() => {
                          update(meta.type, { enabled: !c.enabled });
                          if (c.enabled) setTouched((prev) => { const n = new Set(prev); n.delete(meta.type); return n; });
                        }}
                      >
                        <span className="cm-switch__knob" />
                      </button>
                    </div>
                    <div className="cm-row__body">
                      <input
                        id={inputId}
                        className={`admin-input cm-input${error ? " is-invalid" : ""}`}
                        value={c.destination}
                        placeholder={meta.placeholder}
                        maxLength={120}
                        inputMode={meta.type === "whatsapp" || meta.type === "viber" ? "tel" : meta.type === "gmail" ? "email" : "text"}
                        autoComplete="off"
                        aria-invalid={!!error}
                        aria-describedby={`${inputId}-hint`}
                        onChange={(e) => update(meta.type, { destination: e.target.value, ...(e.target.value.trim() && !c.enabled ? { enabled: true } : {}) })}
                        onBlur={() => touch(meta.type)}
                      />
                      <div id={`${inputId}-hint`} className={`admin-field__hint${error ? " cm-error" : ""}`} aria-live="polite">
                        {error ?? meta.hint}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <aside className="cm-preview" aria-label="Preview">
            <div className="admin-field__hint">What customers see</div>
            <div className="cm-phone">
              <p className="cm-phone__title">Message {brand.name || "the store"}</p>
              {live.length ? (
                live.map((c) => (
                  <span key={c.type} className={`cm-chip cm-chip--${c.type}`}>
                    <span className="cm-badge" aria-hidden="true">{GLYPH[c.type]}</span>
                    {CONTACT_CHANNEL_META.find((m) => m.type === c.type)?.label}
                  </span>
                ))
              ) : (
                <p className="cm-phone__empty">
                  No contact method is on. Customers can still order, but can&apos;t message you from checkout or ask
                  for a new password in the app.
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
