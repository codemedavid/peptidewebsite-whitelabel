"use client";

// Store-admin editor for the Announcement Pop-up — the owner's news / new-drop /
// promo pop-up (ported from MamaMicaGlow's app pop-up). Form on the left, a live
// preview on the right that renders the REAL <AnnouncementPopupCard> inside the
// tenant's theme, so what the owner previews is exactly what shoppers see.
//
// Saves through saveAnnouncementPopupAction (sanitized + versioned server-side
// into branding.config.announcementPopup) and mirrors into the live brand via
// setTweak so the open storefront updates without a reload.

import { useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { isPageVisible } from "../visibility";
import { saveAnnouncementPopupAction } from "@/actions/storefront-admin";
import { uploadStorefrontImageAction } from "@/actions/media";
import { imageUrl } from "@/lib/media/image-url";
import { HERO_LINK_PAGES } from "@/lib/storefront/hero-links";
import {
  DEFAULT_ANNOUNCEMENT_POPUP,
  KIND_META,
  LAYOUT_META,
  POPUP_DELAYS,
  POPUP_KINDS,
  POPUP_LAYOUTS,
  POPUP_LIMITS,
  normalizeAnnouncementPopup,
  preparePopupForSave,
  validatePopup,
  type AnnouncementPopup,
  type PopupAction,
  type PopupField,
  type PopupImage,
} from "@/lib/storefront/announcement-popup";
import { AnnouncementPopupCard } from "../components/AnnouncementPopup";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // matches uploadStorefrontImageAction

const PAGE_LABELS: Record<string, string> = {
  home: "Home",
  catalog: "Shop / catalog",
  reviews: "Reviews",
  faq: "FAQ",
  coa: "Lab reports",
  protocols: "Protocols",
  calculator: "Calculator",
  track: "Track order",
  merchant: "Reseller page",
  articles: "Articles",
  assessment: "Assessment",
};

const ACTION_LABELS: Record<PopupAction, string> = {
  close: "Just close the pop-up",
  page: "Open a page on my store",
  product: "Open a product",
  link: "Open a web link",
};

/** width / height of a picked file, so the card reserves the right space. */
function readAspect(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve(img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(1);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function Choice({
  pressed,
  onClick,
  label,
  hint,
}: {
  pressed: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button type="button" className="sf-popup-editor__opt" aria-pressed={pressed} onClick={onClick}>
      {label}
      <small>{hint}</small>
    </button>
  );
}

export function AdminAnnouncementPopup({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { setTweak, toast, products } = useStore();
  const stored = brand.announcementPopup ?? DEFAULT_ANNOUNCEMENT_POPUP;
  const [draft, setDraft] = useState<AnnouncementPopup>(stored);
  const [errors, setErrors] = useState<Partial<Record<PopupField, string>>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const set = <K extends keyof AnnouncementPopup>(key: K, value: AnnouncementPopup[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const pages = [...HERO_LINK_PAGES].filter((p) => isPageVisible(brand, p));
  const linkedProduct =
    draft.action === "product" ? products.find((p) => p.id === draft.productId) : undefined;
  const preview = normalizeAnnouncementPopup({ ...draft, version: "preview" });

  const upload = async (file: File | undefined | null) => {
    if (!file || uploading) return;
    if (file.size > MAX_IMAGE_BYTES) {
      toast("That image is over 10 MB — please pick a smaller one.");
      return;
    }
    setUploading(true);
    try {
      const aspect = await readAspect(file);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "storefront");
      const res = await uploadStorefrontImageAction(fd);
      if ("error" in res) {
        toast(`Couldn't upload the image: ${res.error}`);
        return;
      }
      const image: PopupImage = { url: res.url, aspect };
      set("image", image);
    } catch {
      toast("Upload failed — please try again.");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (saving) return;
    const problems = validatePopup(draft);
    if (problems.length > 0) {
      setErrors(Object.fromEntries(problems.map((p) => [p.field, p.message])));
      toast(problems[0].message);
      return;
    }
    setSaving(true);
    try {
      const prepared = preparePopupForSave(draft);
      const res = await saveAnnouncementPopupAction(prepared);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setDraft(prepared);
      setTweak({ announcementPopup: prepared });
      toast(prepared.enabled ? "Pop-up is live" : "Pop-up saved (off)");
    } catch {
      toast("Couldn't save — please sign in again and retry.");
    } finally {
      setSaving(false);
    }
  };

  // Clears this browser's "already seen" memory and opens the store in a new
  // tab, so the owner can watch the pop-up exactly as a first-time shopper
  // would and still has the editor open in this one.
  const showOnStore = () => {
    try {
      window.localStorage.removeItem("sf_popup_seen_v1");
      window.sessionStorage.removeItem("sf_popup_visit_v1");
    } catch {
      // Storage blocked — the pop-up still shows for a new version.
    }
    window.open("/", "_blank", "noopener");
  };

  const err = (field: PopupField) =>
    errors[field] ? <div className="sf-popup-editor__error" role="alert">{errors[field]}</div> : null;

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
          <span style={{ fontSize: 20 }}>📣</span>
          Announcement Pop-up
        </h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={save} disabled={saving || uploading}>
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      <div className="admin-form__body">
        <div className="sf-popup-editor">
          <div className="admin-form__card">
            <h2 className="admin-form__section">📣 Pop-up</h2>
            <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
              Greets shoppers when they open your store: news, a new drop or a promo
              code. It uses your store&apos;s colours and fonts automatically.
            </div>

            <div className="admin-field">
              <label className="admin-check">
                <input type="checkbox" checked={draft.enabled}
                       onChange={(e) => set("enabled", e.target.checked)} />
                <span>Show the pop-up on my store</span>
              </label>
            </div>

            <div className="admin-field">
              <span className="admin-field__label">Type</span>
              <div className="sf-popup-editor__seg">
                {POPUP_KINDS.map((k) => (
                  <Choice key={k} pressed={draft.kind === k} onClick={() => set("kind", k)}
                          label={KIND_META[k].label} hint={KIND_META[k].hint} />
                ))}
              </div>
            </div>

            <div className="admin-field">
              <label className="admin-field__label" htmlFor="pp-title">Title</label>
              <input id="pp-title" className="admin-input" value={draft.title} maxLength={POPUP_LIMITS.title}
                     onChange={(e) => set("title", e.target.value)} placeholder="GHK-Cu is back in stock" />
              {err("title")}
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="pp-msg">Message</label>
              <textarea id="pp-msg" className="admin-textarea" rows={4} value={draft.message}
                        maxLength={POPUP_LIMITS.message} onChange={(e) => set("message", e.target.value)}
                        placeholder="Limited vials this round — order before Friday." />
              <div className="admin-field__hint">{draft.message.length}/{POPUP_LIMITS.message}</div>
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="pp-code">Promo code (optional)</label>
              <input id="pp-code" className="admin-input" value={draft.code} maxLength={POPUP_LIMITS.code}
                     onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="SLIM10" />
              <div className="admin-field__hint">Shown as a chip shoppers can tap to copy.</div>
            </div>

            <h2 className="admin-form__section" style={{ marginTop: 22 }}>Image</h2>
            <div className="admin-field">
              <div className="sf-popup-editor__image">
                {draft.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- ImageKit sizing via imageUrl()
                  <img className="sf-popup-editor__thumb" src={imageUrl(draft.image.url, { width: 144 })} alt="" />
                ) : (
                  <span className="sf-popup-editor__thumb" aria-hidden="true" />
                )}
                <label className="admin-form__save" style={{ cursor: "pointer" }}>
                  {uploading ? "Uploading…" : draft.image ? "Replace image" : "Upload image"}
                  <input type="file" accept="image/*" hidden disabled={uploading}
                         onChange={(e) => {
                           void upload(e.target.files?.[0]);
                           e.target.value = "";
                         }} />
                </label>
                {draft.image && (
                  <button type="button" className="admin-form__back" onClick={() => set("image", null)}>
                    Remove
                  </button>
                )}
              </div>
              {!draft.image && linkedProduct?.image && (
                <div className="admin-field__hint">No image? The linked product&apos;s photo is used.</div>
              )}
            </div>
            <div className="admin-field">
              <span className="admin-field__label">Layout</span>
              <div className="sf-popup-editor__seg">
                {POPUP_LAYOUTS.map((l) => (
                  <Choice key={l} pressed={draft.layout === l} onClick={() => set("layout", l)}
                          label={LAYOUT_META[l].label} hint={LAYOUT_META[l].hint} />
                ))}
              </div>
            </div>

            <h2 className="admin-form__section" style={{ marginTop: 22 }}>Button</h2>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="pp-btn">Button text</label>
              <input id="pp-btn" className="admin-input" value={draft.buttonLabel}
                     maxLength={POPUP_LIMITS.buttonLabel} onChange={(e) => set("buttonLabel", e.target.value)}
                     placeholder={KIND_META[draft.kind].defaultButton} />
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="pp-action">When tapped</label>
              <select id="pp-action" className="admin-input" value={draft.action}
                      onChange={(e) => set("action", e.target.value as PopupAction)}>
                {(Object.keys(ACTION_LABELS) as PopupAction[]).map((a) => (
                  <option key={a} value={a}>{ACTION_LABELS[a]}</option>
                ))}
              </select>
            </div>
            {draft.action === "page" && (
              <div className="admin-field">
                <label className="admin-field__label" htmlFor="pp-page">Page</label>
                <select id="pp-page" className="admin-input" value={draft.linkPage}
                        onChange={(e) => set("linkPage", e.target.value)}>
                  {pages.map((p) => <option key={p} value={p}>{PAGE_LABELS[p] ?? p}</option>)}
                </select>
              </div>
            )}
            {draft.action === "product" && (
              <div className="admin-field">
                <label className="admin-field__label" htmlFor="pp-product">Product</label>
                <select id="pp-product" className="admin-input" value={draft.productId}
                        onChange={(e) => set("productId", e.target.value)}>
                  <option value="">Choose a product…</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {err("productId")}
              </div>
            )}
            {draft.action === "link" && (
              <div className="admin-field">
                <label className="admin-field__label" htmlFor="pp-url">Web link</label>
                <input id="pp-url" className="admin-input" value={draft.linkUrl} inputMode="url"
                       onChange={(e) => set("linkUrl", e.target.value)} placeholder="https://…" />
                {err("linkUrl")}
              </div>
            )}

            <h2 className="admin-form__section" style={{ marginTop: 22 }}>When it shows</h2>
            <div className="admin-field">
              <div className="sf-popup-editor__seg">
                <Choice pressed={draft.frequency === "once"} onClick={() => set("frequency", "once")}
                        label="Once" hint="Until you change the pop-up" />
                <Choice pressed={draft.frequency === "every_visit"} onClick={() => set("frequency", "every_visit")}
                        label="Every visit" hint="Each time they come back" />
              </div>
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="pp-delay">Appears</label>
              <select id="pp-delay" className="admin-input" value={draft.delaySeconds}
                      onChange={(e) => set("delaySeconds", Number(e.target.value))}>
                {POPUP_DELAYS.map((s) => (
                  <option key={s} value={s}>{s === 0 ? "Right away" : `After ${s} seconds`}</option>
                ))}
              </select>
            </div>
            <div className="sf-popup-editor__row">
              <div className="admin-field">
                <label className="admin-field__label" htmlFor="pp-start">Start date</label>
                <input id="pp-start" type="date" className="admin-input" value={draft.startDate}
                       onChange={(e) => set("startDate", e.target.value)} />
              </div>
              <div className="admin-field">
                <label className="admin-field__label" htmlFor="pp-end">End date</label>
                <input id="pp-end" type="date" className="admin-input" value={draft.endDate}
                       onChange={(e) => set("endDate", e.target.value)} />
                {err("endDate")}
              </div>
            </div>
            <div className="admin-field__hint">Leave the dates blank to show it until you switch it off.</div>
          </div>

          <div className="sf-popup-editor__preview">
            <div className="admin-field__hint" style={{ marginBottom: 10 }}>
              Live preview, in your store&apos;s theme{draft.enabled ? "" : " (hidden from shoppers)"}
            </div>
            <div className="sf-popup-preview">
              <AnnouncementPopupCard
                popup={preview}
                fallbackImage={linkedProduct?.image}
                onPrimary={() => toast("This is a preview")}
                onClose={() => toast("This is a preview")}
              />
            </div>
            <button type="button" className="admin-form__back" style={{ marginTop: 12 }} onClick={showOnStore}>
              Show it to me on my store →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
