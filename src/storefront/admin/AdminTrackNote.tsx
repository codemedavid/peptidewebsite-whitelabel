"use client";

// Store-admin editor (OWNER-ONLY) for the Track-Order Delivery Note — the
// informational card shown on the storefront Track Order page, under the
// order-number search box. The owner flips it on/off and edits the copy + the
// region → estimate rows; a live preview on the right renders the REAL
// <TrackNoteCard> with the tenant's theme tokens, so what the owner previews is
// exactly what ships.
//
// Saves through saveTrackNoteAction (read-modify-write into
// branding.config.trackNote, sanitized server-side) and mirrors into the live
// brand via setTweak. No operator entitlement — any store may use it, so this
// view is always available to the owner.

import { useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { saveTrackNoteAction } from "@/actions/storefront-admin";
import {
  DEFAULT_TRACK_NOTE,
  TRACK_NOTE_EXAMPLE,
  normalizeTrackNote,
  type TrackNoteConfig,
  type TrackNoteRow,
} from "@/lib/storefront/track-note";
import { TrackNoteCard } from "../components/TrackNoteCard";

// Rows are edited one-per-line as "Region | Estimate". The normalizer drops any
// fully-blank row, so trailing newlines are fine.
function rowsToText(rows: TrackNoteRow[]): string {
  return rows.map((r) => `${r.region} | ${r.estimate}`).join("\n");
}
function textToRows(text: string): TrackNoteRow[] {
  return text.split(/\n+/).map((line) => {
    const idx = line.indexOf("|");
    if (idx === -1) return { region: line.trim(), estimate: "" };
    return { region: line.slice(0, idx).trim(), estimate: line.slice(idx + 1).trim() };
  });
}

export function AdminTrackNote({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { setTweak, toast } = useStore();
  const initial = brand.trackNote ?? DEFAULT_TRACK_NOTE;

  const [enabled, setEnabled] = useState(initial.enabled === true);
  const [title, setTitle] = useState(initial.title);
  const [subtitle, setSubtitle] = useState(initial.subtitle);
  const [rowsText, setRowsText] = useState(rowsToText(initial.rows));
  const [footnote, setFootnote] = useState(initial.footnote);
  const [saving, setSaving] = useState(false);

  // Fill the fields with the J&T Davao starter example. Does not save or toggle
  // it live — the owner reviews, edits and Saves like any other change.
  const loadExample = () => {
    setTitle(TRACK_NOTE_EXAMPLE.title);
    setSubtitle(TRACK_NOTE_EXAMPLE.subtitle);
    setRowsText(rowsToText(TRACK_NOTE_EXAMPLE.rows));
    setFootnote(TRACK_NOTE_EXAMPLE.footnote);
  };

  // Build the config the way it will persist (normalized) so the preview is
  // exactly what ships.
  const draft: TrackNoteConfig = normalizeTrackNote({
    enabled,
    title,
    subtitle,
    rows: textToRows(rowsText),
    footnote,
  });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await saveTrackNoteAction({
        enabled,
        title,
        subtitle,
        rows: textToRows(rowsText),
        footnote,
      });
      if ("error" in res) {
        toast(res.error);
        return;
      }
      // Mirror into the live brand so the open storefront reflects it without a
      // reload (the DB copy is what the next visit reads).
      setTweak({ trackNote: draft });
      toast(enabled ? "Delivery note on" : "Delivery note off");
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
          <span style={{ fontSize: 20 }}>🚚</span>
          Delivery Note
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
        <div className="sf-notice-editor">
          {/* ── Editor column ─────────────────────────────────────────────── */}
          <div className="admin-form__card">
            <h2 className="admin-form__section">🚚 Track-page delivery note</h2>
            <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 14 }}>
              A small info card shown on your Track Order page, right under the
              order-number search box. Use it for courier delivery estimates or any
              short shipping note.
            </div>
            <div className="admin-field" style={{ marginBottom: 18 }}>
              <button type="button" className="admin-btn admin-btn--ghost" onClick={loadExample}>
                Load J&amp;T Davao example
              </button>
              <div className="admin-field__hint">
                Fills the fields below with a sample courier table you can keep or edit.
              </div>
            </div>

            <div className="admin-field" style={{ marginBottom: 18 }}>
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEnabled(e.target.checked)}
                />
                <span>Show the delivery note on my Track Order page</span>
              </label>
              <div className="admin-field__hint">
                Turn it off to hide the card without losing your copy.
              </div>
            </div>

            <div className="admin-field">
              <label className="admin-field__label">Title</label>
              <input className="admin-input" value={title} maxLength={120}
                     onChange={(e) => setTitle(e.target.value)}
                     placeholder="J&T Express Delivery Estimates" />
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Subtitle</label>
              <input className="admin-input" value={subtitle} maxLength={120}
                     onChange={(e) => setSubtitle(e.target.value)}
                     placeholder="from Davao City" />
              <div className="admin-field__hint">A short qualifier next to the title. Leave blank to hide.</div>
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Rows</label>
              <textarea className="admin-textarea" rows={5} value={rowsText}
                        onChange={(e) => setRowsText(e.target.value)}
                        placeholder={"Mindanao | 1–5 days\nMetro Manila & Luzon | 3–7 days"} />
              <div className="admin-field__hint">
                One region per line, as <code>Region | Estimate</code>. They fill a
                two-column grid top-to-bottom.
              </div>
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Footnote</label>
              <textarea className="admin-textarea" rows={2} value={footnote}
                        onChange={(e) => setFootnote(e.target.value)}
                        placeholder="* Sending day not counted. · Business days only." />
              <div className="admin-field__hint">Fine print under the grid. Leave blank to hide.</div>
            </div>
          </div>

          {/* ── Live preview column ───────────────────────────────────────── */}
          <div className="sf-notice-editor__preview">
            <div className="admin-field__hint" style={{ marginBottom: 10 }}>
              Live preview — your storefront theme{enabled ? "" : " (currently hidden from customers)"}
            </div>
            <div className="sf-root">
              <TrackNoteCard config={draft} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
