"use client";

// Store-admin editor (OWNER-ONLY) for the Storefront Notice Modal — the
// per-tenant disclaimer that pops up on every storefront visit. The owner flips
// it on/off and edits every line of copy; a live preview on the right renders
// the REAL <NoticeModalCard> with the tenant's theme tokens, so what the owner
// previews is exactly what ships.
//
// Saves through saveNoticeModalAction (read-modify-write into
// branding.config.noticeModal, sanitized server-side) and mirrors into the live
// brand via setTweak. The super-admin grant (operatorEnabled) is server-held —
// this view only appears when it is on (brand.showAdminNotice) and can never
// change it.

import { useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { saveNoticeModalAction } from "@/actions/storefront-admin";
import {
  DEFAULT_NOTICE_MODAL,
  normalizeNoticeModal,
  type NoticeModalConfig,
} from "@/lib/storefront/notice-modal";
import { NoticeModalCard } from "../components/NoticeModal";

// Paragraphs are separated by a blank line in the textarea; delivery entries by
// a single newline. The normalizer drops any blanks, so trailing newlines are ok.
function toParagraphs(text: string): string[] {
  return text.split(/\n{2,}/);
}
function toLines(text: string): string[] {
  return text.split(/\n+/);
}

export function AdminNoticeModal({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { setTweak, toast } = useStore();
  const initial = brand.noticeModal ?? DEFAULT_NOTICE_MODAL;

  const [enabled, setEnabled] = useState(initial.enabled === true);
  const [title, setTitle] = useState(initial.title);
  const [subtitle, setSubtitle] = useState(initial.subtitle);
  const [body, setBody] = useState(initial.bodyParagraphs.join("\n\n"));
  const [warningTitle, setWarningTitle] = useState(initial.warningTitle);
  const [warningBody, setWarningBody] = useState(initial.warningBody);
  const [deliveryTitle, setDeliveryTitle] = useState(initial.deliveryTitle);
  const [deliveryLines, setDeliveryLines] = useState(initial.deliveryLines.join("\n"));
  const [agreeLabel, setAgreeLabel] = useState(initial.agreeLabel);
  const [footerNote, setFooterNote] = useState(initial.footerNote);
  const [saving, setSaving] = useState(false);

  // Build the config the way it will persist (normalized) so the preview is
  // exactly what ships. operatorEnabled is forced true here purely so the preview
  // renders — the server keeps the real grant; this view only exists when granted.
  const draft: NoticeModalConfig = normalizeNoticeModal({
    operatorEnabled: true,
    enabled,
    title,
    subtitle,
    bodyParagraphs: toParagraphs(body),
    warningTitle,
    warningBody,
    deliveryTitle,
    deliveryLines: toLines(deliveryLines),
    agreeLabel,
    footerNote,
  });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await saveNoticeModalAction({
        enabled,
        title,
        subtitle,
        bodyParagraphs: toParagraphs(body),
        warningTitle,
        warningBody,
        deliveryTitle,
        deliveryLines: toLines(deliveryLines),
        agreeLabel,
        footerNote,
      });
      if ("error" in res) {
        toast(res.error);
        return;
      }
      // Mirror into the live brand so the open storefront reflects it without a
      // reload (the DB copy is what the next visit reads).
      setTweak({ noticeModal: draft });
      toast(enabled ? "Notice modal on" : "Notice modal off");
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
          <span style={{ fontSize: 20 }}>⚠️</span>
          Notice Modal
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
            <h2 className="admin-form__section">⚠️ Storefront notice</h2>
            <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
              A pop-up shown to every customer each time they open your store. Use
              it for a disclaimer, delivery cut-offs or any must-read note.
            </div>

            <div className="admin-field" style={{ marginBottom: 18 }}>
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEnabled(e.target.checked)}
                />
                <span>Show the notice modal on my storefront</span>
              </label>
              <div className="admin-field__hint">
                When on, the notice appears on every visit until the customer taps
                the agree button. Turn it off to hide it without losing your copy.
              </div>
            </div>

            <div className="admin-field">
              <label className="admin-field__label">Title</label>
              <input className="admin-input" value={title} maxLength={200}
                     onChange={(e) => setTitle(e.target.value)} placeholder="Important Notice" />
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Subtitle</label>
              <input className="admin-input" value={subtitle} maxLength={200}
                     onChange={(e) => setSubtitle(e.target.value)}
                     placeholder="Please read before continuing" />
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Body</label>
              <textarea className="admin-textarea" rows={7} value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="One paragraph per block. Separate paragraphs with a blank line." />
              <div className="admin-field__hint">Separate paragraphs with a blank line.</div>
            </div>

            <h2 className="admin-form__section" style={{ marginTop: 22 }}>Warning callout</h2>
            <div className="admin-field">
              <label className="admin-field__label">Warning title</label>
              <input className="admin-input" value={warningTitle} maxLength={200}
                     onChange={(e) => setWarningTitle(e.target.value)}
                     placeholder="NO MEET UPS · NO PICK UPS · NO RUSH ORDERS" />
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Warning body</label>
              <textarea className="admin-textarea" rows={2} value={warningBody}
                        onChange={(e) => setWarningBody(e.target.value)}
                        placeholder="Orders are processed and shipped in the order received." />
              <div className="admin-field__hint">Leave both blank to hide this red callout.</div>
            </div>

            <h2 className="admin-form__section" style={{ marginTop: 22 }}>Delivery cut-off</h2>
            <div className="admin-field">
              <label className="admin-field__label">Section title</label>
              <input className="admin-input" value={deliveryTitle} maxLength={200}
                     onChange={(e) => setDeliveryTitle(e.target.value)}
                     placeholder="DELIVERY CUT-OFF TIMES" />
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Lines</label>
              <textarea className="admin-textarea" rows={3} value={deliveryLines}
                        onChange={(e) => setDeliveryLines(e.target.value)}
                        placeholder={"J&T Express: Cut-off 3:00 PM.\nSame-Day: booking starts 2:00 PM."} />
              <div className="admin-field__hint">One line per entry. Leave blank to hide this box.</div>
            </div>

            <h2 className="admin-form__section" style={{ marginTop: 22 }}>Footer</h2>
            <div className="admin-field">
              <label className="admin-field__label">Agree button label</label>
              <input className="admin-input" value={agreeLabel} maxLength={200}
                     onChange={(e) => setAgreeLabel(e.target.value)}
                     placeholder="I Understand & Agree" />
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Footer note</label>
              <input className="admin-input" value={footerNote} maxLength={200}
                     onChange={(e) => setFooterNote(e.target.value)}
                     placeholder="This notice is shown on every visit to the storefront." />
            </div>
          </div>

          {/* ── Live preview column ───────────────────────────────────────── */}
          <div className="sf-notice-editor__preview">
            <div className="admin-field__hint" style={{ marginBottom: 10 }}>
              Live preview — your storefront theme{enabled ? "" : " (currently hidden from customers)"}
            </div>
            <div className="sf-notice-preview">
              <NoticeModalCard config={draft} onAgree={() => toast("This is a preview")} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
