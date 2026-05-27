"use client";

// Full footer customization inside the Tweaks panel — collapsible Socials and
// Link-columns editors. Ported from the design's FooterEditor.

import { useState, type CSSProperties } from "react";
import type { Brand, FooterColumn, FooterSocial } from "../types";

export function FooterEditor({
  brand,
  setTweak,
}: {
  brand: Brand;
  setTweak: (keyOrEdits: keyof Brand | Partial<Brand>, val?: unknown) => void;
}) {
  const [openSocials, setOpenSocials] = useState(false);
  const [openCols, setOpenCols] = useState(false);

  const s: Record<string, CSSProperties> = {
    sub: { padding: "6px 12px 10px", display: "flex", flexDirection: "column", gap: 6 },
    head: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "8px 12px",
      background: "rgba(0,0,0,0.04)",
      borderRadius: 6,
      cursor: "pointer",
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "rgba(0,0,0,0.7)",
    },
    block: {
      padding: "10px 12px",
      border: "1px solid rgba(0,0,0,0.08)",
      borderRadius: 8,
      marginBottom: 8,
      background: "rgba(0,0,0,0.02)",
    },
    row: { display: "flex", gap: 6, alignItems: "center", marginBottom: 6 },
    input: {
      flex: 1,
      minWidth: 0,
      fontSize: 12,
      padding: "5px 8px",
      border: "1px solid rgba(0,0,0,0.15)",
      borderRadius: 4,
      background: "#fff",
      outline: "none",
      fontFamily: "inherit",
    },
    sel: {
      fontSize: 12,
      padding: "5px 6px",
      border: "1px solid rgba(0,0,0,0.15)",
      borderRadius: 4,
      background: "#fff",
    },
    iconBtn: {
      width: 24,
      height: 24,
      border: "1px solid rgba(0,0,0,0.15)",
      borderRadius: 4,
      background: "#fff",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      color: "rgba(0,0,0,0.5)",
      fontSize: 14,
      lineHeight: 1,
    },
    addBtn: {
      fontSize: 11,
      padding: "6px 10px",
      border: "1px dashed rgba(0,0,0,0.2)",
      borderRadius: 6,
      background: "transparent",
      cursor: "pointer",
      color: "rgba(0,0,0,0.6)",
      marginTop: 4,
    },
    toggleRow: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "4px 0",
      fontSize: 12,
    },
    tinyLabel: {
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      color: "rgba(0,0,0,0.5)",
      marginBottom: 4,
    },
    caret: { transition: "transform .15s", display: "inline-block" },
  };

  // Socials
  const socials = brand.footerSocials || [];
  const updateSocial = (i: number, patch: Partial<FooterSocial>) => {
    setTweak("footerSocials", socials.map((soc, j) => (j === i ? { ...soc, ...patch } : soc)));
  };
  const removeSocial = (i: number) =>
    setTweak("footerSocials", socials.filter((_, j) => j !== i));
  const addSocial = () =>
    setTweak("footerSocials", [...socials, { label: "New", href: "#", icon: "circle", show: true }]);

  // Columns
  const cols = brand.footerColumns || [];
  const updateCol = (i: number, patch: Partial<FooterColumn>) => {
    setTweak("footerColumns", cols.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  };
  const removeCol = (i: number) => setTweak("footerColumns", cols.filter((_, j) => j !== i));
  const addCol = () =>
    setTweak("footerColumns", [
      ...cols,
      { title: "New Column", links: [{ label: "Link", href: "#" }] },
    ]);
  const updateLink = (ci: number, li: number, patch: Partial<{ label: string; href: string }>) => {
    const links = cols[ci].links.map((l, j) => (j === li ? { ...l, ...patch } : l));
    updateCol(ci, { links });
  };
  const removeLink = (ci: number, li: number) => {
    updateCol(ci, { links: cols[ci].links.filter((_, j) => j !== li) });
  };
  const addLink = (ci: number) => {
    updateCol(ci, { links: [...(cols[ci].links || []), { label: "New link", href: "#" }] });
  };

  return (
    <div style={s.sub}>
      {/* SOCIALS editor */}
      <div style={s.head} onClick={() => setOpenSocials((o) => !o)}>
        <span>
          Socials ({socials.filter((x) => x.show !== false).length}/{socials.length})
        </span>
        <span style={{ ...s.caret, transform: openSocials ? "rotate(90deg)" : "none" }}>▶</span>
      </div>
      {openSocials && (
        <div>
          {socials.map((soc, i) => (
            <div key={i} style={s.block}>
              <div style={s.toggleRow}>
                <span style={{ fontWeight: 600 }}>{soc.label || "Untitled"}</span>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                  <input
                    type="checkbox"
                    checked={soc.show !== false}
                    onChange={(e) => updateSocial(i, { show: e.target.checked })}
                  />
                  show
                </label>
              </div>
              <div style={s.row}>
                <input
                  style={s.input}
                  placeholder="Label"
                  value={soc.label || ""}
                  onChange={(e) => updateSocial(i, { label: e.target.value })}
                />
                <select
                  style={s.sel}
                  value={soc.icon || "circle"}
                  onChange={(e) => updateSocial(i, { icon: e.target.value })}
                >
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                  <option value="twitter">Twitter / X</option>
                  <option value="circle">Generic</option>
                </select>
                <button style={s.iconBtn} title="Remove" onClick={() => removeSocial(i)}>
                  ×
                </button>
              </div>
              <input
                style={s.input}
                placeholder="https://…"
                value={soc.href || ""}
                onChange={(e) => updateSocial(i, { href: e.target.value })}
              />
            </div>
          ))}
          <button style={s.addBtn} onClick={addSocial}>
            + Add social
          </button>
        </div>
      )}

      {/* COLUMNS editor */}
      <div style={s.head} onClick={() => setOpenCols((o) => !o)}>
        <span>Link columns ({cols.length})</span>
        <span style={{ ...s.caret, transform: openCols ? "rotate(90deg)" : "none" }}>▶</span>
      </div>
      {openCols && (
        <div>
          {cols.map((col, ci) => (
            <div key={ci} style={s.block}>
              <div style={s.row}>
                <input
                  style={{ ...s.input, fontWeight: 600 }}
                  placeholder="Column title"
                  value={col.title || ""}
                  onChange={(e) => updateCol(ci, { title: e.target.value })}
                />
                <button style={s.iconBtn} title="Delete column" onClick={() => removeCol(ci)}>
                  ×
                </button>
              </div>
              <div style={s.tinyLabel}>Links</div>
              {(col.links || []).map((l, li) => (
                <div key={li} style={s.row}>
                  <input
                    style={s.input}
                    placeholder="Label"
                    value={l.label || ""}
                    onChange={(e) => updateLink(ci, li, { label: e.target.value })}
                  />
                  <input
                    style={{ ...s.input, flex: "0 0 90px" }}
                    placeholder="href"
                    value={l.href || ""}
                    onChange={(e) => updateLink(ci, li, { href: e.target.value })}
                  />
                  <button style={s.iconBtn} title="Remove link" onClick={() => removeLink(ci, li)}>
                    ×
                  </button>
                </div>
              ))}
              <button style={s.addBtn} onClick={() => addLink(ci)}>
                + Add link
              </button>
            </div>
          ))}
          <button style={s.addBtn} onClick={addCol}>
            + Add column
          </button>
        </div>
      )}
    </div>
  );
}
