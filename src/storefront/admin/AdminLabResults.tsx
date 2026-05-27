"use client";

import { useState, useRef } from "react";
import type { Brand, CoaReport } from "../types";
import { useStore } from "../store";
import { readImageFile } from "./shared";

// ─── CoaEditorModal ───────────────────────────────────────────────────────────

type CoaReportEditing = CoaReport & { _new?: boolean };

function CoaEditorModal({
  report,
  partners,
  onCancel,
  onSave,
}: {
  report: CoaReportEditing;
  partners: { label: string; href: string }[];
  onCancel: () => void;
  onSave: (rep: CoaReportEditing) => void;
}) {
  const [name, setName] = useState<string>(report.name || "");
  const [lab, setLab] = useState<string>(report.lab || "");
  const [date, setDate] = useState<string>(report.date || "");
  const [purity, setPurity] = useState<string>(report.purity || "");
  const [image, setImage] = useState<string>(report.image || "");
  const [link, setLink] = useState<string>(report.link || "");
  const [drag, setDrag] = useState<boolean>(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSave = name.trim();

  const onImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await readImageFile(file, 2500);
      setImage(dataUrl);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not read image.");
    }
  };

  return (
    <div className="admin-modal" onClick={onCancel}>
      <div
        className="admin-modal__card"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        style={{ maxWidth: 560 }}
      >
        <h2 className="admin-modal__title">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--brand-accent)" }}
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          {report._new ? "Add Lab Report" : "Edit Lab Report"}
        </h2>

        <div className="admin-modal__row">
          <label className="admin-field__label">
            Product / Report name
            <span style={{ color: "var(--brand-accent)" }}>*</span>
          </label>
          <input
            className="admin-input"
            value={name}
            placeholder="e.g., BPC-157 5mg"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setName(e.target.value)
            }
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="admin-modal__row" style={{ margin: 0 }}>
            <label className="admin-field__label">Lab</label>
            {partners.length > 0 ? (
              <>
                <select
                  className="admin-select"
                  value={lab}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setLab(e.target.value)
                  }
                >
                  <option value="">— Select —</option>
                  {partners.map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                  <option value="__other">Other (type below)</option>
                </select>
                {lab === "__other" && (
                  <input
                    className="admin-input"
                    style={{ marginTop: 8 }}
                    placeholder="Lab name"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setLab(e.target.value)
                    }
                  />
                )}
              </>
            ) : (
              <input
                className="admin-input"
                value={lab}
                placeholder="e.g., Janoshik Analytical"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setLab(e.target.value)
                }
              />
            )}
          </div>
          <div className="admin-modal__row" style={{ margin: 0 }}>
            <label className="admin-field__label">Test date</label>
            <input
              className="admin-input"
              type="date"
              value={date}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setDate(e.target.value)
              }
            />
          </div>
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Purity (optional)</label>
          <input
            className="admin-input"
            value={purity}
            placeholder="e.g., 99.2%"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setPurity(e.target.value)
            }
          />
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Certificate image</label>
          <div
            className={`admin-coa-modal__drop ${drag ? "is-dragover" : ""}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e: React.DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e: React.DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              setDrag(false);
              void onImage(e.dataTransfer.files?.[0]);
            }}
          >
            {image ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="Certificate preview" />
                <div
                  style={{
                    marginTop: 10,
                    display: "flex",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <button
                    className="admin-btn admin-btn--ghost"
                    style={{ padding: "6px 14px", fontSize: 12 }}
                    onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                      e.stopPropagation();
                      fileRef.current?.click();
                    }}
                  >
                    Replace
                  </button>
                  <button
                    className="admin-btn admin-btn--ghost"
                    style={{ padding: "6px 14px", fontSize: 12 }}
                    onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                      e.stopPropagation();
                      setImage("");
                    }}
                  >
                    Remove
                  </button>
                </div>
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ margin: "0 auto 8px" }}
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--brand-text)",
                  }}
                >
                  Click or drop a certificate image
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--brand-text-muted)",
                    marginTop: 4,
                  }}
                >
                  PNG, JPG — keep it under 2.5 MB
                </div>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                void onImage(e.target.files?.[0])
              }
            />
          </div>
        </div>

        <div className="admin-coa-modal__or">— and / or —</div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Document link</label>
          <input
            className="admin-input"
            value={link}
            type="url"
            placeholder="https://example.com/coa-report.pdf"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setLink(e.target.value)
            }
          />
          <div className="admin-field__hint">
            Paste a link to a hosted PDF or external lab portal. Customers can
            click through to view.
          </div>
        </div>

        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="admin-btn"
            disabled={!canSave}
            onClick={() =>
              onSave({
                ...report,
                name,
                lab: lab === "__other" ? "" : lab,
                date,
                purity,
                image,
                link,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AdminLabResults ──────────────────────────────────────────────────────────

export function AdminLabResults({
  brand,
  onBack,
}: {
  brand: Brand;
  onBack: () => void;
}) {
  const { coaReports, setCoaReports } = useStore();
  const [editing, setEditing] = useState<CoaReportEditing | null>(null);

  const commit = (next: CoaReport[]) => {
    setCoaReports(next);
  };

  const startAdd = () =>
    setEditing({
      id: `coa${Date.now()}`,
      name: "",
      lab: "",
      date: new Date().toISOString().slice(0, 10),
      purity: "",
      image: "",
      link: "",
      _new: true,
    });

  const save = (rep: CoaReportEditing) => {
    const exists = coaReports.some((r) => r.id === rep.id);
    const { _new: _removed, ...clean } = rep;
    void _removed;
    commit(
      exists
        ? coaReports.map((r) => (r.id === rep.id ? clean : r))
        : [...coaReports, clean],
    );
    setEditing(null);
  };

  const remove = (id: string) => {
    if (
      !confirm(
        "Delete this lab report? It will also disappear from the public COA page.",
      )
    )
      return;
    commit(coaReports.filter((r) => r.id !== id));
  };

  return (
    <div className="admin">
      <main className="admin__inner">
        <div className="admin-table__head">
          <h1 className="admin-table__title">
            <a
              className="admin-table__title-back"
              href="#"
              onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
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
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--brand-accent)" }}
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Lab Results
            </span>
          </h1>
          <div style={{ display: "flex", gap: 10 }}>
            <a
              className="admin-btn admin-btn--ghost"
              href="#coa"
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
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Preview Public Page
            </a>
            <button className="admin-btn" onClick={startAdd}>
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
              Add Lab Report
            </button>
          </div>
        </div>

        <div className="admin-coa-list">
          {coaReports.map((r) => (
            <div key={r.id} className="admin-coa-card">
              <div className="admin-coa-card__thumb">
                {r.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image} alt={r.name} />
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                )}
                {r.purity && (
                  <span className="admin-coa-card__badge">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {r.purity}
                  </span>
                )}
              </div>
              <div className="admin-coa-card__body">
                <div className="admin-coa-card__name">{r.name || "Untitled"}</div>
                <div className="admin-coa-card__lab">{r.lab || "—"}</div>
                {r.date && (
                  <div className="admin-coa-card__date">
                    {new Date(r.date).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                )}
                <div className="admin-coa-card__links" style={{ marginTop: 10 }}>
                  <span
                    className={`admin-coa-card__link-pill ${
                      r.image
                        ? "admin-coa-card__link-pill--on"
                        : "admin-coa-card__link-pill--off"
                    }`}
                  >
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
                    Image
                  </span>
                  <span
                    className={`admin-coa-card__link-pill ${
                      r.link
                        ? "admin-coa-card__link-pill--on"
                        : "admin-coa-card__link-pill--off"
                    }`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    Link
                  </span>
                </div>
              </div>
              <div className="admin-coa-card__foot">
                <button
                  className="admin-btn admin-btn--ghost"
                  style={{ padding: "6px 14px", fontSize: 13 }}
                  onClick={() => setEditing({ ...r })}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                  Edit
                </button>
                <button
                  className="admin-icon-btn admin-icon-btn--danger"
                  title="Delete"
                  onClick={() => remove(r.id)}
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
            </div>
          ))}
          {coaReports.length === 0 && (
            <div
              className="admin-empty-set"
              style={{ gridColumn: "1 / -1" }}
            >
              No lab reports yet. Add one — it&apos;ll show up on your public
              Lab Reports page.
              <button className="admin-empty-set__cta" onClick={startAdd}>
                + Add your first lab report
              </button>
            </div>
          )}
        </div>

        {editing && (
          <CoaEditorModal
            report={editing}
            partners={brand.coaPartners || []}
            onCancel={() => setEditing(null)}
            onSave={save}
          />
        )}
      </main>
    </div>
  );
}
