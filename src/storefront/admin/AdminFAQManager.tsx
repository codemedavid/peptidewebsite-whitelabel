"use client";

import { useState } from "react";
import type { Brand, FaqGroup, FaqItem } from "../types";
import { useStore } from "../store";

export function AdminFAQManager({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { faqGroups, setFaqGroups } = useStore();
  const [groups, setGroups] = useState<FaqGroup[]>(faqGroups);

  void brand;

  const commit = (next: FaqGroup[]) => {
    setGroups(next);
    setFaqGroups(next);
  };

  const addGroup = () =>
    commit([
      ...groups,
      {
        id: `g${Date.now()}`,
        label: "New Category",
        icon: "product",
        items: [{ q: "Sample question?", a: "Sample answer." }],
      },
    ]);

  const updateGroup = (id: string, patch: Partial<FaqGroup>) =>
    commit(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));

  const removeGroup = (id: string) => {
    if (!confirm("Delete this FAQ group and all its questions?")) return;
    commit(groups.filter((g) => g.id !== id));
  };

  const addItem = (gid: string) => {
    const g = groups.find((x) => x.id === gid);
    if (!g) return;
    updateGroup(gid, { items: [...g.items, { q: "", a: "" }] });
  };

  const updateItem = (gid: string, idx: number, patch: Partial<FaqItem>) => {
    const g = groups.find((x) => x.id === gid);
    if (!g) return;
    updateGroup(gid, {
      items: g.items.map((it, j) => (j === idx ? { ...it, ...patch } : it)),
    });
  };

  const removeItem = (gid: string, idx: number) => {
    const g = groups.find((x) => x.id === gid);
    if (!g) return;
    updateGroup(gid, { items: g.items.filter((_, j) => j !== idx) });
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
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
              </svg>
              FAQ
            </span>
          </h1>
          <div style={{ display: "flex", gap: 10 }}>
            <a
              className="admin-btn admin-btn--ghost"
              href="#faq"
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
            <button className="admin-btn" onClick={addGroup}>
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
              Add Group
            </button>
          </div>
        </div>

        <div className="editor-list">
          {groups.map((g) => (
            <div key={g.id} className="editor-card">
              <div className="editor-card__head">
                <div style={{ display: "flex", flex: 1, gap: 10, alignItems: "center" }}>
                  <input
                    className="admin-input"
                    value={g.label}
                    style={{ flex: 1 }}
                    placeholder="Group name (e.g. Shipping & Delivery)"
                    onChange={(e) => updateGroup(g.id, { label: e.target.value })}
                  />
                  <select
                    className="admin-select"
                    style={{ width: 160 }}
                    value={g.icon}
                    onChange={(e) => updateGroup(g.id, { icon: e.target.value })}
                  >
                    <option value="shipping">Shipping</option>
                    <option value="payment">Payment</option>
                    <option value="product">Product</option>
                    <option value="default">Default</option>
                  </select>
                </div>
                <button
                  className="admin-icon-btn admin-icon-btn--danger"
                  onClick={() => removeGroup(g.id)}
                  title="Delete group"
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

              {(g.items || []).map((item, i) => (
                <div key={i} className="editor-item">
                  <div className="editor-item__body">
                    <div>
                      <div className="small">Question</div>
                      <input
                        value={item.q}
                        placeholder="Question…"
                        onChange={(e) => updateItem(g.id, i, { q: e.target.value })}
                      />
                    </div>
                    <div>
                      <div className="small">Answer</div>
                      <textarea
                        value={item.a}
                        placeholder="Answer…"
                        onChange={(e) => updateItem(g.id, i, { a: e.target.value })}
                      />
                    </div>
                  </div>
                  <button
                    className="admin-icon-btn admin-icon-btn--danger"
                    onClick={() => removeItem(g.id, i)}
                    title="Remove question"
                    style={{ alignSelf: "flex-start" }}
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
              ))}
              <button className="editor-add-btn" onClick={() => addItem(g.id)}>
                + Add question
              </button>
            </div>
          ))}
          {groups.length === 0 && (
            <div className="admin-empty-set">
              No FAQ groups yet.
              <button className="admin-empty-set__cta" onClick={addGroup}>
                + Add your first group
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
