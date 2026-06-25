"use client";

// Store-admin view for the homepage hero copy — the SAME branding.config.hero*
// text fields the platform operator can set in the Branding editor's Hero tab,
// now editable by the store owner. Only the copy is exposed here (chip label,
// the two headline lines, the tagline, and the two CTA labels); layout,
// typography and the hero variant stay operator-controlled. Saves through
// saveHeroContentAction (read-modify-write into branding.config) and mirrors
// into the live brand via setTweak so the open storefront's hero updates
// without a reload.

import { useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { saveHeroContentAction } from "@/actions/storefront-admin";

export function AdminHeroSettings({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { setTweak, toast } = useStore();
  const [chip, setChip] = useState(brand.heroChipLabel ?? "");
  const [line1, setLine1] = useState(brand.heroLine1 ?? "");
  const [line2, setLine2] = useState(brand.heroLine2 ?? "");
  const [sub, setSub] = useState(brand.heroSub ?? "");
  const [cta1, setCta1] = useState(brand.heroCta1 ?? "");
  const [cta2, setCta2] = useState(brand.heroCta2 ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const value = {
        heroChipLabel: chip.trim(),
        heroLine1: line1.trim(),
        heroLine2: line2.trim(),
        heroSub: sub.trim(),
        heroCta1: cta1.trim(),
        heroCta2: cta2.trim(),
      };
      const res = await saveHeroContentAction(value);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      // Mirror into the live brand so the open storefront's hero picks up the
      // new copy immediately (the DB copy serves every other device).
      setTweak(value);
      toast("Hero section saved");
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
          <span style={{ fontSize: 20 }}>✨</span>
          Hero Section
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
        <div className="admin-form__card" style={{ maxWidth: 640 }}>
          <h2 className="admin-form__section">✨ Homepage Hero</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            The big banner at the top of your storefront homepage. Edit the
            headline, tagline and button labels here — colors, fonts and layout
            are set by your provider.
          </div>

          <div className="admin-field" style={{ marginBottom: 14 }}>
            <label className="admin-field__label">Badge / chip label</label>
            <input
              className="admin-input"
              value={chip}
              maxLength={120}
              placeholder={brand.name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChip(e.target.value)}
            />
            <div className="admin-field__hint">
              The small pill above the headline. Leave blank to show your store name.
            </div>
          </div>

          <div className="admin-field" style={{ marginBottom: 14 }}>
            <label className="admin-field__label">Headline — line 1</label>
            <input
              className="admin-input"
              value={line1}
              maxLength={120}
              placeholder="Premium products,"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLine1(e.target.value)}
            />
          </div>

          <div className="admin-field" style={{ marginBottom: 14 }}>
            <label className="admin-field__label">Headline — line 2 (accent)</label>
            <input
              className="admin-input"
              value={line2}
              maxLength={120}
              placeholder="for everyone"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLine2(e.target.value)}
            />
            <div className="admin-field__hint">
              The highlighted second line. Leave blank for a single-line headline.
            </div>
          </div>

          <div className="admin-field" style={{ marginBottom: 14 }}>
            <label className="admin-field__label">Tagline</label>
            <textarea
              className="admin-input"
              rows={3}
              value={sub}
              maxLength={400}
              placeholder="A short sentence describing what your store offers."
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSub(e.target.value)}
            />
            <div className="admin-field__hint">
              The supporting text under the headline.
            </div>
          </div>

          <div className="admin-field" style={{ marginBottom: 14 }}>
            <label className="admin-field__label">Primary button label</label>
            <input
              className="admin-input"
              value={cta1}
              maxLength={120}
              placeholder="Shop Now"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCta1(e.target.value)}
            />
          </div>

          <div className="admin-field" style={{ marginBottom: 4 }}>
            <label className="admin-field__label">Secondary button label</label>
            <input
              className="admin-input"
              value={cta2}
              maxLength={120}
              placeholder="Learn more"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCta2(e.target.value)}
            />
            <div className="admin-field__hint">
              Leave blank to hide the second button.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
