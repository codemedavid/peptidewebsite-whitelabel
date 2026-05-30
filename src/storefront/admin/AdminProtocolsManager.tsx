"use client";

import { useState } from "react";
import type { Brand, Protocol } from "../types";
import { useStore } from "../store";
import { uploadStorefrontImageAction } from "@/actions/media";

export function AdminProtocolsManager({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { protocols, setProtocols, categories, toast } = useStore();
  const [list, setList] = useState<Protocol[]>(protocols);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Index of the protocol whose image is currently uploading (null = none).
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  void brand;

  const edit = (next: Protocol[]) => {
    setList(next);
    setDirty(true);
  };

  const add = () =>
    edit([
      ...list,
      {
        category: "General",
        name: "New Protocol",
        dosage: "",
        frequency: "",
        duration: "",
        notes: [""],
        storage: "",
        image: "",
      },
    ]);

  const update = (i: number, patch: Partial<Protocol>) =>
    edit(list.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const remove = (i: number) => {
    if (!confirm("Delete this protocol?")) return;
    edit(list.filter((_, j) => j !== i));
  };

  // Upload a protocol image to the tenant's ImageKit folder; store the hosted URL.
  const handleImage = async (i: number, file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Please pick an image file.");
      return;
    }
    setUploadingIdx(i);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "protocol-image");
      const res = await uploadStorefrontImageAction(fd);
      if ("url" in res) update(i, { image: res.url });
      else alert(res.error);
    } catch {
      alert("Image upload failed — please try again.");
    } finally {
      setUploadingIdx(null);
    }
  };

  // Persist the whole list to the DB (branding.config) in one shot. Done on an
  // explicit Save so inline keystrokes don't each fire a server round-trip.
  const save = () => {
    setSaving(true);
    setProtocols(list);
    setDirty(false);
    toast("Protocols saved");
    // setProtocols resolves async + surfaces its own errors via toast; flip the
    // button back so the owner can keep editing.
    setSaving(false);
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
            <button className="admin-btn" onClick={save} disabled={!dirty || saving}>
              {saving ? "Saving…" : dirty ? "Save Changes" : "Saved"}
            </button>
          </div>
        </div>

        <div className="editor-list">
          {list.map((p, i) => (
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

                  <div>
                    <div className="small">Protocol image (optional — shown on the public page)</div>
                    <div className="admin-field__hint" style={{ marginBottom: 10 }}>
                      Upload an image (e.g. a dosing chart or infographic) to show instead of typing out the details.
                    </div>
                    {p.image ? (
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.image}
                          alt={`${p.name} protocol`}
                          style={{
                            maxWidth: 220,
                            maxHeight: 160,
                            borderRadius: 8,
                            objectFit: "cover",
                            border: "1px solid var(--brand-surface, #e5e7eb)",
                          }}
                        />
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <label className="admin-image-btn" style={{ cursor: "pointer" }}>
                            {uploadingIdx === i ? "Uploading…" : "Replace image"}
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: "none" }}
                              disabled={uploadingIdx === i}
                              onChange={(e) => void handleImage(i, e.target.files?.[0])}
                            />
                          </label>
                          <button
                            className="admin-image-btn admin-image-btn--secondary"
                            type="button"
                            onClick={() => update(i, { image: "" })}
                          >
                            Remove image
                          </button>
                        </div>
                      </div>
                    ) : (
                      <label
                        className="admin-image-drop"
                        style={{ cursor: "pointer", display: "block" }}
                      >
                        {uploadingIdx === i ? (
                          <div className="admin-image-drop__title">Uploading…</div>
                        ) : (
                          <>
                            <div className="admin-image-drop__icon">
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <rect x="3" y="3" width="18" height="18" rx="2" />
                                <circle cx="9" cy="9" r="2" />
                                <path d="m21 15-3.1-3.1a2 2 0 0 0-2.81.01L6 21" />
                              </svg>
                            </div>
                            <div className="admin-image-drop__title">Click to upload protocol image</div>
                            <div className="admin-image-drop__formats">
                              JPG, PNG, WebP… — max 10 MB
                            </div>
                          </>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          disabled={uploadingIdx === i}
                          onChange={(e) => void handleImage(i, e.target.files?.[0])}
                        />
                      </label>
                    )}
                  </div>

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

                  <div>
                    <div className="small">Storage instructions</div>
                    <input
                      value={p.storage}
                      placeholder="e.g. Refrigerate at 2-8°C…"
                      onChange={(e) => update(i, { storage: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
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
