"use client";

import { useState } from "react";
import type { Brand, Protocol } from "../types";
import { useStore } from "../store";
import { uploadStorefrontImageAction } from "@/actions/media";
import { resolveProtocolImages, MAX_PROTOCOL_IMAGES } from "@/lib/storefront/protocol-images";
import { saveProtocolsNoteAction } from "@/actions/storefront-admin";
import { OWNER_NOTE_MAX, normalizeOwnerNote } from "@/lib/storefront/linkify";
import { LinkifiedText } from "../components/LinkifiedText";

export function AdminProtocolsManager({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { protocols, setProtocols, categories, toast, setTweak } = useStore();
  const [list, setList] = useState<Protocol[]>(protocols);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Index of the protocol whose image is currently uploading (null = none).
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  // The note under the page title (brand.protocolsNote). Saved by the same Save
  // button as the list, so the owner has one place to commit their edits.
  const [note, setNote] = useState(brand.protocolsNote ?? "");
  const [noteDirty, setNoteDirty] = useState(false);
  const editNote = (next: string) => {
    setNote(next.slice(0, OWNER_NOTE_MAX));
    setNoteDirty(true);
  };
  const unsaved = dirty || noteDirty;

  const edit = (next: Protocol[]) => {
    setList(next);
    setDirty(true);
  };

  // Prepend so the fresh card lands at the top of the list, right under the
  // header, instead of below the (potentially long) existing guide.
  const add = () =>
    edit([
      {
        category: "General",
        name: "New Protocol",
        dosage: "",
        frequency: "",
        duration: "",
        notes: [""],
        storage: "",
        images: [],
        mode: "details",
      },
      ...list,
    ]);

  const update = (i: number, patch: Partial<Protocol>) =>
    edit(list.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const remove = (i: number) => {
    if (!confirm("Delete this protocol?")) return;
    edit(list.filter((_, j) => j !== i));
  };

  // Upload one or more protocol images to the tenant's ImageKit folder and
  // append the hosted URLs to this protocol's gallery. Uploads run
  // sequentially so a partial failure still keeps the images that succeeded.
  const handleImages = async (i: number, files: FileList | null) => {
    const picked = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (picked.length === 0) {
      if (files && files.length > 0) alert("Please pick image files.");
      return;
    }
    const current = resolveProtocolImages(list[i]);
    const room = MAX_PROTOCOL_IMAGES - current.length;
    if (room <= 0) {
      alert(`Up to ${MAX_PROTOCOL_IMAGES} images per protocol.`);
      return;
    }
    setUploadingIdx(i);
    try {
      const uploaded: string[] = [];
      for (const file of picked.slice(0, room)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", "protocol-image");
        const res = await uploadStorefrontImageAction(fd);
        if ("url" in res) uploaded.push(res.url);
        else alert(res.error);
      }
      if (uploaded.length > 0) update(i, { images: [...current, ...uploaded] });
    } catch {
      alert("Image upload failed — please try again.");
    } finally {
      setUploadingIdx(null);
    }
  };

  // Remove a single image from this protocol's gallery by position.
  const removeImage = (i: number, k: number) =>
    update(i, { images: resolveProtocolImages(list[i]).filter((_, idx) => idx !== k) });

  // Shared thumbnail-grid editor: existing images with a remove button, plus an
  // "add" tile (hidden once the per-protocol cap is reached). Used by both the
  // image-only mode and the optional gallery under the details fields.
  const galleryEditor = (i: number, p: Protocol) => {
    const imgs = resolveProtocolImages(p);
    const atMax = imgs.length >= MAX_PROTOCOL_IMAGES;
    return (
      <div className="protocols-thumb-grid">
        {imgs.map((src, k) => (
          <div key={k} className="protocols-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`${p.name} protocol ${k + 1}`} className="protocols-thumb__img" />
            <button
              type="button"
              className="protocols-thumb__remove"
              aria-label="Remove image"
              onClick={() => removeImage(i, k)}
            >
              ×
            </button>
          </div>
        ))}
        {!atMax && (
          <label className="protocols-thumb protocols-thumb--add" style={{ cursor: "pointer" }}>
            <span>{uploadingIdx === i ? "Uploading…" : "+ Add images"}</span>
            <input
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              disabled={uploadingIdx === i}
              onChange={(e) => void handleImages(i, e.target.files)}
            />
          </label>
        )}
      </div>
    );
  };

  // Persist the whole list to the DB (branding.config) in one shot. Done on an
  // explicit Save so inline keystrokes don't each fire a server round-trip.
  const save = async () => {
    setSaving(true);
    try {
      if (dirty) {
        // setProtocols resolves async + surfaces its own errors via toast.
        setProtocols(list);
        setDirty(false);
      }
      if (noteDirty) {
        const res = await saveProtocolsNoteAction(note);
        if ("error" in res) {
          toast(`Couldn't save the note: ${res.error}`);
          return;
        }
        // Mirror into the live brand so the open storefront shows it at once.
        setTweak({ protocolsNote: normalizeOwnerNote(note) });
        setNoteDirty(false);
      }
      toast("Protocols saved");
    } catch {
      toast("Couldn't save — please sign in again and retry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin">
      <main className="admin__inner">
        <div className="admin-table__head">
          <h1 className="admin-table__title">
            <a
              className="admin-table__title-back"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onBack();
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Dashboard
            </a>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              Protocols
            </span>
          </h1>
          <div style={{ display: "flex", gap: 10 }}>
            <a
              className="admin-btn admin-btn--ghost"
              href="#protocols"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Preview Public Page
            </a>
            <button className="admin-btn admin-btn--ghost" onClick={add}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Protocol
            </button>
            <button className="admin-btn" onClick={() => void save()} disabled={!unsaved || saving}>
              {saving ? "Saving…" : unsaved ? "Save Changes" : "Saved"}
            </button>
          </div>
        </div>

        <section className="editor-card protocols-note-editor" aria-labelledby="protocols-note-title">
          <div className="protocols-note-editor__head">
            <h2 id="protocols-note-title" className="protocols-note-editor__title">
              Page note
            </h2>
            {noteDirty && <span className="protocols-note-editor__badge">Unsaved</span>}
          </div>
          <p className="admin-field__hint protocols-note-editor__hint">
            Shown in a highlighted box under the Protocols page title. Type a web
            address like <strong>www.yoursite.com</strong> and it becomes a clickable
            link. Leave it empty to hide the box.
          </p>
          <div className="protocols-note-editor__grid">
            <div className="protocols-note-editor__field">
              <label className="small" htmlFor="protocols-note">
                Note
              </label>
              <textarea
                id="protocols-note"
                className="admin-input protocols-note-editor__input"
                rows={4}
                maxLength={OWNER_NOTE_MAX}
                value={note}
                placeholder="e.g. To access more protocols, please visit our Peptide Library at www.yoursite.com."
                onChange={(e) => editNote(e.target.value)}
              />
              <div className="protocols-note-editor__foot">
                <span aria-live="polite">
                  {note.length} / {OWNER_NOTE_MAX}
                </span>
                {note && (
                  <button type="button" className="admin-btn admin-btn--ghost protocols-note-editor__clear" onClick={() => editNote("")}>
                    Remove note
                  </button>
                )}
              </div>
            </div>
            <div className="protocols-note-editor__field">
              <span className="small">Preview</span>
              {note.trim() ? (
                <aside className="protocols__note protocols-note-editor__preview">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4M12 8h.01" />
                  </svg>
                  <p>
                    <LinkifiedText text={note} linkClassName="protocols__note-link" />
                  </p>
                </aside>
              ) : (
                <div className="protocols-note-editor__empty">No note — nothing extra shows on your page.</div>
              )}
            </div>
          </div>
        </section>

        <div className="editor-list">
          {list.map((p, i) => {
            // Effective presentation mode (undefined = legacy rows → "details").
            const mode = p.mode ?? "details";
            return (
            <div key={i} className="editor-card">
              <div className="editor-card__head">
                <input
                  className="admin-input"
                  value={p.name}
                  placeholder="Protocol name"
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                <button
                  className="admin-icon-btn admin-icon-btn--danger"
                  onClick={() => remove(i)}
                  title="Delete protocol"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              </div>

              <div className="editor-item">
                <div className="editor-item__body">
                  <div>
                    <div className="small">Category</div>
                    <select
                      value={p.category}
                      onChange={(e) => update(i, { category: e.target.value })}
                    >
                      {categories
                        .filter((c) => c.id !== "all")
                        .map((c) => (
                          <option key={c.id} value={c.label}>
                            {c.label}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <div className="small">How do you want to show this protocol?</div>
                    <div className="admin-field__hint" style={{ marginBottom: 10 }}>
                      Choose one: type out the details, or upload a single image
                      (e.g. a dosing chart) that says it all.
                    </div>
                    <div className="admin-segmented" role="group">
                      <button
                        type="button"
                        className={`admin-segmented__btn${
                          mode === "details" ? " admin-segmented__btn--active" : ""
                        }`}
                        aria-pressed={mode === "details"}
                        onClick={() => update(i, { mode: "details" })}
                      >
                        Type the details
                      </button>
                      <button
                        type="button"
                        className={`admin-segmented__btn${
                          mode === "image" ? " admin-segmented__btn--active" : ""
                        }`}
                        aria-pressed={mode === "image"}
                        onClick={() => update(i, { mode: "image" })}
                      >
                        Upload an image
                      </button>
                    </div>
                  </div>

                  {mode === "details" && (
                  <div className="protocols-pills-grid">
                    <div>
                      <div className="small">Dosage</div>
                      <input
                        value={p.dosage}
                        placeholder="e.g. 1-2mg daily"
                        onChange={(e) => update(i, { dosage: e.target.value })}
                      />
                    </div>
                    <div>
                      <div className="small">Frequency</div>
                      <input
                        value={p.frequency}
                        placeholder="e.g. Once weekly"
                        onChange={(e) => update(i, { frequency: e.target.value })}
                      />
                    </div>
                    <div>
                      <div className="small">Duration</div>
                      <input
                        value={p.duration}
                        placeholder="e.g. 8-12 weeks"
                        onChange={(e) => update(i, { duration: e.target.value })}
                      />
                    </div>
                  </div>
                  )}

                  {mode === "image" && (
                  <div>
                    <div className="small">Protocol images</div>
                    <div className="admin-field__hint" style={{ marginBottom: 10 }}>
                      Upload one or more images (e.g. dosing charts or
                      infographics). They replace the typed details on the public
                      page. Up to {MAX_PROTOCOL_IMAGES} — JPG, PNG, WebP, max 10 MB each.
                    </div>
                    {galleryEditor(i, p)}
                  </div>
                  )}

                  {mode === "details" && (
                  <div>
                    <div className="small">Notes (one per line)</div>
                    <textarea
                      value={(p.notes || []).join("\n")}
                      placeholder={`Note 1\nNote 2\nNote 3`}
                      onChange={(e) =>
                        update(i, {
                          notes: e.target.value.split("\n").filter(Boolean),
                        })
                      }
                    />
                  </div>
                  )}

                  {mode === "details" && (
                  <div>
                    <div className="small">Storage instructions</div>
                    <input
                      value={p.storage}
                      placeholder="e.g. Refrigerate at 2-8°C…"
                      onChange={(e) => update(i, { storage: e.target.value })}
                    />
                  </div>
                  )}

                  {mode === "details" && (
                  <div>
                    <div className="small">Images (optional)</div>
                    <div className="admin-field__hint" style={{ marginBottom: 10 }}>
                      Add supporting images shown below the details on the public
                      page. Up to {MAX_PROTOCOL_IMAGES}.
                    </div>
                    {galleryEditor(i, p)}
                  </div>
                  )}
                </div>
              </div>
            </div>
            );
          })}
          {list.length === 0 && (
            <div className="admin-empty-set">
              No protocols yet.
              <button className="admin-empty-set__cta" onClick={add}>
                + Add your first protocol
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
