"use client";

// Full footer customization inside the Tweaks panel — collapsible Socials and
// Link-columns editors. Ported from the design's FooterEditor.

import { useState, type CSSProperties } from "react";
import type { Brand, FooterColumn, FooterSocial } from "../types";
import {
  SOCIAL_PLATFORMS,
  normalizeSocialHref,
  isKnownSocialIcon,
  GENERIC_SOCIAL_ICON,
} from "@/lib/storefront/footer-links";

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
    note: { fontSize: 10.5, color: "rgba(0,0,0,0.5)", margin: "0 0 8px", lineHeight: 1.5 },
    hint: { fontSize: 10, color: "rgba(0,0,0,0.45)", margin: "4px 0 0", lineHeight: 1.4 },
    hintBad: { fontSize: 10, color: "#b42318", margin: "4px 0 0", lineHeight: 1.4 },
    inputBad: { borderColor: "#b42318" },
    pill: {
      fontSize: 9.5,
      fontWeight: 700,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      padding: "2px 6px",
      borderRadius: 999,
    },
    pillOn: { background: "rgba(16,124,16,0.12)", color: "#0f7b0f" },
    pillOff: { background: "rgba(0,0,0,0.06)", color: "rgba(0,0,0,0.45)" },
  };

  // Socials — one row per platform, and the LINK is the switch: an empty URL
  // means the icon never renders on the site, so "off" is the default state and
  // needs no toggle. `show` survives as a hide-only override for a platform
  // that has a link the owner wants temporarily off.
  const socials = brand.footerSocials || [];
  const updateSocial = (i: number, patch: Partial<FooterSocial>) => {
    setTweak("footerSocials", socials.map((soc, j) => (j === i ? { ...soc, ...patch } : soc)));
  };
  const removeSocial = (i: number) =>
    setTweak("footerSocials", socials.filter((_, j) => j !== i));
  const platformIndex = (icon: string) => socials.findIndex((soc) => soc.icon === icon);
  // The raw text is stored as typed so the operator sees their own input; the
  // storefront normalizes it at render (buildFooterSocials), and a value that
  // can't become an http(s) URL renders nothing.
  const setPlatformHref = (icon: string, label: string, href: string) => {
    const i = platformIndex(icon);
    if (i >= 0) {
      updateSocial(i, { href });
      return;
    }
    setTweak("footerSocials", [...socials, { label, href, icon, show: true }]);
  };
  const liveCount = socials.filter(
    (soc) => soc.show !== false && normalizeSocialHref(soc.href) !== "",
  ).length;
  // Anything not in the platform registry — legacy rows, or a link the operator
  // added by hand. Kept editable so no saved config is lost.
  const customSocials = socials
    .map((soc, i) => ({ soc, i }))
    .filter(({ soc }) => !isKnownSocialIcon(soc.icon));
  const addCustomSocial = () =>
    setTweak("footerSocials", [
      ...socials,
      { label: "Website", href: "", icon: GENERIC_SOCIAL_ICON, show: true },
    ]);

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
      {/* FOOTER STYLE — columns (default) vs compact dark footer */}
      <div style={{ marginBottom: 8 }}>
        <div style={s.tinyLabel}>Footer style</div>
        <select
          style={{ ...s.sel, width: "100%" }}
          value={brand.footerStyle === "compact" ? "compact" : "columns"}
          onChange={(e) => setTweak("footerStyle", e.target.value)}
        >
          <option value="columns">Columns (default)</option>
          <option value="compact">Compact (dark, pill links)</option>
        </select>
        {brand.footerStyle === "compact" && (
          <p style={{ fontSize: 10.5, color: "rgba(0,0,0,0.5)", margin: "6px 0 0", lineHeight: 1.5 }}>
            Compact footer shows the tagline (Blurb below), plus pill links for Lab
            Reports, FAQ and each active contact channel. Socials &amp; link columns
            are hidden in this style.
          </p>
        )}
      </div>

      {/* SOCIALS editor — one link field per platform, empty = hidden */}
      <div style={s.head} onClick={() => setOpenSocials((o) => !o)}>
        <span>Socials ({liveCount} shown)</span>
        <span style={{ ...s.caret, transform: openSocials ? "rotate(90deg)" : "none" }}>▶</span>
      </div>
      {openSocials && (
        <div>
          <p style={s.note}>
            Paste this store&apos;s profile link for each platform it actually uses. Leave a
            field empty and that icon stays off the site.
          </p>
          {SOCIAL_PLATFORMS.map((platform) => {
            const i = platformIndex(platform.icon);
            const entry = i >= 0 ? socials[i] : undefined;
            const raw = entry?.href || "";
            const href = normalizeSocialHref(raw);
            const isInvalid = raw.trim() !== "" && !href;
            const isLive = href !== "" && entry?.show !== false;
            return (
              <div key={platform.icon} style={s.block}>
                <div style={s.toggleRow}>
                  <span style={{ fontWeight: 600 }}>{platform.label}</span>
                  <span style={{ ...s.pill, ...(isLive ? s.pillOn : s.pillOff) }}>
                    {isLive ? "On" : "Off"}
                  </span>
                </div>
                <input
                  style={{ ...s.input, ...(isInvalid ? s.inputBad : null) }}
                  placeholder={platform.placeholder}
                  value={raw}
                  aria-label={`${platform.label} link`}
                  aria-invalid={isInvalid}
                  onChange={(e) => setPlatformHref(platform.icon, platform.label, e.target.value)}
                />
                <p style={isInvalid ? s.hintBad : s.hint}>
                  {isInvalid
                    ? "That isn't a web address — use a full link, e.g. https://…"
                    : href
                      ? platform.hint
                      : "No link yet — this icon is hidden on the site."}
                </p>
                {href !== "" && (
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginTop: 6 }}
                  >
                    <input
                      type="checkbox"
                      checked={entry?.show !== false}
                      onChange={(e) => updateSocial(i, { show: e.target.checked })}
                    />
                    show on site
                  </label>
                )}
              </div>
            );
          })}

          {customSocials.length > 0 && <div style={s.tinyLabel}>Other links</div>}
          {customSocials.map(({ soc, i }) => (
            <div key={`custom-${i}`} style={s.block}>
              <div style={s.row}>
                <input
                  style={{ ...s.input, fontWeight: 600 }}
                  placeholder="Label"
                  value={soc.label || ""}
                  onChange={(e) => updateSocial(i, { label: e.target.value })}
                />
                <button style={s.iconBtn} title="Remove" onClick={() => removeSocial(i)}>
                  ×
                </button>
              </div>
              <input
                style={{
                  ...s.input,
                  ...(soc.href?.trim() && !normalizeSocialHref(soc.href) ? s.inputBad : null),
                }}
                placeholder="https://…"
                value={soc.href || ""}
                aria-label={`${soc.label || "Custom"} link`}
                onChange={(e) => updateSocial(i, { href: e.target.value })}
              />
            </div>
          ))}
          <button style={s.addBtn} onClick={addCustomSocial}>
            + Add other link
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
