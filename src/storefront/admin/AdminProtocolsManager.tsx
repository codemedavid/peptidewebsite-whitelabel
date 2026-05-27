"use client";

import { useState } from "react";
import type { Brand, Protocol } from "../types";
import { useStore } from "../store";

export function AdminProtocolsManager({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { protocols, setProtocols, categories } = useStore();
  const [list, setList] = useState<Protocol[]>(protocols);

  void brand;

  const commit = (next: Protocol[]) => {
    setList(next);
    setProtocols(next);
  };

  const add = () =>
    commit([
      ...list,
      {
        category: "General",
        name: "New Protocol",
        dosage: "",
        frequency: "",
        duration: "",
        notes: [""],
        storage: "",
      },
    ]);

  const update = (i: number, patch: Partial<Protocol>) =>
    commit(list.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const remove = (i: number) => {
    if (!confirm("Delete this protocol?")) return;
    commit(list.filter((_, j) => j !== i));
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
            <button className="admin-btn" onClick={add}>
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
